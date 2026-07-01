const express = require('express');
const router = express.Router();
const { getQueueStatus, callNextPatient, cancelBooking } = require('../controllers/doctorController');
const { protect, authorize } = require('../middlewares/auth');

router.use(protect);
router.use(authorize('doctor'));

router.get('/queue-status', getQueueStatus);
router.post('/next', callNextPatient);
router.post('/cancel-booking/:id', cancelBooking);

module.exports = router;
