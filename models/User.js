import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    mobile: { type: String, required: true, unique: true },
    businessName: { type: String, required: true },
    category: { type: String, default: 'مشتری', required: true },
    tags: [{ type: String, required: true }],
    isBlocked: { type: Boolean, default: false, required: true },
    isActive: { type: Boolean, default: true },

    // Bale history
    receivedMessages: [{
        messageType: { type: String, enum: ['normal', 'festival'] },
        subject: { type: String },
        sentAt: { type: Date, default: Date.now }
    }],
    status: { type: String, enum: ['pending', 'sent'], default: 'pending' },

    // Rubika data in the same users collection.
    // rubikaGuid will be filled later by the Rubika crawler.
    rubikaGuid: { type: String, default: null, sparse: true },
    rubikaStatus: { type: String, enum: ['pending', 'sent'], default: 'pending' },
    rubikaReceivedMessages: [{
        messageType: { type: String, enum: ['normal', 'festival'] },
        subject: { type: String },
        sentAt: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

export default mongoose.model('User', userSchema);
