import puppeteer from 'puppeteer';

let browser;
let page;
let actionQueue = Promise.resolve();

const BALE_HOME_URL = 'https://web.bale.ai';
const PAGE_TIMEOUT = 30000;
const LANDING_WAIT_MS = 4500;
const CHAT_LOAD_WAIT_MS = 5000;
const NAVIGATION_GAP_MS = 1200;
const INPUT_WAIT_MS = 20000;
const SEND_VERIFY_WAIT_MS = 7000;
const MAX_SEND_ATTEMPTS = 3;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const initBaleBrowser = async () => {
    console.log('🌐 Starting Puppeteer browser...');

    browser = await puppeteer.launch({
        headless: false,
        executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        userDataDir: './bale_session',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log('🔄 Loading Bale Web...');

    await page.goto(BALE_HOME_URL, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_TIMEOUT
    });

    await sleep(2500);

    console.log('✅ Browser ready!');
};

function formatMobileForLink(mobile) {
    let raw = String(mobile ?? '')
        .trim()
        .split(/\||,|;/)[0]
        .trim();

    raw = raw
        .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

    raw = raw.replace(/\.0+$/, '');

    let digits = raw.replace(/\D/g, '');
    digits = digits.replace(/^0+/, '');

    if (digits.startsWith('98')) {
        // already normalized
    } else if (digits.startsWith('9')) {
        digits = '98' + digits;
    } else {
        return null;
    }

    if (!/^989\d{9}$/.test(digits)) {
        return null;
    }

    return digits;
}

function logStep(mobile, step, message) {
    console.log(`ℹ️ [${step}] | شماره: ${mobile} | ${message}`);
}

function logSuccess(mobile, message) {
    console.log(`✅ [SUCCESS] | شماره: ${mobile} | ${message}`);
}

function logFailure(mobile, code, message, extra = '') {
    const suffix = extra ? ` | ${extra}` : '';
    console.error(`❌ [${code}] | شماره: ${mobile} | ${message}${suffix}`);
}

async function waitForPageSettled(extraMs = NAVIGATION_GAP_MS) {
    await sleep(extraMs);
}


async function isPageUsable() {
    try {
        if (!page || page.isClosed()) return false;
        await page.evaluate(() => document.readyState);
        return true;
    } catch {
        return false;
    }
}

async function recoverBalePage(reason = '') {
    console.warn(`⚠️ [PAGE_RECOVERY]${reason ? ` | ${reason}` : ''} | تلاش برای بازیابی Page...`);

    try {
        if (page && !page.isClosed()) {
            try {
                await page.bringToFront();
                await page.evaluate(() => document.readyState);
                return true;
            } catch { }
        }

        if (!browser || !browser.isConnected()) {
            console.error('❌ [PAGE_RECOVERY_FAILED] | Browser دیگر متصل نیست.');
            return false;
        }

        const pages = await browser.pages();
        const existing = pages.find(p => {
            try { return !p.isClosed(); } catch { return false; }
        });

        if (existing) {
            page = existing;
            try {
                await page.bringToFront();
                await page.evaluate(() => document.readyState);
                console.log('✅ [PAGE_RECOVERY] | از Page موجود مرورگر دوباره استفاده شد.');
                return true;
            } catch { }
        }

        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(BALE_HOME_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
        await sleep(2500);
        console.log('✅ [PAGE_RECOVERY] | Page جدید ساخته و Bale دوباره بارگذاری شد.');
        return true;
    } catch (error) {
        console.error(`❌ [PAGE_RECOVERY_FAILED] | ${error.name || 'Error'} | ${error.message}`);
        return false;
    }
}

async function returnToBaleHome() {
    if (!(await isPageUsable())) {
        const recovered = await recoverBalePage('صفحه برای بازگشت به خانه قابل استفاده نبود');
        if (!recovered) return;
    }

    try {
        await page.goto(BALE_HOME_URL, {
            waitUntil: 'domcontentloaded',
            timeout: PAGE_TIMEOUT
        });
        await sleep(1800);
    } catch (error) {
        console.error(`⚠️ [HOME_NAVIGATION_FAILED] | ${error.message}`);
        const recovered = await recoverBalePage('Navigation به Home با Frame/Session خطا داد');
        if (recovered) {
            try {
                await page.goto(BALE_HOME_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
                await sleep(1800);
            } catch (retryError) {
                console.error(`⚠️ [HOME_NAVIGATION_RETRY_FAILED] | ${retryError.message}`);
            }
        }
    }
}

function isVisibleMessageInput() {
    return `(() => {
        const candidates = Array.from(document.querySelectorAll(
            'textarea, input[type="text"], [contenteditable="true"]'
        ));

        const visible = el => {
            if (!el) return false;
            if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
            if (el.getAttribute('aria-hidden') === 'true') return false;

            const style = window.getComputedStyle(el);
            if (
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                Number(style.opacity || 1) === 0
            ) {
                return false;
            }

            const rect = el.getBoundingClientRect();
            return rect.width > 20 && rect.height > 10;
        };

        const score = el => {
            const placeholder = String(el.getAttribute('placeholder') || '').toLowerCase();
            const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
            const role = String(el.getAttribute('role') || '').toLowerCase();
            let value = 0;

            if (placeholder.includes('پیام') || placeholder.includes('message')) value += 100;
            if (aria.includes('پیام') || aria.includes('message')) value += 90;
            if (role === 'textbox') value += 50;
            if (el.getAttribute('contenteditable') === 'true') value += 30;
            if (el.classList.contains('Ke4mfC')) value += 80;

            return value;
        };

        const items = candidates
            .filter(visible)
            .map(el => ({ el, score: score(el) }))
            .sort((a, b) => b.score - a.score);

        if (!items.length) return false;

        const el = items[0].el;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        el.focus({ preventScroll: true });
        el.click();

        return true;
    })()`;
}

async function focusMessageInput(mobile, timeout = INPUT_WAIT_MS) {
    if (!page) return false;

    if (!(await isPageUsable())) {
        const recovered = await recoverBalePage('Page قبل از پیدا کردن کادر پیام قابل استفاده نبود');
        if (!recovered) return false;
    }

    try {
        await page.bringToFront();
    } catch (error) {
        const recovered = await recoverBalePage(`bringToFront خطا داد: ${error.message}`);
        if (!recovered) return false;
    }

    const started = Date.now();

    while (Date.now() - started < timeout) {
        try {
            const found = await page.evaluate(isVisibleMessageInput());
            if (found) {
                await sleep(250);

                const focused = await page.evaluate(() => {
                    const el = document.activeElement;
                    if (!el) return false;

                    const isInput =
                        el.matches?.('textarea, input[type="text"], [contenteditable="true"]');

                    if (!isInput) return false;

                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);

                    return (
                        rect.width > 20 &&
                        rect.height > 10 &&
                        style.visibility !== 'hidden' &&
                        style.display !== 'none'
                    );
                });

                if (focused) {
                    logStep(mobile, 'MESSAGE_INPUT_FOUND', 'کادر واقعی و قابل‌استفاده پیام پیدا و Focus شد.');
                    return true;
                }
            }
        } catch (error) {
            logStep(mobile, 'MESSAGE_INPUT_RETRY', `خطا در پیدا کردن کادر پیام؛ تلاش مجدد. ${error.message}`);

            if (/TargetCloseError|Session closed|detached Frame|Execution context was destroyed|Cannot find context/i.test(String(error.message || ''))) {
                await recoverBalePage(`خطای lifecycle در Page: ${error.message}`);
            }
        }

        await sleep(500);
    }

    return false;
}

async function getCurrentInputText() {
    return page.evaluate(() => {
        const active = document.activeElement;
        const candidates = [];

        if (active) candidates.push(active);
        candidates.push(...Array.from(document.querySelectorAll(
            'textarea, input[type="text"], [contenteditable="true"]'
        )));

        const visible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || 1) > 0 &&
                rect.width > 20 &&
                rect.height > 10
            );
        };

        const score = el => {
            const placeholder = String(el.getAttribute('placeholder') || '').toLowerCase();
            const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
            const role = String(el.getAttribute('role') || '').toLowerCase();
            let scoreValue = 0;
            if (placeholder.includes('پیام') || placeholder.includes('message')) scoreValue += 100;
            if (aria.includes('پیام') || aria.includes('message')) scoreValue += 90;
            if (role === 'textbox') scoreValue += 50;
            if (el.getAttribute('contenteditable') === 'true') scoreValue += 30;
            if (el.classList.contains('Ke4mfC')) scoreValue += 80;
            return scoreValue;
        };

        const el = candidates
            .filter((item, index, arr) => item && arr.indexOf(item) === index)
            .filter(visible)
            .sort((a, b) => score(b) - score(a))[0];

        if (!el) return null;

        if (el.matches('textarea, input[type="text"]')) {
            return String(el.value || '');
        }

        if (el.matches('[contenteditable="true"]')) {
            return String(el.innerText || el.textContent || '');
        }

        return null;
    });
}

