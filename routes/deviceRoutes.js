const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');

router.get('/status/:id', deviceController.getDeviceStatus);
router.post('/:id/calibrate', deviceController.calibrateDevice);
router.get('/:id/history', deviceController.getDeviceHistory);
router.delete('/:id/history/:historyId', deviceController.deleteDeviceHistoryItem);
router.post('/:id/toggle-relay', deviceController.toggleRelay);
router.post('/config/:id', deviceController.updateDeviceSettings);
router.get('/test/notification', deviceController.sendTestNotification);

module.exports = router;
