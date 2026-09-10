import puppeteer from 'puppeteer';

let browser;
let page;

export const initBaleBrowser = async () => {
    console.log('🌐 Starting Puppeteer browser...');
    browser = await puppeteer.launch({
        headless: false,
        // دقت کنید که مسیر مرورگرتان را مانند قبل (با اسلش رو به جلو) تنظیم کنید
        executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        userDataDir: './bale_session',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log('🔄 Loading Bale Web...');
    await page.goto('https://web.bale.ai', { waitUntil: 'networkidle2' });
    console.log('✅ Browser ready!');
};

// تابع تبدیل شماره‌های مختلف به فرمت استاندارد لینک بله
function formatMobileForLink(mobile) {
    // ۱. اگر چند شماره با علامت | یا ویرگول یا خط تیره کنار هم بودند، فقط اولی را بردار
    let firstMobile = mobile.split(/\||,|-/)[0];

    // ۲. حذف فاصله‌ها و علامت + از همان شماره اول
    let clean = firstMobile.replace(/\D/g, '');

    // ۳. استانداردسازی پیش‌شماره (تبدیل به فرمت 98)
    if (clean.startsWith('0')) clean = '98' + clean.substring(1);
    if (!clean.startsWith('98')) clean = '98' + clean;

    return clean;
}

export const processUserAction = async (mobile, text) => {
    if (!page) throw new Error('مرورگر هنوز راه‌اندازی نشده است!');

    try {
        const formattedMobile = formatMobileForLink(mobile);
        const landingUrl = `https://ble.ir/${formattedMobile}`;

        console.log(`🤖 بررسی شماره: ${mobile}`);

        // ۱. باز کردن صفحه لندینگ شماره در تب فعلی
        await page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));

        // ۲. استخراج آدرس لینک دکمه "مشاهده در وب بله" بدون کلیک کردن (تا تب جدید باز نشود)
        const chatUrl = await page.evaluate(() => {
            const links = document.querySelectorAll('a');
            for (let link of links) {
                const textContent = link.textContent || '';
                const href = link.getAttribute('href') || '';
                // پیدا کردن لینکی که مربوط به ورود به چت است
                if (textContent.includes('مشاهده در وب بله') || href.includes('/chat?uid=')) {
                    return href.startsWith('http') ? href : `https://web.bale.ai${href}`;
                }
            }
            return null;
        });

        // اگر لینک پیدا نشد یعنی کاربر حساب بله ندارد
        if (!chatUrl) {
            console.log(`⚠️ کاربر با شماره ${mobile} حساب بله ندارد. عبور به کاربر بعدی...`);
            await page.goto('https://web.bale.ai', { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 2000));
            return true;
        }

        console.log(`🔗 هدایت دقیقِ همین تب به آدرس چت: ${chatUrl}`);

        // ۳. باز کردن آدرس چت مستقیماً در همین تب (بدون باز شدن تب بلنک یا جدید)
        await page.goto(chatUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // مکث کافی برای لود کامل صفحه چت کاربر
        await new Promise(r => setTimeout(r, 6000));

        // ۴. پیدا کردن کادر پیام و ارسال متن
        let isInputFound = false;
        for (let attempt = 1; attempt <= 5; attempt++) {
            isInputFound = await page.evaluate(() => {
                const elements = document.querySelectorAll('textarea, input[type="text"], div[contenteditable="true"]');
                for (let el of elements) {
                    const placeholder = el.getAttribute('placeholder') || '';
                    const ariaLabel = el.getAttribute('aria-label') || '';
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

            if (isInputFound) break;
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!isInputFound) {
            console.log(`⚠️ کادر پیام برای شماره ${mobile} پیدا نشد. عبور...`);
            await page.goto('https://web.bale.ai', { waitUntil: 'domcontentloaded' });
            return true;
        }

        // ۵. تایپ و ارسال پیام
        await new Promise(r => setTimeout(r, 500));
        await page.keyboard.type(text);
        await new Promise(r => setTimeout(r, 800));
        await page.keyboard.press('Enter');

        await new Promise(r => setTimeout(r, 3000));

        console.log(`✅ پیام با موفقیت به ${mobile} ارسال شد.`);
        return true;

    } catch (error) {
        console.error(`❌ خطا در پردازش شماره ${mobile}:`, error.message);
        try {
            await page.goto('https://web.bale.ai', { waitUntil: 'domcontentloaded' });
        } catch (e) { }
        return false;
    }
};