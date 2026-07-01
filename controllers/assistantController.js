const Clinic = require('../models/Clinic');
const Booking = require('../models/Booking');

// @desc    Chat with AI Queue Assistant
// @route   POST /api/assistant/chat
// @access  Private
const handleChat = async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, message: 'Please provide a message' });
        }

        const cleanMsg = message.toLowerCase();

        // 1. Check for specific doctor queries
        if (cleanMsg.includes('silva')) {
            const clinic = await Clinic.findOne({ doctor: /silva/i });
            if (clinic) {
                return res.status(200).json({
                    success: true,
                    reply: `Dr. Silva currently has ${clinic.inQueue} patients in the queue. The estimated waiting time is approximately ${clinic.eta} minutes.`,
                });
            }
        }

        if (cleanMsg.includes('fernando')) {
            const clinic = await Clinic.findOne({ doctor: /fernando/i });
            if (clinic) {
                return res.status(200).json({
                    success: true,
                    reply: `Dr. Fernando currently has ${clinic.inQueue} patients in the queue. The estimated waiting time is approximately ${clinic.eta} minutes.`,
                });
            }
        }

        if (cleanMsg.includes('jayasinghe')) {
            const clinic = await Clinic.findOne({ doctor: /jayasinghe/i });
            if (clinic) {
                return res.status(200).json({
                    success: true,
                    reply: `Dr. Jayasinghe currently has ${clinic.inQueue} patients in the queue. The estimated waiting time is approximately ${clinic.eta} minutes.`,
                });
            }
        }

        // 2. Check for personal booking status queries
        if (
            cleanMsg.includes('my turn') ||
            cleanMsg.includes('my slot') ||
            cleanMsg.includes('my booking') ||
            cleanMsg.includes('my status') ||
            cleanMsg.includes('when is my')
        ) {
            const activeBooking = await Booking.findOne({
                patient: req.user.id,
                status: { $in: ['pending', 'called'] },
            }).populate('clinic');

            if (activeBooking) {
                // Find current serving number for calculations
                const lastCalled = await Booking.findOne({
                    clinic: activeBooking.clinic._id,
                    status: 'called',
                }).sort({ slotNumber: -1 });

                const currentServingNum = lastCalled ? lastCalled.slotNumber : 1;

                // Re-evaluate wait time dynamically
                const wait = Math.max(
                    1,
                    Math.round((activeBooking.slotNumber - currentServingNum) * activeBooking.clinic.averageConsultTime)
                );

                return res.status(200).json({
                    success: true,
                    reply: `You hold Slot #${activeBooking.slotNumber} for ${activeBooking.clinic.doctor} at ${activeBooking.clinic.clinic}. You are currently ${activeBooking.slotNumber - currentServingNum} slots away from being served. Estimated wait time: ~${wait} minutes.`,
                });
            } else {
                return res.status(200).json({
                    success: true,
                    reply: "You don't have any active bookings at the moment. You can browse nearby clinics and book a slot in the 'Book' tab!",
                });
            }
        }

        // 3. Fallback generic reply
        return res.status(200).json({
            success: true,
            reply: "Hello! I am your QueueEase AI Assistant. You can ask me questions about specific clinic waiting lines (e.g. 'How many people are in queue for Dr. Silva?') or about your active booking status (e.g. 'When is my turn?').",
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    handleChat,
};
