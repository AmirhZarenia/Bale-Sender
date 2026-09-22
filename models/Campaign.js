import mongoose from 'mongoose';

const CampaignScheduleSchema = new mongoose.Schema({
    enabled: {
        type: Boolean,
        default: true
    },

    daysOfWeek: {
        type: [Number],
        default: [0, 1, 2, 3, 4, 5, 6],
        validate: {
            validator: value =>
                value.every(
                    day =>
                        Number.isInteger(day) &&
                        day >= 0 &&
                        day <= 6
                ),
            message: 'روزهای هفته باید بین 0 تا 6 باشند.'
        }
    },

    startTime: {
        type: String,
        default: '10:00'
    },

    endTime: {
        type: String,
        default: '12:00'
    }

}, {
    _id: false
});


const CampaignSchema = new mongoose.Schema({

    title: {
        type: String,
        required: true
    },

    type: {
        type: String,
        enum: ['normal', 'festival'],
        required: true
    },

    subjects: [
        {
            type: String,
            required: true
        }
    ],

    targetCategories: [
        {
            type: String
        }
    ],

    targetTags: [
        {
            type: String
        }
    ],


    // =====================================================
    // تاریخ شروع و پایان باید در سطح اصلی Campaign باشند
    // =====================================================

    startDate: {
        type: String,
        required: true
    },

    endDate: {
        type: String,
        required: true
    },


    // =====================================================
    // فاصله زمانی بین ارسال پیام‌ها
    // =====================================================

    minDelaySeconds: {
        type: Number,
        default: 180
    },

    maxDelaySeconds: {
        type: Number,
        default: 300
    },


    // =====================================================
    // تنظیمات زمان‌بندی کمپین
    // توجه: تاریخ‌ها داخل schedule نیستند
    // =====================================================

    schedule: {
        type: CampaignScheduleSchema,

        default: () => ({
            enabled: true,
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
            startTime: '10:00',
            endTime: '12:00'
        })
    },


    // =====================================================
    // وضعیت کمپین
    // =====================================================

    status: {
        type: String,

        enum: [
            'idle',
            'running',
            'paused',
            'cancelled',
            'completed'
        ],

        default: 'idle'
    },


    // =====================================================
    // اطلاعات اجرای کمپین
    // =====================================================

    remainingDelaySeconds: {
        type: Number,
        default: 0
    },

    totalSent: {
        type: Number,
        default: 0
    },

    totalFailed: {
        type: Number,
        default: 0
    }

}, {
    timestamps: true
});


export default mongoose.model(
    'Campaign',
    CampaignSchema
);