const express = require('express');
const router = express.Router();
const { getQueueStatus, callNextPatient } = require('../controllers/doctorController');
const { protect, authorize } = require('../middlewares/auth');

router.use(protect);
router.use(authorize('doctor'));

router.get('/queue-status', getQueueStatus);
router.post('/next', callNextPatient);

module.exports = router;
