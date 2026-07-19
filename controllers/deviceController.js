const Device = require('../models/Device');
const mqttClient = require('../services/mqttService');


exports.getDeviceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const device = await Device.findOne({ deviceID: id });
    if (!device) return res.status(404).json({ message: 'Device not found' });
    
    res.status(200).json(device);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching device status' });
  }
};

exports.calibrateDevice = async (req, res) => {
  try {
    const { id } = req.params;
    const { runningAerators, totalAerators } = req.body;

    const device = await Device.findOne({ deviceID: id });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    const running = parseInt(runningAerators);
    const total = parseInt(totalAerators);

    // 1. Validation: When all aerators are stopped (running <= 0)
    if (isNaN(running) || running <= 0) {
      return res.status(400).json({
        message: 'Calibration stopped: All aerators are stopped. You must have at least one aerator running to calibrate.'
      });
    }

    if (isNaN(total) || total <= 0) {
      return res.status(400).json({
        message: 'Calibration stopped: Please specify a valid number of connected aerators.'
      });
    }

    // Get the latest line3 reading (already updated by MQTT service)
    const currentLine3 = device.currentReadings.line3;

    // 2. Validation: When line three value is less than 2A
    if (currentLine3 < 2.0) {
      return res.status(400).json({
        message: `Calibration stopped: Line 3 current is less than 2A (Current: ${currentLine3.toFixed(2)}A). Ensure aerators are ON.`
      });
    }

    // Calculate current per aerator
    const fixedCurrentPerAerator = currentLine3 / running;

    // 3. Validation: Stop calibrating if calculated per-aerator current is less than 1A
    if (fixedCurrentPerAerator < 1.0) {
      return res.status(400).json({
        message: `Calibration stopped: Calculated per-aerator current is less than 1A (Calculated: ${fixedCurrentPerAerator.toFixed(2)}A).`
      });
    }

    // Validation warning (detected abnormally high current per aerator >4A)
    let message = 'Calibration successful';
    if (fixedCurrentPerAerator > 4) {
      message = 'Calibration successful, but detected abnormal high current per aerator (>4A). Please inspect hardware.';
    }
    
    device.fixedCurrentPerAerator = fixedCurrentPerAerator;
    device.totalAerators = total; // Save total number of aerators connected
    device.workingAerators = running; // Set working aerators immediately to the calibrated running value
    device.lastAlertedWorkingCount = total; // Initialize/reset to total aerators
    device.consecutiveEscalationCount = 0; // Reset escalation counter
    device.lastCalibratedAt = new Date();
    device.isCalibrated = true;
    
    device.history.push({
      type: 'Calibration',
      message: `${message}. Running: ${running}, Connected: ${total}, Fixed current: ${fixedCurrentPerAerator.toFixed(2)}A`,
      timestamp: new Date()
    });

    await device.save();

    // Broadcast updated state to all WebSocket clients
    try {
      const { broadcastDeviceUpdate } = require('../services/websocketService');
      broadcastDeviceUpdate(id, device);
    } catch (wsErr) {
      console.error('WS broadcast error after calibration:', wsErr);
    }

    res.status(200).json({
      message,
      data: {
        fixedCurrentPerAerator,
        totalAerators: total,
        lastCalibratedAt: device.lastCalibratedAt
      }
    });

  } catch (error) {
    res.status(500).json({ message: 'Calibration failed', error: error.message });
  }
};

exports.getDeviceHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const device = await Device.findOne({ deviceID: id });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    res.status(200).json(device.history);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching history' });
  }
};

exports.deleteDeviceHistoryItem = async (req, res) => {
  try {
    const { id, historyId } = req.params;
    const device = await Device.findOne({ deviceID: id });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    // Filter out the history item by ID
    device.history = device.history.filter(item => item._id.toString() !== historyId);
    await device.save();

    res.status(200).json({ message: 'History item deleted successfully', history: device.history });
  } catch (error) {
    console.error('Error deleting history item:', error);
    res.status(500).json({ message: 'Error deleting history item', error: error.message });
  }
};

