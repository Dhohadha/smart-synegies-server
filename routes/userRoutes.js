const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken } = require('../middleware/authMiddleware');

// For Admin usage (to keep it simple, we skip verifyAdmin for demo, but in production we'd add verifyAdmin)
router.post('/register', userController.registerUser);
router.get('/', userController.getUsers);
router.post('/:email/devices', userController.addDeviceToUser);
router.delete('/:email/devices/:deviceId', userController.removeDeviceFromUser);
// For User usage
router.get('/me', verifyToken, userController.getUserProfile);
router.post('/share', verifyToken, userController.shareAccess);
router.put('/share/devices', verifyToken, userController.updateSharedDevices);
router.post('/verify-email', verifyToken, userController.verifyEmailToShare);
router.post('/invitations/accept', verifyToken, userController.acceptInvitation);
router.post('/invitations/decline', verifyToken, userController.declineInvitation);
router.delete('/revoke-access/:sharedEmail', verifyToken, userController.revokeAccess);
router.get('/:email/shared-details', verifyToken, userController.getSharedDetails);
router.put('/settings/alert-sound', verifyToken, userController.updateAlertSound);
router.put('/settings/muted-devices', verifyToken, userController.updateMutedDevices);
router.put('/profile', verifyToken, userController.updateUserProfile);
router.put('/profile/devices/order', verifyToken, userController.updateDevicesOrder);

// Alerts and Notifications
router.post('/fcm-token', verifyToken, userController.registerFcmToken);
router.get('/notifications', verifyToken, userController.getNotifications);
router.delete('/notifications', verifyToken, userController.clearNotifications);
router.delete('/notifications/:id', verifyToken, userController.deleteNotification);
router.post('/stop-alert', userController.stopAlert);

// For Admin usage
router.post('/:email/share', userController.adminShareAccess);
router.get('/:email/shared-details-admin', userController.getSharedDetailsAdmin);
router.delete('/revoke-access-admin/:ownerEmail/:sharedEmail', userController.revokeAccessAdmin);
router.put('/share/devices-admin', userController.updateSharedDevicesAdmin);
router.delete('/:email', userController.deleteUser);

module.exports = router;

