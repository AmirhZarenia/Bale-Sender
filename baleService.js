import fs from 'node:fs/promises';
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
    try { await page.context().overridePermissions(BALE_HOME_URL, ['clipboard-read', 'clipboard-write']); } catch (error) { console.warn(`⚠️ اجازه Clipboard فعال نشد: ${error.message}`); }
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

async function focusMessageInput(mobile, timeout = INPUT_WAIT_MS, purpose = 'MESSAGE') {
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
                    logStep(mobile, purpose === 'IMAGE' ? 'IMAGE_INPUT_READY' : 'MESSAGE_INPUT_FOUND', purpose === 'IMAGE' ? 'کادر چت برای Paste عکس آماده شد.' : 'کادر واقعی و قابل‌استفاده پیام پیدا و Focus شد.');
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

async function sendCurrentImage(mobile, imagePath, caption = '') {
    try {
        // اگر کپشن وجود داشته باشد، در کادر توضیحاتِ پیش‌نمایش عکس قرار می‌گیرد تا عکس و متن یک پیام باشند.
        const imageBuffer = await fs.readFile(imagePath);
        const base64 = imageBuffer.toString('base64');
        const ext = String(imagePath).toLowerCase().split('.').pop();
        const sourceMime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';

        const clipboardReady = await page.evaluate(async ({ base64, sourceMime }) => {
            try {
                const img = new Image();
                img.src = `data:${sourceMime};base64,${base64}`;
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = () => reject(new Error('مرورگر نتوانست فایل تصویر را باز کند.'));
                });
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                if (!canvas.width || !canvas.height) throw new Error('ابعاد تصویر معتبر نیست.');
                canvas.getContext('2d').drawImage(img, 0, 0);
                const pngBlob = await new Promise((resolve, reject) => {
                    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('تبدیل تصویر به PNG ناموفق بود.')), 'image/png');
                });
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
                return { ok: true, width: canvas.width, height: canvas.height };
            } catch (error) {
                return { ok: false, error: String(error?.message || error) };
            }
        }, { base64, sourceMime });

        if (!clipboardReady?.ok) throw new Error(`کپی تصویر در Clipboard ممکن نشد: ${clipboardReady?.error || 'خطای نامشخص'}`);
        logStep(mobile, 'IMAGE_CLIPBOARD_READY', `تصویر در Clipboard قرار گرفت (${clipboardReady.width}×${clipboardReady.height}).`);

        if (!(await focusMessageInput(mobile, 8000, 'IMAGE'))) throw new Error('کادر چت برای Paste تصویر پیدا نشد.');

        const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
        await page.keyboard.down(modifier);
        try {
            await page.keyboard.press('V');
        } finally {
            await page.keyboard.up(modifier);
        }
        await sleep(1600);

        // متن توضیحات را داخل کادر کپشنِ پنجره پیش‌نمایش عکس وارد می‌کنیم؛
        // نباید آن را در کادر پیام چت یا به‌صورت پیام جداگانه ارسال کنیم.
        const captionText = String(caption ?? '').trim();
        if (captionText) {
            const captionField = await page.evaluate(() => {
                const visible = el => {
                    if (!el) return false;
                    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
                    return r.width > 5 && r.height > 5 && st.display !== 'none' &&
                        st.visibility !== 'hidden' && Number(st.opacity || 1) > 0 &&
                        el.getAttribute('aria-hidden') !== 'true';
                };
                const dialogs = [...document.querySelectorAll(
                    '[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="Modal" i]'
                )].filter(visible);
                const root = dialogs.find(el => {
                    const t = String(el.innerText || '').toLowerCase();
                    return /عکس|تصویر|photo|image/.test(t) || el.querySelector('img, [data-testid*="media" i]');
                }) || dialogs[dialogs.length - 1];
                if (!root) return { ok: false, reason: 'PREVIEW_DIALOG_NOT_FOUND' };
                const fields = [...root.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"]')]
                    .filter(visible);
                const field = fields.find(el => {
                    const hint = [el.getAttribute('placeholder'), el.getAttribute('aria-label'),
                    el.getAttribute('data-placeholder'), el.getAttribute('title'),
                    el.getAttribute('name')].filter(Boolean).join(' ').toLowerCase();
                    return /توضیحات|توضیح|شرح|caption|description|اضافه کردن متن|add a caption/.test(hint);
                });
                if (!field) return { ok: false, reason: 'CAPTION_FIELD_NOT_FOUND', candidates: fields.length };
                field.scrollIntoView({ block: 'center', inline: 'center' });
                field.focus();
                field.click();
                return { ok: true, tag: field.tagName, editable: field.getAttribute('contenteditable') === 'true' };
            });

            if (!captionField?.ok) {
                throw new Error(`کادر توضیحات عکس پیدا نشد؛ ارسال متوقف شد تا متن جداگانه ارسال نشود. علت: ${captionField?.reason || 'UNKNOWN'}، کادرهای بررسی‌شده: ${captionField?.candidates ?? 0}`);
            }

            // فقط روش ورود کپشن تغییر کرده: متن در Clipboard کپی و داخل همان کادر Paste می‌شود.
            await page.evaluate(async text => {
                await navigator.clipboard.writeText(text);
            }, captionText);

            const captionModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
            await page.keyboard.down(captionModifier);
            try {
                await page.keyboard.press('V');
            } finally {
                await page.keyboard.up(captionModifier);
            }
            await sleep(350);

            const captionVerified = await page.evaluate(expected => {
                const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
                const wanted = normalize(expected);
                const visible = el => {
                    if (!el) return false;
                    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
                    return r.width > 5 && r.height > 5 && st.display !== 'none' &&
                        st.visibility !== 'hidden' && Number(st.opacity || 1) > 0 &&
                        el.getAttribute('aria-hidden') !== 'true';
                };
                const readValue = el => {
                    if (!el) return '';
                    if ('value' in el && el.value != null) return String(el.value);
                    return String(el.innerText || el.textContent || '');
                };
                const matches = el => normalize(readValue(el)).includes(wanted);

                // ابتدا خود کادری را بررسی می‌کنیم که Paste در آن انجام شده است؛
                // بعضی نسخه‌های رابط بله کپشن را بیرون از role=dialog یا بدون placeholder مشخص می‌سازند.
                const active = document.activeElement;
                if (visible(active) && matches(active)) return true;

                // سپس همه کادرهای قابل‌مشاهده را بررسی می‌کنیم؛ وابسته به نام placeholder یا ساختار پنجره نیستیم.
                const fields = [...document.querySelectorAll(
                    'textarea,input,[contenteditable="true"],[role="textbox"]'
                )].filter(visible);
                return fields.some(matches);
            }, captionText);

            if (!captionVerified) throw new Error('متن در کادر توضیحات عکس قرار نگرفت؛ ارسال عکس انجام نشد.');
            logStep(mobile, 'IMAGE_CAPTION_FILLED', 'متن توضیحات داخل پیش‌نمایش عکس قرار گرفت؛ عکس و متن با یک ارسال فرستاده می‌شوند.');
        }

        // دکمه و پنجره در یک ارزیابی پیدا می‌شوند تا index یا عنصر اشتباه کلیک نشود.
        const clickResult = await page.evaluate(() => {
            const visible = el => {
                if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
                const r = el.getBoundingClientRect();
                const st = getComputedStyle(el);
                return r.width > 5 && r.height > 5 && st.display !== 'none' &&
                    st.visibility !== 'hidden' && Number(st.opacity || 1) > 0 &&
                    el.getAttribute('aria-hidden') !== 'true';
            };
            const dialogs = [...document.querySelectorAll(
                '[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="Modal" i]'
            )].filter(visible);
            const root = dialogs.find(el => {
                const t = String(el.innerText || '').toLowerCase();
                return /عکس|تصویر|photo|image/.test(t) || el.querySelector('img, [data-testid*="media" i]');
            }) || dialogs[dialogs.length - 1];
            if (!root) return { ok: false, reason: 'PREVIEW_DIALOG_NOT_FOUND', dialogs: dialogs.length };

            const buttons = [...root.querySelectorAll('button,[role="button"]')].filter(visible);
            const label = el => [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title'),
            el.getAttribute('data-testid'), el.getAttribute('data-tooltip')]
                .filter(Boolean).join(' ').trim().toLowerCase();
            let button = buttons.find(el => /ارسال|فرستادن|send|submit/.test(label(el)));
            if (!button && buttons.length) button = buttons[buttons.length - 1];
            if (!button) return { ok: false, reason: 'SEND_BUTTON_NOT_FOUND', dialogs: dialogs.length };

            button.scrollIntoView({ block: 'center', inline: 'center' });
            button.click();
            return { ok: true, buttonLabel: label(button) || '(دکمه آیکونی)', dialogText: String(root.innerText || '').slice(0, 180) };
        });

        if (!clickResult?.ok) {
            throw new Error(`کلیک دکمه ارسال عکس انجام نشد: ${clickResult?.reason || 'UNKNOWN'} (پنجره‌ها: ${clickResult?.dialogs ?? 0})`);
        }
        logStep(mobile, 'IMAGE_SEND_BUTTON_CLICKED', `دکمه ارسال عکس کلیک شد: ${clickResult.buttonLabel}`);

        // فقط وقتی پنجره پیش‌نمایش بسته شود، ارسال از سمت رابط کاربری تأییدشده محسوب می‌شود.
        let previewClosed = false;
        const verifyStarted = Date.now();
        while (Date.now() - verifyStarted < 8000) {
            previewClosed = await page.evaluate(() => {
                const visible = el => {
                    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
                    return r.width > 5 && r.height > 5 && st.display !== 'none' &&
                        st.visibility !== 'hidden' && Number(st.opacity || 1) > 0 &&
                        el.getAttribute('aria-hidden') !== 'true';
                };
                const dialogs = [...document.querySelectorAll(
                    '[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="Modal" i]'
                )].filter(visible);
                const preview = dialogs.find(el => /عکس|تصویر|photo|image/i.test(String(el.innerText || '')) || el.querySelector('img'));
                return !preview;
            });
            if (previewClosed) break;
            await sleep(300);
        }

        if (!previewClosed) throw new Error('دکمه کلیک شد، اما پنجره پیش‌نمایش بسته نشد؛ ارسال عکس تأیید نشد.');

        logSuccess(mobile, 'ارسال عکس از رابط کاربری تأیید شد؛ پنجره پیش‌نمایش بسته شد.');

        return true;
    } catch (error) {
        logFailure(mobile, 'IMAGE_SEND_FAILED', 'ارسال عکس تأیید نشد.', error.message);
        return false;
    }
}