exports.toggleRelay = async (req, res) => {
  try {
    const { id } = req.params;
    const { relay1toggle, relay2toggle } = req.body;

    const device = await Device.findOne({ deviceID: id });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    // Resolve final values (use current status if not provided)
    const r1 = relay1toggle !== null && relay1toggle !== undefined
      ? Boolean(relay1toggle)
      : device.relays[0]?.status ?? false;
    const r2 = relay2toggle !== null && relay2toggle !== undefined
      ? Boolean(relay2toggle)
      : device.relays[1]?.status ?? false;

    // Publish MQTT command to hardware
    let controlTopic = `PMS/${id}/control`;
    if (id === 'PMS_001') controlTopic = 'PMS1/control';
    else if (id === 'PMS_002') controlTopic = 'PMS2/control';
    else if (id === 'PMS_003') controlTopic = 'PMS3/control';
    else if (id === 'PMS_004') controlTopic = 'PMS4/control';

    const commandPayload = { deviceID: id, relay1toggle: r1, relay2toggle: r2 };
    mqttClient.publish(controlTopic, JSON.stringify(commandPayload));
    console.log(`📤 [RELAY] Published to ${controlTopic}:`, commandPayload);

    // Save to DB immediately so next WS broadcast reflects correct state
    if (device.relays.length >= 1) device.relays[0].status = r1;
    if (device.relays.length >= 2) device.relays[1].status = r2;
    await device.save();

    // Broadcast updated state to all WebSocket clients
    try {
      const { broadcastDeviceUpdate } = require('../services/websocketService');
      broadcastDeviceUpdate(id, device);
    } catch (wsErr) {
      console.error('WS broadcast error after relay toggle:', wsErr);
    }

    res.status(200).json({ message: 'Command sent', data: commandPayload });
  } catch (error) {
    res.status(500).json({ message: 'Error sending command', error: error.message });
  }
};

exports.updateDeviceSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, location, relayCount, totalAerators } = req.body;

    const device = await Device.findOne({ deviceID: id });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    if (name !== undefined) device.name = name;
    if (location !== undefined) device.location = location;
    
    if (totalAerators !== undefined) {
      const newTotal = parseInt(totalAerators) || 0;
      if (device.totalAerators !== newTotal) {
        device.totalAerators = newTotal;
        device.isCalibrated = false;
        device.fixedCurrentPerAerator = 0;
        device.workingAerators = 0; // Reset working aerators since calibration is invalidated
        device.lastAlertedWorkingCount = 0;
        device.consecutiveEscalationCount = 0;
      }
    }

    if (relayCount !== undefined) {
      const rCount = parseInt(relayCount) || 2;
      device.relayCount = rCount;
      // Adjust relays array if needed
      if (device.relays.length < rCount) {
        for (let i = device.relays.length; i < rCount; i++) {
          device.relays.push({ name: `Relay ${i + 1}`, status: false });
        }
      } else if (device.relays.length > rCount) {
        device.relays = device.relays.slice(0, rCount);
      }
    }

    await device.save();

    // Broadcast updated state to all WebSocket clients
    try {
      const { broadcastDeviceUpdate } = require('../services/websocketService');
      broadcastDeviceUpdate(id, device);
    } catch (wsErr) {
      console.error('WS broadcast error after settings update:', wsErr);
    }

    res.status(200).json({ message: 'Device settings updated', device });
  } catch (error) {
    res.status(500).json({ message: 'Error updating device settings', error: error.message });
  }
};

exports.sendTestNotification = async (req, res) => {
  try {
    const { email, message } = req.query;
    const testMsg = message || 'Test alert from Smart Synergies backend!';
    const DeviceToken = require('../models/DeviceToken');
    
    let query = {};
    if (email && email !== 'all') {
      query.userEmail = email.toLowerCase().trim();
    }
    
    const tokens = await DeviceToken.find(query);
    const registrationTokens = tokens.map(t => t.token);
    
    if (registrationTokens.length === 0) {
      return res.status(404).json({ 
        message: email ? `No tokens found for ${email} in database.` : 'No tokens found in the database at all.',
        tip: 'Please restart the Flutter app or login to ensure the FCM token is synced.'
      });
    }
    
    const admin = require('firebase-admin');
    const payload = {
      notification: {
        title: '⚠️ Aerator Alert (Test)',
        body: testMsg,
      },
      data: {
        title: '⚠️ Aerator Alert (Test)',
        body: testMsg,
        alarm: '1',
        deviceID: 'PMS_TEST',
        alertId: `ALERT_TEST_${Date.now()}`
      },
      tokens: registrationTokens,
      android: {
        priority: 'high'
      }
    };
    
    const response = await admin.messaging().sendEachForMulticast(payload);
    res.status(200).json({ 
      message: 'Test triggered successfully', 
      successCount: response.successCount,
      failureCount: response.failureCount,
      tokensAttempted: registrationTokens.length,
      recipients: tokens.map(t => ({ email: t.userEmail, token: t.token.substring(0, 15) + '...' }))
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send test notification', error: err.message });
  }
};


