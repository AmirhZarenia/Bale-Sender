import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    mobile: { type: String, required: true, unique: true },
    businessName: { type: String },
    isActive: { type: Boolean, default: true },
    receivedMessages: [{
        messageType: { type: String, enum: ['normal', 'festival'] },
        sentAt: { type: Date, default: Date.now }
    }],
    status: { type: String, enum: ['pending', 'sent'], default: 'pending' }
}, { timestamps: true });

export default mongoose.model('User', userSchema);