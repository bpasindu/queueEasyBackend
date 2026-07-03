const Clinic = require('../models/Clinic');

// @desc    Get all clinics
// @route   GET /api/clinics
// @access  Public
const getClinics = async (req, res) => {
    try {
        const clinics = await Clinic.find({ isOpen: true });
        res.status(200).json({
            success: true,
            count: clinics.length,
            data: clinics,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get single clinic
// @route   GET /api/clinics/:id
// @access  Public
const getClinicById = async (req, res) => {
    try {
        const clinic = await Clinic.findById(req.params.id);

        if (!clinic) {
            return res.status(404).json({ success: false, message: 'Clinic not found' });
        }

        res.status(200).json({
            success: true,
            data: clinic,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getClinics,
    getClinicById,
};
