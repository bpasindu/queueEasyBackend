const Booking = require('../models/Booking');
const Clinic = require('../models/Clinic');
const User = require('../models/User');

// Helper to format float representations matching React Native constants
const getSlotTimeStr = (slotNum, averageConsultTime = 6.4, actualStartStr = '9:18 AM') => {
    const [timePart, ampm] = actualStartStr.split(' ');
    const [hoursStr, minutesStr] = timePart.split(':');
    const startHour = parseInt(hoursStr);
    const startMin = parseInt(minutesStr);
    
    const elapsed = (slotNum - 1) * averageConsultTime;
    const totalMin = startMin + elapsed;
    let hour = startHour + Math.floor(totalMin / 60);
    let min = totalMin % 60;
    
    let displayAmpm = ampm;
    if (hour >= 12) {
        if (hour > 12) {
            hour = hour - 12;
        }
        // Toggle AM/PM if crossing 12 threshold
        if (startHour < 12) {
            displayAmpm = ampm === 'AM' ? 'PM' : 'AM';
        }
    }
    
    // JS float addition can result in values like 24.400000000000003
    const minStr = Number.isInteger(min) ? min.toString() : min.toString();
    return `${hour}:${minStr} ${displayAmpm}`;
};

// Helper to calculate wait minutes from current serving number
const getWaitMinutes = (slotNum, currentServingNum, averageConsultTime = 6.4) => {
    const baseOffset = (slotNum - 1) * averageConsultTime;
    const currentOffset = (currentServingNum - 1) * averageConsultTime;
    const wait = baseOffset - currentOffset;
    return Math.max(1, Math.round(wait));
};

