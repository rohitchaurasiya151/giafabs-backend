const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminAuth = require('../middleware/adminAuth');

// Public routes
router.post('/login', adminController.loginAdmin);

// Protected admin routes
router.get('/stats', adminAuth, adminController.getAdminStats);
router.get('/settings', adminAuth, adminController.getAdminSettings);
router.put('/settings', adminAuth, adminController.updateAdminSettings);

module.exports = router;
