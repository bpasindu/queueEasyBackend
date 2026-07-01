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
        if (!clinic) {
            clinic = await Clinic.create({
                doctor: req.user.name || 'Doctor',
                specialty: 'General Practitioner',
                clinic: 'Consultation Suite Room 1',
                scheduledStart: '9:00 AM',
                actualStart: '--:--',
                isOpen: false,
                doctorUser: req.user.id
            });
        }

        // Count pending bookings (in queue)
        const inQueue = await Booking.countDocuments({
            clinic: clinic._id,
            status: 'pending',
        });

        // Count completed bookings (served)
        const served = await Booking.countDocuments({
            clinic: clinic._id,
            status: 'completed',
        });

        // Find currently called patient
        const currentBooking = await Booking.findOne({
            clinic: clinic._id,
            status: 'called',
        }).populate('patient', 'name phone');

        // Fetch upcoming patient list (pending bookings)
        const upcoming = await Booking.find({
            clinic: clinic._id,
            status: 'pending',
        })
        .sort({ slotNumber: 1 })
        .populate('patient', 'name phone');

        res.status(200).json({
            success: true,
            doctor: clinic.doctor,
            specialty: clinic.specialty,
            clinicName: clinic.clinic,
            nowServing: clinic.currentServing,
            nowServingName: currentBooking?.patient?.name || null,
            nowServingPhone: currentBooking?.patient?.phone || null,
            nowServingPredicted: currentBooking?.predictedServingTime || '',
            inQueue: inQueue,
            served: served,
            avgConsult: clinic.averageConsultTime,
            scheduledStart: clinic.scheduledStart,
            actualStart: clinic.actualStart,
            isOpen: clinic.isOpen,
            upcoming: upcoming,
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
            clinic = await Clinic.create({
                doctor: req.user.name || 'Doctor',
                specialty: 'General Practitioner',
                clinic: 'Consultation Suite Room 1',
                scheduledStart: '9:00 AM',
                actualStart: '--:--',
                isOpen: false,
                doctorUser: req.user.id
            });
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

// @desc    Cancel a booking
// @route   POST /api/doctor/cancel-booking/:id
// @access  Private (Doctor only)
const cancelBooking = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }
        
        booking.status = 'cancelled';
        booking.isLive = false;
        await booking.save();

        // Recalculate clinic metrics
        const clinic = await Clinic.findById(booking.clinic);
        if (clinic) {
            const pendingCount = await Booking.countDocuments({
                clinic: clinic._id,
                status: 'pending',
            });
            clinic.inQueue = pendingCount;
            clinic.eta = Math.max(1, Math.round(pendingCount * clinic.averageConsultTime));
            await clinic.save();
        }

        res.status(200).json({ success: true, message: 'Booking cancelled successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Start clinic session (places the session, opens for booking)
// @route   POST /api/doctor/start-session
// @access  Private (Doctor only)
const startSession = async (req, res) => {
    try {
        const { maxPatients } = req.body;
        
        let clinic = await Clinic.findOne({ doctorUser: req.user.id });
        if (!clinic) {
            clinic = await Clinic.create({
                doctor: req.user.name || 'Doctor',
                specialty: 'General Practitioner',
                clinic: 'Consultation Suite Room 1',
                scheduledStart: '9:00 AM',
                actualStart: '--:--',
                isOpen: false,
                doctorUser: req.user.id
            });
        }

        clinic.actualStart = '--:--'; // Initial setup before real-time activation
        clinic.maxPatients = parseInt(maxPatients) || 14;
        clinic.isOpen = true;
        clinic.currentServing = 1;
        clinic.inQueue = 0; // Reset queue size to 0
        clinic.eta = 0; // Reset estimated wait time to 0
        await clinic.save();

        // Remove any previous active/historical bookings for this clinic so it starts clean
        await Booking.deleteMany({ clinic: clinic._id });

        res.status(200).json({ 
            success: true, 
            message: 'Clinic session set up successfully. Open for bookings.',
            clinic 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Start calling in real-time (doctor starts the session now)
// @route   POST /api/doctor/activate-real-time
// @access  Private (Doctor only)
const activateRealTimeSession = async (req, res) => {
    try {
        let clinic = await Clinic.findOne({ doctorUser: req.user.id });
        if (!clinic) {
            clinic = await Clinic.create({
                doctor: req.user.name || 'Doctor',
                specialty: 'General Practitioner',
                clinic: 'Consultation Suite Room 1',
                scheduledStart: '9:00 AM',
                actualStart: '--:--',
                isOpen: false,
                doctorUser: req.user.id
            });
        }

        // Get the current local time in Colombo
        const currentLocalTime = new Date().toLocaleTimeString('en-US', {
            timeZone: 'Asia/Colombo',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        clinic.actualStart = currentLocalTime;
        await clinic.save();

        res.status(200).json({
            success: true,
            message: 'Real-time session started successfully',
            actualStart: clinic.actualStart,
            clinic
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    End clinic session
// @route   POST /api/doctor/end-session
// @access  Private (Doctor only)
const endSession = async (req, res) => {
    try {
        let clinic = await Clinic.findOne({ doctorUser: req.user.id });
        if (!clinic) {
            clinic = await Clinic.create({
                doctor: req.user.name || 'Doctor',
                specialty: 'General Practitioner',
                clinic: 'Consultation Suite Room 1',
                scheduledStart: '9:00 AM',
                actualStart: '--:--',
                isOpen: false,
                doctorUser: req.user.id
            });
        }

        clinic.isOpen = false;
        clinic.actualStart = '--:--';
        clinic.inQueue = 0;
        clinic.eta = 0;
        await clinic.save();

        // Mark all active bookings for this clinic as completed so queue resets cleanly
        await Booking.updateMany(
            { clinic: clinic._id, status: { $in: ['pending', 'called'] } },
            { status: 'completed', isLive: false }
        );

        res.status(200).json({ 
            success: true, 
            message: 'Clinic session ended successfully',
            clinic 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getQueueStatus,
    callNextPatient,
    cancelBooking,
    startSession,
    activateRealTimeSession,
    endSession,
};