async function clearFocusedInput() {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    await page.keyboard.down(modifier);
    await page.keyboard.press('KeyA');
    await page.keyboard.up(modifier);
    await page.keyboard.press('Backspace');
    await sleep(150);
}

async function insertMessageWithoutClipboard(text) {
    const value = String(text ?? '');

    // در نسخه Puppeteer نصب‌شده روی سیستم، keyboard.insertText وجود ندارد.
    // بنابراین از APIهای DOM خود صفحه استفاده می‌کنیم و بعد input event می‌فرستیم
    // تا React/Vue/اپ بله هم تغییر مقدار را متوجه شود.
    const inserted = await page.evaluate((message) => {
        const candidates = Array.from(document.querySelectorAll(
            'textarea, input[type="text"], [contenteditable="true"]'
        ));

        const visible = el => {
            if (!el) return false;
            if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || 1) > 0 &&
                rect.width > 20 &&
                rect.height > 10
            );
        };

        const score = el => {
            const placeholder = String(el.getAttribute('placeholder') || '').toLowerCase();
            const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
            const role = String(el.getAttribute('role') || '').toLowerCase();
            let scoreValue = 0;
            if (placeholder.includes('پیام') || placeholder.includes('message')) scoreValue += 100;
            if (aria.includes('پیام') || aria.includes('message')) scoreValue += 90;
            if (role === 'textbox') scoreValue += 50;
            if (el.getAttribute('contenteditable') === 'true') scoreValue += 30;
            if (el.classList.contains('Ke4mfC')) scoreValue += 80;
            return scoreValue;
        };

        const el = candidates
            .filter(visible)
            .sort((a, b) => score(b) - score(a))[0];

        if (!el) return false;

        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        el.focus({ preventScroll: true });

        if (el.matches('textarea, input[type="text"]')) {
            const proto = el instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
            const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

            if (descriptor && descriptor.set) {
                descriptor.set.call(el, message);
            } else {
                el.value = message;
            }
        } else if (el.getAttribute('contenteditable') === 'true') {
            el.innerHTML = '';
            el.appendChild(document.createTextNode(message));
        }

        try {
            el.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: message
            }));
        } catch {
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }

        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }, value);

    if (!inserted) {
        throw new Error('کادر پیام برای درج متن پیدا نشد.');
    }
}

