const express = require('express');
const router = express.Router();
const { handleChat } = require('../controllers/assistantController');
const { protect } = require('../middlewares/auth');

router.post('/chat', protect, handleChat);

module.exports = router;
