import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema({
    title: { type: String, required: true },
    type: { type: String, enum: ['normal', 'festival'], required: true },
    status: {
        type: String,
        enum: ['idle', 'running', 'paused', 'cancelled', 'completed'],
        default: 'idle'
    },
    totalSent: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.model('Campaign', campaignSchema);