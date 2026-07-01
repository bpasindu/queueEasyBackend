const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
    patient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    clinic: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Clinic',
        required: true,
    },
    slotNumber: {
        type: Number,
        required: [true, 'Please add a slot number'],
    },
    waitMinutes: {
        type: Number,
        default: 0,
    },
    predictedServingTime: {
        type: String,
        default: '',
    },
    startedTime: {
        type: String,
        default: '',
    },
    isLive: {
        type: Boolean,
        default: true,
    },
    status: {
        type: String,
        enum: ['pending', 'called', 'completed', 'cancelled'],
        default: 'pending',
    },
}, {
    timestamps: true,
});

// Ensure a patient can only have one active/pending booking per clinic
BookingSchema.index({ patient: 1, clinic: 1, status: 1 });

module.exports = mongoose.model('Booking', BookingSchema);