// @desc    Get active booking for the logged-in patient
// @route   GET /api/bookings/active
// @access  Private
const getActiveBooking = async (req, res) => {
    try {
        // Find booking that is pending or called
        const booking = await Booking.findOne({
            patient: req.user.id,
            status: { $in: ['pending', 'called'] },
        }).populate('clinic');

        if (!booking) {
            return res.status(200).json({
                success: true,
                hasActiveBooking: false,
                data: null,
            });
        }

        // Get current serving number for this clinic
        // The current serving number is the minimum slotNumber of pending/called bookings, or 1 if none
        const activeBookings = await Booking.find({
            clinic: booking.clinic._id,
            status: 'called',
        }).sort({ slotNumber: -1 });

        let currentServingNum = 1;
        if (activeBookings.length > 0) {
            currentServingNum = activeBookings[0].slotNumber;
        } else {
            // If no called booking, look at the first pending booking
            const firstPending = await Booking.findOne({
                clinic: booking.clinic._id,
                status: 'pending',
            }).sort({ slotNumber: 1 });
            if (firstPending && firstPending.slotNumber > 1) {
                currentServingNum = firstPending.slotNumber - 1;
            }
        }

        const wait = getWaitMinutes(booking.slotNumber, currentServingNum, booking.clinic.averageConsultTime);
        const startTimeStr = (booking.clinic.actualStart && booking.clinic.actualStart !== '--:--') 
            ? booking.clinic.actualStart 
            : (booking.clinic.scheduledStart || '9:00 AM');
        const predicted = getSlotTimeStr(booking.slotNumber, booking.clinic.averageConsultTime, startTimeStr);

        res.status(200).json({
            success: true,
            hasActiveBooking: true,
            data: {
                _id: booking._id,
                number: booking.slotNumber,
                wait: wait,
                predicted: predicted,
                started: booking.clinic.actualStart,
                live: booking.isLive,
                clinic: booking.clinic,
                status: booking.status,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get slots status for a clinic
// @route   GET /api/bookings/slots/:clinicId
// @access  Private
const getSlotsForClinic = async (req, res) => {
    try {
        const clinic = await Clinic.findById(req.params.clinicId);
        if (!clinic) {
            return res.status(404).json({ success: false, message: 'Clinic not found' });
        }

        // Get active bookings for this clinic to determine taken slots
        const activeBookings = await Booking.find({
            clinic: clinic._id,
            status: { $in: ['pending', 'called'] },
        });

        const takenSlotsMap = {};
        let currentServingNum = 1;
        
        activeBookings.forEach((b) => {
            takenSlotsMap[b.slotNumber] = true;
            if (b.status === 'called' && b.slotNumber > currentServingNum) {
                currentServingNum = b.slotNumber;
            }
        });

        // Generate dynamic slots based on maxPatients
        const slots = [];
        const maxSlots = clinic.maxPatients || 14;
        const startTimeStr = (clinic.actualStart && clinic.actualStart !== '--:--')
            ? clinic.actualStart
            : (clinic.scheduledStart || '9:00 AM');
        for (let i = 1; i <= maxSlots; i++) {
            const isTaken = !!takenSlotsMap[i] || i < currentServingNum; // slots below current serving are taken
            const time = getSlotTimeStr(i, clinic.averageConsultTime, startTimeStr);
            const wait = getWaitMinutes(i, currentServingNum, clinic.averageConsultTime);

            slots.push({
                number: i,
                isTaken: isTaken,
                time: time,
                wait: wait,
            });
        }

        res.status(200).json({
            success: true,
            clinic: {
                id: clinic._id,
                doctor: clinic.doctor,
                currentServing: currentServingNum,
                scheduledStart: clinic.scheduledStart,
                actualStart: clinic.actualStart,
                averageConsultTime: clinic.averageConsultTime,
            },
            slots: slots,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Reserve a slot
// @route   POST /api/bookings/reserve
// @access  Private
const reserveSlot = async (req, res) => {
    try {
        const { clinicId, slotNumber } = req.body;

        if (!clinicId || !slotNumber) {
            return res.status(400).json({ success: false, message: 'Please provide clinicId and slotNumber' });
        }

        const clinic = await Clinic.findById(clinicId);
        if (!clinic) {
            return res.status(404).json({ success: false, message: 'Clinic not found' });
        }

        // Check if slot is already taken
        const existingBooking = await Booking.findOne({
            clinic: clinicId,
            slotNumber: slotNumber,
            status: { $in: ['pending', 'called'] },
        });

        if (existingBooking) {
            return res.status(400).json({ success: false, message: `Slot #${slotNumber} is already taken` });
        }

        // Cancel any other active bookings for this user to keep it clean (only 1 active booking at a time)
        await Booking.updateMany(
            { patient: req.user.id, status: { $in: ['pending', 'called'] } },
            { $set: { status: 'cancelled', isLive: false } }
        );

        // Find current serving number for calculations
        const lastCalled = await Booking.findOne({
            clinic: clinicId,
            status: 'called',
        }).sort({ slotNumber: -1 });

        const currentServingNum = lastCalled ? lastCalled.slotNumber : 1;

        const wait = getWaitMinutes(slotNumber, currentServingNum, clinic.averageConsultTime);
        const startTimeStr = (clinic.actualStart && clinic.actualStart !== '--:--')
            ? clinic.actualStart
            : (clinic.scheduledStart || '9:00 AM');
        const predicted = getSlotTimeStr(slotNumber, clinic.averageConsultTime, startTimeStr);

        // Create booking
        const booking = await Booking.create({
            patient: req.user.id,
            clinic: clinicId,
            slotNumber: slotNumber,
            waitMinutes: wait,
            predictedServingTime: predicted,
            startedTime: clinic.actualStart,
            isLive: true,
            status: 'pending',
        });

        // Update User visits
        await User.findByIdAndUpdate(req.user.id, { $inc: { visits: 1 } });

        // Update Clinic queue details
        const activeBookingsCount = await Booking.countDocuments({
            clinic: clinicId,
            status: { $in: ['pending', 'called'] },
        });

        clinic.inQueue = activeBookingsCount;
        clinic.eta = Math.max(1, Math.round(activeBookingsCount * clinic.averageConsultTime));
        await clinic.save();

        res.status(201).json({
            success: true,
            data: {
                _id: booking._id,
                number: booking.slotNumber,
                wait: wait,
                predicted: predicted,
                started: clinic.actualStart,
                live: booking.isLive,
                status: booking.status,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getActiveBooking,
    getSlotsForClinic,
    reserveSlot,
    getSlotTimeStr,
    getWaitMinutes,
};