async function processUserActionInternal(mobile, text, imagePath = null) {
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
    console.log(`📨 شروع پردازش ${imagePath ? 'عکس' : 'پیام'} | گیرنده: ${mobile}`);
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
        const chatReady = await focusMessageInput(mobile, 25000, imagePath ? 'IMAGE' : 'MESSAGE');

        if (!chatReady) {
            logFailure(mobile, 'CHAT_PAGE_NOT_READY', imagePath ? 'صفحه چت برای ارسال عکس آماده نشد.' : 'صفحه واقعی چت و کادر پیام بعد از Render شدن آماده نشد.', `URL: ${page.url()}`);
            await returnToBaleHome();
            return { success: false, permanentFailure: false, reason: 'CHAT_PAGE_NOT_READY' };
        }

        // مکث اضافه برای پایدار شدن DOM بله روی اینترنت ضعیف.
        await waitForPageSettled(1500);

        const sent = imagePath
            ? await sendCurrentImage(mobile, imagePath, text)
            : await sendCurrentMessage(mobile, text);

        if (!sent) {
            const failureReason = imagePath ? 'IMAGE_SEND_FAILED' : 'SEND_FAILED';
            logFailure(mobile, failureReason, imagePath ? 'ارسال عکس تأیید نشد؛ مورد برای بررسی/تلاش مجدد ناموفق برمی‌گردد.' : 'ارسال پیام بعد از چند تلاش انجام نشد؛ خطا موقتی تلقی می‌شود.', `URL: ${page.url()}`);
            await returnToBaleHome();
            return { success: false, permanentFailure: false, reason: failureReason };
        }

        logSuccess(mobile, imagePath ? 'عکس با موفقیت از رابط کاربری ارسال شد.' : 'پیام با موفقیت ارسال شد؛ کادر پیام بعد از ارسال خالی شد.');

        console.log(`📱 گیرنده: ${mobile}`);
        console.log(`🔢 شماره لینک: ${formattedMobile}`);
        console.log(`🔗 چت: ${chatUrl}`);
        console.log(`📝 وضعیت: ${imagePath ? 'ارسال عکس تأیید شد' : 'ارسال پیام موفق و تأیید شد'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');

        return { success: true, permanentFailure: false, reason: imagePath ? 'IMAGE_SENT' : 'SENT' };
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

export const processUserImageAction = (mobile, imagePath, caption = '') => {
    const run = actionQueue.then(() => processUserActionInternal(mobile, caption, imagePath));
    actionQueue = run.catch(() => { });
    return run;
};
