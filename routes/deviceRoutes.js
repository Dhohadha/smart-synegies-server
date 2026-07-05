const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const { verifyToken, verifyDeviceAccess } = require('../middleware/authMiddleware');

router.get('/status/:id', verifyToken, verifyDeviceAccess, deviceController.getDeviceStatus);
router.post('/:id/calibrate', verifyToken, verifyDeviceAccess, deviceController.calibrateDevice);
router.get('/:id/history', verifyToken, verifyDeviceAccess, deviceController.getDeviceHistory);
router.delete('/:id/history/:historyId', verifyToken, verifyDeviceAccess, deviceController.deleteDeviceHistoryItem);
router.post('/:id/toggle-relay', verifyToken, verifyDeviceAccess, deviceController.toggleRelay);
router.post('/config/:id', verifyToken, verifyDeviceAccess, deviceController.updateDeviceSettings);
router.get('/test/notification', deviceController.sendTestNotification);

module.exports = router;
