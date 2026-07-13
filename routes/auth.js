const express = require('express');
const router = express.Router();
const { registerUser, loginUser, getMe, updateProfile } = require('../controllers/authController');
const { protect } = require('../middlewares/auth');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/profile', protect, getMe);
router.put('/profile', protect, updateProfile);

module.exports = router;
