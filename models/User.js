import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    mobile: { type: String, required: true, unique: true },
    businessName: { type: String, required: true },
    category: { type: String, default: 'مشتری', required: true },
    tags: [{ type: String, required: true }], // 👈 فیلد جدید تگ‌ها (خوانده شده از اکسل)
    isBlocked: { type: Boolean, default: false, required: true }, // 👈 فیلد جدید بلاک (اگر true باشد هیچ پیامی نمی‌گیرد)
    isActive: { type: Boolean, default: true },
    receivedMessages: [{
        messageType: { type: String, enum: ['normal', 'festival'] },
        subject: { type: String },
        sentAt: { type: Date, default: Date.now }
    }],
    status: { type: String, enum: ['pending', 'sent'], default: 'pending' }
}, { timestamps: true });

export default mongoose.model('User', userSchema);