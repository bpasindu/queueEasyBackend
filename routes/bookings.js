const express = require('express');
const router = express.Router();
const { getActiveBooking, getSlotsForClinic, reserveSlot, getMyBookings } = require('../controllers/bookingController');
const { protect } = require('../middlewares/auth');

router.use(protect); // protect all booking endpoints

router.get('/active', getActiveBooking);
router.get('/my-bookings', getMyBookings);
router.get('/slots/:clinicId', getSlotsForClinic);
router.post('/reserve', reserveSlot);

module.exports = router;