async function waitUntilInputContains(expectedText, timeout = 5000) {
    const expected = String(expectedText ?? '').trim();
    const started = Date.now();

    while (Date.now() - started < timeout) {
        try {
            const current = await getCurrentInputText();
            if (String(current ?? '').trim() === expected) {
                return true;
            }
        } catch { }

        await sleep(150);
    }

    return false;
}

async function waitUntilInputEmpty(timeout = SEND_VERIFY_WAIT_MS) {
    const started = Date.now();

    while (Date.now() - started < timeout) {
        try {
            const current = await getCurrentInputText();

            // اگر input موقتاً در حال re-render است، چند لحظه صبر می‌کنیم.
            if (current !== null && String(current).trim() === '') {
                return true;
            }
        } catch { }

        await sleep(250);
    }

    return false;
}

async function sendCurrentMessage(mobile, text) {
    const expected = String(text ?? '').trim();

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
        logStep(
            mobile,
            'SEND_ATTEMPT',
            `تلاش ارسال ${attempt} از ${MAX_SEND_ATTEMPTS}`
        );

        if (!(await focusMessageInput(mobile))) {
            logStep(mobile, 'MESSAGE_INPUT_RETRY', 'کادر پیام هنوز آماده نیست؛ قبل از تلاش بعدی صبر می‌کنیم.');
            await sleep(1000);
            continue;
        }

        try {
            const currentBefore = String(await getCurrentInputText() ?? '').trim();
            if (currentBefore) {
                await clearFocusedInput();
            }

            await insertMessageWithoutClipboard(text);

            const inserted = await waitUntilInputContains(expected, 5000);
            if (!inserted) {
                logFailure(
                    mobile,
                    'TEXT_INSERT_FAILED',
                    'متن با روش مستقیم داخل کادر پیام قرار نگرفت.',
                    `تلاش: ${attempt}`
                );
                await sleep(700);
                continue;
            }

            logStep(mobile, 'TEXT_INSERTED', 'متن با موفقیت داخل کادر پیام قرار گرفت.');

            await page.keyboard.press('Enter');

            const sent = await waitUntilInputEmpty(SEND_VERIFY_WAIT_MS);
            if (sent) {
                return true;
            }

            // اگر Enter اول به دلیل re-render یا focus نشدن درست عمل نکرد،
            // یک بار دیگر بعد از Focus مجدد امتحان می‌کنیم.
            logStep(
                mobile,
                'SEND_RETRY_ENTER',
                'بعد از Enter اول، کادر خالی نشد؛ Focus مجدد و Enter دوم انجام می‌شود.'
            );

            if (await focusMessageInput(mobile, 5000)) {
                const currentAfter = String(await getCurrentInputText() ?? '').trim();
                if (currentAfter === expected) {
                    await page.keyboard.press('Enter');
                    const sentSecond = await waitUntilInputEmpty(5000);
                    if (sentSecond) return true;
                } else if (currentAfter === '') {
                    return true;
                }
            }

            logStep(
                mobile,
                'SEND_NOT_CONFIRMED',
                'بعد از Enter متن هنوز داخل کادر است؛ ارسال دوباره انجام می‌شود.'
            );

            // قبل از تلاش بعدی، کادر را دوباره Focus می‌کنیم.
            await sleep(600);
        } catch (error) {
            logFailure(
                mobile,
                'SEND_ATTEMPT_ERROR',
                `تلاش ارسال ${attempt} با خطا مواجه شد.`,
                `جزئیات: ${error.message}`
            );
            await sleep(800);
        }
    }

    return false;
}

