import puppeteer from 'puppeteer';

let browser;
let page;

const BALE_HOME_URL = 'https://web.bale.ai';
const PAGE_TIMEOUT = 30000;
const CHAT_LOAD_WAIT_MS = 6000;
const LANDING_WAIT_MS = 2000;

export const initBaleBrowser = async () => {
    console.log('🌐 Starting Puppeteer browser...');

    browser = await puppeteer.launch({
        headless: false,
        executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        userDataDir: './bale_session',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log('🔄 Loading Bale Web...');

    await page.goto(BALE_HOME_URL, {
        waitUntil: 'networkidle2',
        timeout: PAGE_TIMEOUT
    });

    console.log('✅ Browser ready!');
};

// تبدیل شماره‌های مختلف به فرمت استاندارد لینک بله
// خروجی نهایی همیشه به شکل 989xxxxxxxxx خواهد بود.
function formatMobileForLink(mobile) {
    let raw = String(mobile ?? '')
        .trim()
        .split(/\||,|;/)[0]
        .trim();

    // اعداد فارسی و عربی را به انگلیسی تبدیل می‌کنیم.
    raw = raw
        .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

    // اگر Excel مقدار را به شکل 989...0 یا 989....0 داده باشد، بخش اعشاری حذف شود.
    raw = raw.replace(/\.0+$/, '');

    // فقط رقم‌ها باقی بمانند؛ +، فاصله، پرانتز و خط تیره حذف می‌شوند.
    let digits = raw.replace(/\D/g, '');

    // همه صفرهای ابتدای شماره حذف می‌شوند تا 09...، 0098... و 00098... هم درست شوند.
    digits = digits.replace(/^0+/, '');

    // اگر بعد از پاک‌سازی با 98 شروع شده، همان را نگه می‌داریم.
    if (digits.startsWith('98')) {
        // intentionally unchanged
    }
    // شماره موبایل ایران که با 9 شروع می‌شود => 98 + 9...
    else if (digits.startsWith('9')) {
        digits = '98' + digits;
    }
    // هر فرم غیرمنتظره‌ای را نامعتبر اعلام می‌کنیم.
    else {
        return null;
    }

    // برای موبایل ایران باید دقیقاً 98 + 10 رقم موبایل داشته باشیم.
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

async function returnToBaleHome() {
    if (!page) return;

    try {
        await page.goto(BALE_HOME_URL, {
            waitUntil: 'domcontentloaded',
            timeout: PAGE_TIMEOUT
        });

        await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (error) {
        console.error(
            `⚠️ [HOME_NAVIGATION_FAILED] | ${error.message}`
        );
    }
}

export const processUserAction = async (mobile, text) => {
    if (!page) {
        logFailure(
            mobile,
            'BROWSER_NOT_READY',
            'مرورگر هنوز راه‌اندازی نشده است.'
        );
        return false;
    }

    const formattedMobile = formatMobileForLink(mobile);

    if (!formattedMobile) {
        logFailure(
            mobile,
            'INVALID_MOBILE',
            'فرمت شماره موبایل معتبر نیست؛ لینک Bale ساخته نشد.'
        );
        return false;
    }

    const landingUrl = `https://ble.ir/${formattedMobile}`;

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📨 شروع پردازش پیام | گیرنده: ${mobile}`);
    console.log(`🔢 شماره استاندارد: ${formattedMobile}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
        // 1. باز کردن صفحه لندینگ شماره
        logStep(
            mobile,
            'OPEN_LANDING',
            `باز کردن صفحه: ${landingUrl}`
        );

        try {
            await page.goto(landingUrl, {
                waitUntil: 'domcontentloaded',
                timeout: PAGE_TIMEOUT
            });
        } catch (error) {
            logFailure(
                mobile,
                'PAGE_ERROR',
                'صفحه لندینگ شماره باز نشد.',
                `جزئیات: ${error.message}`
            );

            await returnToBaleHome();
            return false;
        }

        await new Promise(resolve => setTimeout(resolve, LANDING_WAIT_MS));

        logStep(
            mobile,
            'LANDING_LOADED',
            `صفحه لندینگ با آدرس فعلی: ${page.url()}`
        );

        // 2. پیدا کردن لینک «مشاهده در وب بله»
        logStep(
            mobile,
            'FIND_CHAT',
            'در حال بررسی وجود حساب بله و لینک چت...'
        );

        let chatUrl = null;

        try {
            chatUrl = await page.evaluate(() => {
                const links = document.querySelectorAll('a');

                for (const link of links) {
                    const textContent = link.textContent || '';
                    const href = link.getAttribute('href') || '';

                    if (
                        textContent.includes('مشاهده در وب بله') ||
                        href.includes('/chat?uid=')
                    ) {
                        if (href.startsWith('http')) {
                            return href;
                        }

                        return `https://web.bale.ai${href}`;
                    }
                }

                return null;
            });
        } catch (error) {
            logFailure(
                mobile,
                'PAGE_ERROR',
                'در زمان بررسی لینک چت خطا رخ داد.',
                `جزئیات: ${error.message}`
            );

            await returnToBaleHome();
            return false;
        }

        // اگر لینک چت پیدا نشد، حساب بله برای این شماره قابل دسترسی نیست
        if (!chatUrl) {
            logFailure(
                mobile,
                'CHAT_NOT_FOUND',
                'لینک چت پیدا نشد؛ کاربر حساب بله ندارد یا صفحه چت برای این شماره در دسترس نیست.',
                `URL: ${page.url()}`
            );

            await returnToBaleHome();
            return false;
        }

        logStep(
            mobile,
            'CHAT_FOUND',
            `لینک چت پیدا شد: ${chatUrl}`
        );

        // 3. باز کردن مستقیم صفحه چت
        logStep(
            mobile,
            'OPEN_CHAT',
            'در حال باز کردن صفحه چت...'
        );

        try {
            await page.goto(chatUrl, {
                waitUntil: 'domcontentloaded',
                timeout: PAGE_TIMEOUT
            });
        } catch (error) {
            logFailure(
                mobile,
                'CHAT_NOT_OPENED',
                'صفحه چت کاربر باز نشد.',
                `URL: ${chatUrl} | جزئیات: ${error.message}`
            );

            await returnToBaleHome();
            return false;
        }

        await new Promise(resolve => setTimeout(resolve, CHAT_LOAD_WAIT_MS));

        logStep(
            mobile,
            'CHAT_LOADED',
            `صفحه چت بارگذاری شد. URL فعلی: ${page.url()}`
        );

        // 4. پیدا کردن کادر پیام
        logStep(
            mobile,
            'FIND_MESSAGE_INPUT',
            'در حال پیدا کردن کادر پیام...'
        );

        let isInputFound = false;

        for (let attempt = 1; attempt <= 5; attempt++) {
            try {
                isInputFound = await page.evaluate(() => {
                    const elements = document.querySelectorAll(
                        'textarea, input[type="text"], div[contenteditable="true"]'
                    );

                    for (const el of elements) {
                        const placeholder =
                            el.getAttribute('placeholder') || '';

                        const ariaLabel =
                            el.getAttribute('aria-label') || '';

                        if (
                            placeholder.includes('پیام') ||
                            ariaLabel.includes('پیام') ||
                            el.classList.contains('Ke4mfC') ||
                            el.getAttribute('contenteditable') === 'true'
                        ) {
                            el.focus();
                            return true;
                        }
                    }

                    return false;
                });
            } catch (error) {
                logFailure(
                    mobile,
                    'PAGE_ERROR',
                    `در تلاش شماره ${attempt} برای پیدا کردن کادر پیام خطا رخ داد.`,
                    `جزئیات: ${error.message}`
                );
            }

            if (isInputFound) {
                logStep(
                    mobile,
                    'MESSAGE_INPUT_FOUND',
                    `کادر پیام در تلاش شماره ${attempt} پیدا شد.`
                );
                break;
            }

            logStep(
                mobile,
                'MESSAGE_INPUT_WAIT',
                `کادر پیام در تلاش ${attempt} پیدا نشد؛ یک ثانیه دیگر بررسی می‌شود.`
            );

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (!isInputFound) {
            logFailure(
                mobile,
                'MESSAGE_INPUT_NOT_FOUND',
                'کادر پیام بعد از ۵ تلاش پیدا نشد؛ ارسال انجام نشد.',
                `URL: ${page.url()}`
            );

            await returnToBaleHome();
            return false;
        }

        // 5. فوکوس روی کادر پیام
        logStep(
            mobile,
            'FOCUS_INPUT',
            'در حال فوکوس روی کادر پیام...'
        );

        try {
            await page.evaluate(() => {
                const activeEl = document.activeElement;

                if (activeEl) {
                    activeEl.click();
                }
            });
        } catch (error) {
            logFailure(
                mobile,
                'PAGE_ERROR',
                'فوکوس روی کادر پیام انجام نشد.',
                `جزئیات: ${error.message}`
            );

            await returnToBaleHome();
            return false;
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        // 6. قرار دادن متن در Clipboard
        logStep(
            mobile,
            'COPY_MESSAGE',
            `در حال آماده‌سازی پیام برای ارسال؛ طول متن: ${String(text).length} کاراکتر`
        );

        try {
            await page.evaluate(async textToCopy => {
                await navigator.clipboard.writeText(textToCopy);
            }, text);
        } catch (error) {
            logFailure(
                mobile,
                'CLIPBOARD_ERROR',
                'کپی متن در Clipboard انجام نشد.',
                `جزئیات: ${error.message}`
            );

            await returnToBaleHome();
            return false;
        }

        // 7. Paste
        logStep(
            mobile,
            'PASTE_MESSAGE',
            'در حال Paste کردن متن در کادر پیام...'
        );

        try {
            const modifier =
                process.platform === 'darwin' ? 'Meta' : 'Control';

            await page.keyboard.down(modifier);
            await page.keyboard.press('KeyV');
            await page.keyboard.up(modifier);
        } catch (error) {
            logFailure(
                mobile,
                'PASTE_FAILED',
                'Paste کردن پیام انجام نشد.',
                `جزئیات: ${error.message}`
            );

            await returnToBaleHome();
            return false;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        // 8. ارسال نهایی + بررسی واقعی ارسال
        logStep(
            mobile,
            'SEND_MESSAGE',
            'در حال ارسال نهایی پیام با Enter...'
        );

        try {
            await page.keyboard.press('Enter');
        } catch (error) {
            logFailure(
                mobile,
                'SEND_FAILED',
                'فشردن Enter برای ارسال پیام با خطا مواجه شد.',
                `جزئیات: ${error.message}`
            );

            await returnToBaleHome();
            return false;
        }

        // اجازه می‌دهیم Bale پیام را پردازش کند.
        await new Promise(resolve => setTimeout(resolve, 2500));

        // صرفاً فشردن Enter به معنی ارسال موفق نیست.
        // بررسی می‌کنیم متن هنوز داخل کادر پیام باقی مانده یا خیر.
        let inputStillContainsMessage = false;

        try {
            inputStillContainsMessage = await page.evaluate(expectedText => {
                const elements = document.querySelectorAll(
                    'textarea, input[type="text"], div[contenteditable="true"]'
                );

                for (const el of elements) {
                    const placeholder = el.getAttribute('placeholder') || '';
                    const ariaLabel = el.getAttribute('aria-label') || '';
                    const isMessageInput =
                        placeholder.includes('پیام') ||
                        ariaLabel.includes('پیام') ||
                        el.classList.contains('Ke4mfC') ||
                        el.getAttribute('contenteditable') === 'true';

                    if (!isMessageInput) continue;

                    const currentText =
                        'value' in el
                            ? String(el.value || '')
                            : String(el.innerText || el.textContent || '');

                    return currentText.trim() === String(expectedText || '').trim();
                }

                return false;
            }, text);
        } catch (error) {
            logFailure(
                mobile,
                'SEND_VERIFY_ERROR',
                'در بررسی نتیجه ارسال خطا رخ داد.',
                `جزئیات: ${error.message}`
            );
        }

        if (inputStillContainsMessage) {
            // یک بار دیگر تلاش می‌کنیم؛ اگر هنوز متن در کادر بود، ارسال ناموفق است.
            logStep(
                mobile,
                'SEND_RETRY',
                'متن هنوز در کادر پیام است؛ تلاش دوم برای ارسال...'
            );

            try {
                await page.keyboard.press('Enter');
                await new Promise(resolve => setTimeout(resolve, 2500));
            } catch (error) {
                logFailure(
                    mobile,
                    'SEND_FAILED',
                    'تلاش دوم برای ارسال پیام با خطا مواجه شد.',
                    `جزئیات: ${error.message}`
                );
            }

            try {
                inputStillContainsMessage = await page.evaluate(expectedText => {
                    const elements = document.querySelectorAll(
                        'textarea, input[type="text"], div[contenteditable="true"]'
                    );

                    for (const el of elements) {
                        const placeholder = el.getAttribute('placeholder') || '';
                        const ariaLabel = el.getAttribute('aria-label') || '';
                        const isMessageInput =
                            placeholder.includes('پیام') ||
                            ariaLabel.includes('پیام') ||
                            el.classList.contains('Ke4mfC') ||
                            el.getAttribute('contenteditable') === 'true';

                        if (!isMessageInput) continue;

                        const currentText =
                            'value' in el
                                ? String(el.value || '')
                                : String(el.innerText || el.textContent || '');

                        return currentText.trim() === String(expectedText || '').trim();
                    }

                    return false;
                }, text);
            } catch {
                // اگر بعد از ارسال کادر دیگر پیدا نشد، فرض را بر این می‌گذاریم که ارسال انجام شده است.
                inputStillContainsMessage = false;
            }
        }

        if (inputStillContainsMessage) {
            logFailure(
                mobile,
                'SEND_FAILED',
                'پیام بعد از دو تلاش هنوز داخل کادر باقی مانده و ارسال تأیید نشد.',
                `URL: ${page.url()}`
            );

            await returnToBaleHome();
            return false;
        }

        logSuccess(
            mobile,
            'پیام با موفقیت ارسال و از کادر پیام خارج شد.'
        );

        console.log(`📱 گیرنده: ${mobile}`);
        console.log(`🔢 شماره لینک: ${formattedMobile}`);
        console.log(`🔗 چت: ${chatUrl}`);
        console.log(`📝 وضعیت: ارسال موفق و تأیید شد`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');

        return true;

    } catch (error) {
        logFailure(
            mobile,
            'UNKNOWN_ERROR',
            'خطای پیش‌بینی‌نشده در پردازش کاربر.',
            `نوع: ${error.name || 'Unknown'} | جزئیات: ${error.message}`
        );

        console.error('🧩 Stack:', error.stack || 'بدون stack');

        await returnToBaleHome();

        return false;
    }
};
