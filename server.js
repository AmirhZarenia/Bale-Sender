import express from 'express';
import mongoose from 'mongoose';
import cron from 'node-cron';
import dotenv from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import xlsx from 'xlsx';

import User from './models/User.js';
import Message from './models/Message.js';
import Campaign from './models/Campaign.js';

import { initBaleBrowser, processUserAction } from './baleService.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// تنظیمات Multer برای دریافت فایل به صورت مستقیم در رم (حافظه موقت)
const upload = multer({ storage: multer.memoryStorage() });

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB');
        initBaleBrowser();
    })
    .catch(err => console.error('❌ MongoDB connection error:', err));


// ==========================================
// 🛣️ API Routes
// ==========================================

// ۱. آپلود مستقیم فایل اکسل
app.post('/api/users/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'هیچ فایلی ارسال نشده است.' });
        }

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        const newUsers = [];
        const memoryMobiles = new Set();
        let duplicateCount = 0;

        for (const row of sheetData) {
            const mobile = row['تلفن همراه'] ? String(row['تلفن همراه']).trim() : null;
            const businessName = row['نام کسب‌وکار'] || 'نامشخص';

            if (mobile) {
                if (memoryMobiles.has(mobile)) {
                    duplicateCount++;
                    continue;
                }

                // در بخش آپلود اکسل، این قسمت را پیدا کنید:
                const exists = await User.findOne({ mobile: mobile });
                if (!exists) {
                    newUsers.push({
                        businessName,
                        mobile,
                        status: 'pending'
                    });
                    memoryMobiles.add(mobile);
                }
            }
        }

        if (newUsers.length > 0) {
            await User.insertMany(newUsers);
        }

        res.status(201).json({
            success: true,
            message: 'فایل با موفقیت آپلود و پردازش شد.',
            added: newUsers.length,
            duplicatesIgnored: duplicateCount
        });

    } catch (error) {
        console.error('Excel Upload Error:', error);
        res.status(500).json({ success: false, error: 'خطا در پردازش فایل اکسل.' });
    }
});

// ۲. دریافت لیست کاربران
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 });
        res.json({ success: true, count: users.length, data: users });
    } catch (error) {
        res.status(500).json({ error: 'خطا در دریافت کاربران' });
    }
});

// ۳. ایجاد پیام جدید (با قابلیت تعیین نوع normal یا festival)
app.post('/api/messages', async (req, res) => {
    try {
        const { text, type } = req.body;
        if (!text || !type) return res.status(400).json({ error: 'متن پیام و نوع آن الزامی است.' });

        const newMessage = await Message.create({ text, type });
        res.status(201).json({ success: true, data: newMessage });
    } catch (error) {
        res.status(500).json({ error: 'خطا در ثبت پیام' });
    }
});

// ۴. دریافت لیست پیام‌ها
app.get('/api/messages', async (req, res) => {
    try {
        const messages = await Message.find().sort({ createdAt: -1 });
        res.json({ success: true, count: messages.length, data: messages });
    } catch (error) {
        res.status(500).json({ error: 'خطا در دریافت پیام‌ها' });
    }
});

