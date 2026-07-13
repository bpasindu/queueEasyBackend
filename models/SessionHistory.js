const mongoose = require('mongoose');

const SessionHistorySchema = new mongoose.Schema({
    clinic: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Clinic',
        required: true,
    },
    dayOfWeek: {
        type: Number, // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
        required: true,
    },
    hourOfDay: {
        type: Number, // 0 to 23
        required: true,
    },
    slotNumber: {
        type: Number,
        required: true,
    },
    consultationDuration: {
        type: Number, // in minutes (float)
        required: true,
    },
}, {
    timestamps: true,
});

module.exports = mongoose.model('SessionHistory', SessionHistorySchema);