async function processUserActionInternal(mobile, text) {
    if (!page) {
        logFailure(mobile, 'BROWSER_NOT_READY', 'مرورگر هنوز راه‌اندازی نشده است.');
        return false;
    }

    const formattedMobile = formatMobileForLink(mobile);

    if (!formattedMobile) {
        logFailure(mobile, 'INVALID_MOBILE', 'فرمت شماره موبایل معتبر نیست؛ لینک Bale ساخته نشد.');
        return { success: false, permanentFailure: true, reason: 'INVALID_MOBILE' };
    }

    const landingUrl = `https://ble.ir/${formattedMobile}`;

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📨 شروع پردازش پیام | گیرنده: ${mobile}`);
    console.log(`🔢 شماره استاندارد: ${formattedMobile}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
        if (!(await isPageUsable())) {
            const recovered = await recoverBalePage('Page قبل از شروع پردازش کاربر قابل استفاده نبود');
            if (!recovered) {
                return { success: false, permanentFailure: false, reason: 'PAGE_UNAVAILABLE' };
            }
        }

        try {
            await page.bringToFront();
        } catch (error) {
            const recovered = await recoverBalePage(`bringToFront در شروع پردازش خطا داد: ${error.message}`);
            if (!recovered) {
                return { success: false, permanentFailure: false, reason: 'PAGE_UNAVAILABLE' };
            }
        }

        // 1. صفحه شماره
        logStep(mobile, 'OPEN_LANDING', `باز کردن صفحه: ${landingUrl}`);

        try {
            await page.goto(landingUrl, {
                waitUntil: 'domcontentloaded',
                timeout: PAGE_TIMEOUT
            });
        } catch (error) {
            logFailure(mobile, 'PAGE_ERROR', 'صفحه لندینگ شماره باز نشد.', `جزئیات: ${error.message}`);
            await returnToBaleHome();
            return false;
        }

        await sleep(LANDING_WAIT_MS);

        // 2. لینک چت
        logStep(mobile, 'FIND_CHAT', 'در حال بررسی وجود حساب بله و لینک چت...');

        let chatUrl = null;

        try {
            const started = Date.now();

            while (!chatUrl && Date.now() - started < 10000) {
                chatUrl = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));

                    for (const link of links) {
                        const textContent = String(link.textContent || '').trim();
                        const href = String(link.getAttribute('href') || '').trim();

                        if (
                            textContent.includes('مشاهده در وب بله') ||
                            href.includes('/chat?uid=')
                        ) {
                            if (href.startsWith('http')) return href;
                            if (href.startsWith('/')) return `https://web.bale.ai${href}`;
                        }
                    }

                    return null;
                });

                if (!chatUrl) await sleep(500);
            }
        } catch (error) {
            logFailure(mobile, 'PAGE_ERROR', 'در زمان بررسی لینک چت خطا رخ داد.', `جزئیات: ${error.message}`);
            await returnToBaleHome();
            return false;
        }

        if (!chatUrl) {
            logFailure(
                mobile,
                'CHAT_NOT_FOUND',
                'لینک چت پیدا نشد؛ حساب بله برای این شماره در دسترس نیست یا لندینگ کامل نشده است.',
                `URL: ${page.url()}`
            );
            await returnToBaleHome();
            return { success: false, permanentFailure: true, reason: 'CHAT_NOT_FOUND' };
        }

        logStep(mobile, 'CHAT_FOUND', `لینک چت پیدا شد: ${chatUrl}`);

        // 3. ورود به چت
        logStep(mobile, 'OPEN_CHAT', 'در حال باز کردن صفحه چت...');

        try {
            await page.goto(chatUrl, {
                waitUntil: 'domcontentloaded',
                timeout: PAGE_TIMEOUT
            });
        } catch (error) {
            logFailure(mobile, 'CHAT_NOT_OPENED', 'صفحه چت کاربر باز نشد.', `URL: ${chatUrl} | جزئیات: ${error.message}`);
            await returnToBaleHome();
            return false;
        }

        await sleep(CHAT_LOAD_WAIT_MS);
        await waitForPageSettled(1200);

        // نکته مهم بله: بعد از کلیک روی «مشاهده در وب بله» ممکن است ابتدا
        // URL به /chat برسد و چند لحظه بعد، اگر کاربر واقعاً حساب داشته باشد،
        // به /chat?uid=... تغییر کند. بنابراین /chat در همان لحظه اول به معنی
        // نداشتن حساب نیست؛ اول برای تکمیل Redirect صبر می‌کنیم.
        let finalChatUrl = page.url();
        const chatResolveStarted = Date.now();
        const chatResolveTimeout = 15000;

        while (Date.now() - chatResolveStarted < chatResolveTimeout) {
            finalChatUrl = page.url();

            if (/\/chat\?[^#]*\buid=\d+/i.test(finalChatUrl)) {
                break;
            }

            await sleep(500);
        }

        finalChatUrl = page.url();

        logStep(mobile, 'CHAT_LOADED', `صفحه چت بارگذاری شد. URL فعلی: ${finalChatUrl}`);

        // اگر بعد از کلیک روی «مشاهده در وب بله»، URL نهایی فقط /chat باشد
        // و هیچ uid نداشته باشد، یعنی چت اختصاصی این شماره ساخته/پیدا نشده است.
        // این حالت باید دائماً از صف کمپین حذف شود.
        const hasUserChatUid = /\/chat\?[^#]*\buid=\d+/i.test(finalChatUrl);
        const isGenericChatPage = /^https?:\/\/web\.bale\.ai\/chat(?:[?#](?:[^#]*))?$/i.test(finalChatUrl);

        if (!hasUserChatUid && isGenericChatPage) {
            logFailure(
                mobile,
                'BALE_ACCOUNT_NOT_FOUND',
                'بعد از کلیک روی «مشاهده در وب بله»، چت اختصاصی کاربر پیدا نشد و URL روی /chat باقی ماند؛ کاربر فاقد چت قابل‌دسترسی در بله تشخیص داده شد.',
                `URL نهایی: ${finalChatUrl}`
            );
            await returnToBaleHome();
            return {
                success: false,
                permanentFailure: true,
                reason: 'BALE_ACCOUNT_NOT_FOUND'
            };
        }

        // اگر URL اختصاصی /chat?uid=... نیست، هنوز نتیجه قطعی نداریم؛
        // در این حالت اجازه می‌دهیم بررسی کادر پیام مشخص کند که صفحه واقعاً چت است یا خیر.
        if (!hasUserChatUid) {
            logStep(
                mobile,
                'CHAT_URL_WAIT',
                `URL اختصاصی /chat?uid=... هنوز تأیید نشد؛ بررسی Render صفحه ادامه پیدا می‌کند. URL: ${finalChatUrl}`
            );
        }

        // لینک چت به‌تنهایی کافی نیست؛ خود صفحه چت باید واقعاً Render شده باشد.
        const chatReady = await focusMessageInput(mobile, 25000);

        if (!chatReady) {
            logFailure(mobile, 'CHAT_PAGE_NOT_READY', 'صفحه واقعی چت و کادر پیام بعد از Render شدن آماده نشد.', `URL: ${page.url()}`);
            await returnToBaleHome();
            return { success: false, permanentFailure: false, reason: 'CHAT_PAGE_NOT_READY' };
        }

        // مکث اضافه برای پایدار شدن DOM بله روی اینترنت ضعیف.
        await waitForPageSettled(1500);

        const sent = await sendCurrentMessage(mobile, text);

        if (!sent) {
            logFailure(mobile, 'SEND_FAILED', 'صفحه چت وجود دارد اما ارسال بعد از چند تلاش انجام نشد؛ خطا موقتی تلقی می‌شود.', `URL: ${page.url()}`);
            await returnToBaleHome();
            return { success: false, permanentFailure: false, reason: 'SEND_FAILED' };
        }

        logSuccess(mobile, 'پیام با موفقیت ارسال شد؛ کادر پیام بعد از ارسال خالی شد.');

        console.log(`📱 گیرنده: ${mobile}`);
        console.log(`🔢 شماره لینک: ${formattedMobile}`);
        console.log(`🔗 چت: ${chatUrl}`);
        console.log('📝 وضعیت: ارسال موفق و تأیید شد');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');

        return { success: true, permanentFailure: false, reason: 'SENT' };
    } catch (error) {
        logFailure(
            mobile,
            'UNKNOWN_ERROR',
            'خطای پیش‌بینی‌نشده در پردازش کاربر.',
            `نوع: ${error.name || 'Unknown'} | جزئیات: ${error.message}`
        );

        console.error('🧩 Stack:', error.stack || 'بدون stack');

        await returnToBaleHome();
        return { success: false, permanentFailure: false, reason: 'UNKNOWN_ERROR' };
    }
}

// همه ارسال‌ها روی یک Page مشترک، کاملاً صف‌بندی می‌شوند.
// بنابراین ارسال دستی/خودکار همزمان نمی‌تواند Focus یا صفحه کاربر بعدی را به هم بزند.
export const processUserAction = (mobile, text) => {
    const run = actionQueue.then(() => processUserActionInternal(mobile, text));

    actionQueue = run.catch(() => { });

    return run;
};
