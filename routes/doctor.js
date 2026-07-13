const express = require('express');
const router = express.Router();
const { getQueueStatus, callNextPatient, cancelBooking, startSession, activateRealTimeSession, endSession, updateDoctorDetails } = require('../controllers/doctorController');
const { protect, authorize } = require('../middlewares/auth');

router.use(protect);
router.use(authorize('doctor'));

router.get('/queue-status', getQueueStatus);
router.post('/next', callNextPatient);
router.post('/cancel-booking/:id', cancelBooking);
router.post('/start-session', startSession);
router.post('/activate-real-time', activateRealTimeSession);
router.post('/end-session', endSession);
router.put('/update-details', updateDoctorDetails);

module.exports = router;
