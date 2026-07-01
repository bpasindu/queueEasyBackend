const mongoose = require('mongoose');

const ClinicSchema = new mongoose.Schema({
    doctor: {
        type: String,
        required: [true, 'Please add a doctor name'],
    },
    specialty: {
        type: String,
        required: [true, 'Please add a specialty'],
    },
    clinic: {
        type: String,
        required: [true, 'Please add a clinic location'],
    },
    inQueue: {
        type: Number,
        default: 0,
    },
    eta: {
        type: Number,
        default: 0,
    },
    scheduledStart: {
        type: String,
        default: '9:00 AM',
    },
    actualStart: {
        type: String,
        default: '--:--',
    },
    isOpen: {
        type: Boolean,
        default: false,
    },
    currentServing: {
        type: Number,
        default: 4,
    },
    averageConsultTime: {
        type: Number,
        default: 6.4, // in minutes
    },
    doctorUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
}, {
    timestamps: true,
});

module.exports = mongoose.model('Clinic', ClinicSchema);
