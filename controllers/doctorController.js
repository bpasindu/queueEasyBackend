const Clinic = require('../models/Clinic');
const Booking = require('../models/Booking');

// Helper to get formatted current time, e.g. "9:18 AM"
const getCurrentTimeString = () => {
    const date = new Date();
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutesStr} ${ampm}`;
};

// @desc    Get current doctor queue status
// @route   GET /api/doctor/queue-status
// @access  Private (Doctor only)
const getQueueStatus = async (req, res) => {
    try {
        // Find clinic for this doctor
        let clinic = await Clinic.findOne({ doctorUser: req.user.id });

        // If no clinic is mapped specifically, default to first clinic for testing
        if (!clinic) {
            clinic = await Clinic.findOne();
        }

        if (!clinic) {
            return res.status(404).json({ success: false, message: 'Clinic details not found' });
        }

        // Count total booked patients (active, served, completed)
        const totalBooked = await Booking.countDocuments({
            clinic: clinic._id,
            status: { $ne: 'cancelled' },
        });

        res.status(200).json({
            success: true,
            doctor: clinic.doctor,
            specialty: clinic.specialty,
            clinicName: clinic.clinic,
            nowServing: clinic.currentServing,
            totalBooked: totalBooked,
            avgConsult: clinic.averageConsultTime,
            isOpen: clinic.isOpen,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Call the next patient in queue
// @route   POST /api/doctor/next
// @access  Private (Doctor only)
const callNextPatient = async (req, res) => {
    try {
        let clinic = await Clinic.findOne({ doctorUser: req.user.id });

        if (!clinic) {
            clinic = await Clinic.findOne();
        }

        if (!clinic) {
            return res.status(404).json({ success: false, message: 'Clinic details not found' });
        }

        // 1. If there's an active called booking for the old serving number, complete it
        await Booking.updateMany(
            { clinic: clinic._id, slotNumber: clinic.currentServing, status: 'called' },
            { $set: { status: 'completed', isLive: false } }
        );

        // 2. Increment now serving number
        clinic.currentServing = clinic.currentServing + 1;
        if (!clinic.isOpen) {
            clinic.isOpen = true;
            clinic.actualStart = getCurrentTimeString();
        }

        // 3. Check if there's a booking for the new serving number, if so, call them
        const nextBooking = await Booking.findOne({
            clinic: clinic._id,
            slotNumber: clinic.currentServing,
            status: 'pending',
        });

        if (nextBooking) {
            nextBooking.status = 'called';
            nextBooking.startedTime = getCurrentTimeString();
            await nextBooking.save();
        }

        // 4. Update clinic queue metrics
        const pendingCount = await Booking.countDocuments({
            clinic: clinic._id,
            status: 'pending',
        });

        clinic.inQueue = pendingCount;
        clinic.eta = Math.max(1, Math.round(pendingCount * clinic.averageConsultTime));
        await clinic.save();

        res.status(200).json({
            success: true,
            nowServing: clinic.currentServing,
            inQueue: clinic.inQueue,
            eta: clinic.eta,
            message: `Called ticket #${clinic.currentServing}`,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getQueueStatus,
    callNextPatient,
};
