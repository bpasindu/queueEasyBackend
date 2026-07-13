const Clinic = require('../models/Clinic');
const Booking = require('../models/Booking');
const SessionHistory = require('../models/SessionHistory');

// Helper to get formatted current time, e.g. "9:18 AM"
const getCurrentTimeString = () => {
    return new Date().toLocaleTimeString('en-US', {
        timeZone: 'Asia/Colombo',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
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
        const currentActive = await Booking.findOne({
            clinic: clinic._id,
            slotNumber: clinic.currentServing,
            status: 'called',
        });
        if (currentActive) {
            currentActive.status = 'completed';
            currentActive.isLive = false;
            await currentActive.save();

            // Calculate actual consultation duration in minutes
            const durationMs = Date.now() - new Date(currentActive.updatedAt).getTime();
            const durationMin = Math.max(1, durationMs / 60000); // minimum 1 minute

            // Create SessionHistory entry
            const dayOfWeek = new Date().getDay();
            const hourOfDay = new Date().getHours();
            await SessionHistory.create({
                clinic: clinic._id,
                dayOfWeek,
                hourOfDay,
                slotNumber: clinic.currentServing,
                consultationDuration: durationMin,
            });
        }

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
        const { maxPatients, scheduledStart } = req.body;
        
        let clinic = await Clinic.findOne({ doctorUser: req.user.id });
        if (!clinic) {
            clinic = await Clinic.create({
                doctor: req.user.name || 'Doctor',
                specialty: 'General Practitioner',
                clinic: 'Consultation Suite Room 1',
                scheduledStart: scheduledStart || '9:00 AM',
                actualStart: '--:--',
                isOpen: false,
                doctorUser: req.user.id
            });
        }

        clinic.scheduledStart = scheduledStart || '9:00 AM';
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

        clinic.actualStart = getCurrentTimeString();
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