// ۵. ساخت کمپین جدید
app.post('/api/campaigns/create', async (req, res) => {
    try {
        const { title, type } = req.body;
        const campaign = new Campaign({ title, type });
        await campaign.save();
        res.status(201).json({ success: true, campaign });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ۶. استارت / ادامه دادن کمپین
app.post('/api/campaigns/:id/start', async (req, res) => {
    try {
        const campaign = await Campaign.findById(req.params.id);
        if (!campaign) return res.status(404).json({ error: 'کمپین یافت نشد' });

        campaign.status = 'running';
        await campaign.save();

        runCampaignWorker(campaign._id);

        res.json({ success: true, message: 'کمپین شروع شد', campaign });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ۷. توقف موقت یا لغو کمپین
app.post('/api/campaigns/:id/stop', async (req, res) => {
    try {
        const { status } = req.body; // می‌تونه 'paused' یا 'cancelled' باشه
        const campaign = await Campaign.findById(req.params.id);
        if (!campaign) return res.status(404).json({ error: 'کمپین یافت نشد' });

        campaign.status = status || 'paused';
        await campaign.save();

        res.json({ success: true, message: `وضعیت کمپین تغییر کرد به: ${campaign.status}`, campaign });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ۸. حذف کمپین
app.delete('/api/campaigns/:id', async (req, res) => {
    try {
        await Campaign.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'کمپین با موفقیت حذف شد' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// دریافت اطلاعات کامل و وضعیت یک کمپین
app.get('/api/campaigns/:id/status', async (req, res) => {
    try {
        const campaign = await Campaign.findById(req.params.id);
        if (!campaign) {
            return res.status(404).json({ success: false, error: 'کمپین مورد نظر یافت نشد.' });
        }

        // آمارگیری از وضعیت کاربران در دیتابیس برای این کمپین یا کل صف
        const totalUsers = await User.countDocuments({ isActive: true });
        const sentUsers = await User.countDocuments({ status: 'sent', isActive: true });
        const pendingUsers = await User.countDocuments({ status: 'pending', isActive: true });

        res.json({
            success: true,
            data: {
                campaignId: campaign._id,
                title: campaign.title,
                type: campaign.type,
                status: campaign.status, // مثل running, paused, completed, cancelled, idle
                totalSent: campaign.totalSent,
                stats: {
                    totalUsers,
                    sentUsers,
                    pendingUsers,
                    progressPercent: totalUsers > 0 ? ((sentUsers / totalUsers) * 100).toFixed(1) : 0
                },
                createdAt: campaign.createdAt,
                updatedAt: campaign.updatedAt
            }
        });

    } catch (error) {
        console.error('Campaign Status Error:', error);
        res.status(500).json({ success: false, error: 'خطا در دریافت وضعیت کمپین.' });
    }
});


// ==========================================
// 🚀 موتور پردازش هوشمند کمپین‌ها و صف
// ==========================================
let activeInterval = null;

export const runCampaignWorker = (campaignId) => {
    if (activeInterval) clearInterval(activeInterval);

    // بررسی صف هر ۲ دقیقه یک‌بار
    activeInterval = setInterval(async () => {
        try {
            console.log('⏳ Worker: Checking campaign status...');

            // ۱. بررسی وضعیت کمپین
            const campaign = await Campaign.findById(campaignId);
            if (!campaign || campaign.status !== 'running') {
                console.log('🛑 کمپین متوقف، لغو یا پایان یافته است.');
                clearInterval(activeInterval);
                activeInterval = null;
                return;
            }

            // ۲. پیدا کردن اولین کاربر با وضعیت pending (سیستم Resume خودکار)
            let targetUser = await User.findOne({ status: 'pending', isActive: true });

            if (!targetUser) {
                console.log('✨ تمام کاربران این صف پیام دریافت کرده‌اند.');
                campaign.status = 'completed';
                await campaign.save();
                clearInterval(activeInterval);
                activeInterval = null;
                return;
            }

            // ۳. اعمال قوانین ارسال بر اساس نوع کمپین (عادی با قانون ۳۰ روزه یا جشنواره بدون محدودیت)
            if (campaign.type === 'normal') {
                const oneMonthAgo = new Date();
                oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

                const hasRecentNormal = targetUser.receivedMessages.some(
                    m => m.messageType === 'normal' && m.sentAt > oneMonthAgo
                );

                if (hasRecentNormal) {
                    console.log(`⏳ کاربر ${targetUser.mobile} در ۱ ماه گذشته پیام عادی گرفته است. رد شدن از این کاربر...`);
                    targetUser.status = 'sent';
                    await targetUser.save();
                    return;
                }
            }

            // ۴. انتخاب رندوم یک پیام از بین پیام‌های هم‌نوع (مثلاً از بین ۲۰۰ پیام عادی یا جشنواره)
            const messagesPool = await Message.find({ type: campaign.type });
            if (messagesPool.length === 0) {
                console.log(`⚠️ هیچ پیامی از نوع ${campaign.type} در دیتابیس ثبت نشده است!`);
                return;
            }
            const randomMessage = messagesPool[Math.floor(Math.random() * messagesPool.length)];

            console.log(`🚀 شروع اتوماسیون برای کاربر: ${targetUser.mobile} | نوع کمپین: ${campaign.type}`);

            // ۵. اجرای عملیات ارسال از طریق Puppeteer
            const isSuccess = await processUserAction(targetUser.mobile, randomMessage.text);

            if (isSuccess) {
                targetUser.receivedMessages.push({ messageType: campaign.type, sentAt: new Date() });
                targetUser.status = 'sent';
                await targetUser.save();

                campaign.totalSent += 1;
                await campaign.save();
                console.log(`✅ پیام با موفقیت به ${targetUser.mobile} ارسال و در دیتابیس ثبت شد.`);
            } else {
                console.log(`⚠️ ارسال برای ${targetUser.mobile} ناموفق بود. در صف باقی می‌ماند تا در دور بعدی تلاش شود.`);
            }

        } catch (error) {
            console.error('❌ خطا در پردازشگر کمپین:', error.message);
        }
    }, 60000); // هر ۲ دقیقه
};

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Backend Server running on http://localhost:${PORT}`);
});