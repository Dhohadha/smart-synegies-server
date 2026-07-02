const mqtt = require('mqtt');
const Device = require('../models/Device');
const admin = require('firebase-admin');
const User = require('../models/User');
const DeviceToken = require('../models/DeviceToken');
const Notification = require('../models/Notification');

const client = mqtt.connect(process.env.MQTT_BROKER_URL);

client.on('error', (err) => {
  console.error('MQTT Connection Error:', err);
});

client.on('connect', () => {
  console.log('Connected to MQTT Broker');
  const topics = ['PMS1/data', 'PMS2/data', 'PMS3/data', 'PMS4/data', 'PMS/+/data'];
  client.subscribe(topics, (err) => {
    if (!err) {
      console.log(`Subscribed to topics: ${topics.join(', ')}`);
    }
  });
});

const deviceQueues = new Map();
const activeDevicesTracker = new Map();

client.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    
    let deviceID = null;
    if (topic === 'PMS1/data') {
      deviceID = 'PMS_001';
    } else if (topic === 'PMS2/data') {
      deviceID = 'PMS_002';
    } else if (topic === 'PMS3/data') {
      deviceID = 'PMS_003';
    } else if (topic === 'PMS4/data') {
      deviceID = 'PMS_004';
    } else if (topic.startsWith('PMS/') && topic.endsWith('/data')) {
      // Pattern: PMS/deviceID/data
      deviceID = topic.split('/')[1];
    } else if (data.deviceID) {
      // Fallback to payload if topic doesn't match expected pattern but payload has ID
      deviceID = data.deviceID;
    }

    if (!deviceID) {
      console.log(`⚠️ Received message on [${topic}] but could not determine deviceID`);
      return;
    }

    // Initialize or get the queue for this deviceID
    if (!deviceQueues.has(deviceID)) {
      deviceQueues.set(deviceID, Promise.resolve());
    }

    // Queue the message processing sequentially per deviceID
    const currentPromise = deviceQueues.get(deviceID);
    const nextPromise = currentPromise.then(async () => {
      try {
        await processDeviceMessage(deviceID, topic, data);
      } catch (err) {
        console.error(`❌ Error processing sequential MQTT message for device ${deviceID}:`, err);
      }
    });
    deviceQueues.set(deviceID, nextPromise);

  } catch (error) {
    console.error('Error parsing/queuing MQTT message:', error);
  }
});

async function processDeviceMessage(deviceID, topic, data) {
  // Safely parse electrical readings to float with fallbacks to avoid NaN CastErrors in MongoDB
  // Supports both Red-Yellow-Blue (IR, IY, IB) from actual hardware and line1, line2, line3
  let line1Val = parseFloat(data.IR !== undefined ? data.IR : data.line1);
  if (isNaN(line1Val)) line1Val = 0.0;
  
  let line2Val = parseFloat(data.IY !== undefined ? data.IY : data.line2);
  if (isNaN(line2Val)) line2Val = 0.0;
  
  let line3Val = parseFloat(data.IB !== undefined ? data.IB : data.line3);
  if (isNaN(line3Val)) line3Val = 0.0;

  let device = await Device.findOne({ deviceID });
  if (!device) {
    // Create a dummy device if not exists (usually created by Admin first)
    device = new Device({ deviceID });
  }

  // Update readings
  device.currentReadings = { line1: line1Val, line2: line2Val, line3: line3Val };

  // Update Connectivity Status
  if (device.isActive === false && device.lastSeen) {
    device.history.push({
      type: 'Update',
      message: `Device came back online after being inactive.`,
      timestamp: new Date()
    });
    console.log(`[STATUS] 🟢 Device [${deviceID}] is back ONLINE after being inactive since ${device.inactiveSince ? device.inactiveSince.toISOString() : 'unknown'} | Active Devices: ${activeDevicesTracker.size} [${[...activeDevicesTracker.keys()].join(', ')}]`);
  }
  device.isActive = true;
  device.lastSeen = new Date();
  device.inactiveSince = null;

  // Update relay status ONLY if they are explicitly present in the MQTT payload
  if (data.relay1Status !== undefined && device.relays && device.relays.length >= 1) {
    device.relays[0].status = data.relay1Status === true || data.relay1Status === 'true' || data.relay1Status === 1 || data.relay1Status === '1';
  }
  if (data.relay2Status !== undefined && device.relays && device.relays.length >= 2) {
    device.relays[1].status = data.relay2Status === true || data.relay2Status === 'true' || data.relay2Status === 1 || data.relay2Status === '1';
  }

  // Smoothing Logic: Last 5 line3 messages
  if (!device.lastMessages) {
    device.lastMessages = [];
  }
  device.lastMessages.push(line3Val);
  if (device.lastMessages.length > 5) {
    device.lastMessages.shift();
  }

  // Filter and compute safe moving average (robust against NaNs)
  let validMessages = device.lastMessages.map(m => parseFloat(m)).filter(m => !isNaN(m));
  
  // If the current reading is active (>= 2.0A), ignore any historical readings that were inactive (< 2.0A)
  // to prevent startup/shutdown lag from distorting active aerator count
  if (line3Val >= 2.0) {
    validMessages = validMessages.filter(m => m >= 2.0);
  }
  
  const avgLine3 = validMessages.length > 0 
    ? (validMessages.reduce((a, b) => a + b, 0) / validMessages.length)
    : 0.0;

  // Aerator Detection (Only if calibrated)
  if (device.isCalibrated && device.fixedCurrentPerAerator > 0) {
    // Use the actual current reading (line3Val) directly to show real-time changes instantly
    let workingAerators = Math.round(line3Val / device.fixedCurrentPerAerator);
    if (isNaN(workingAerators) || workingAerators < 0) {
      workingAerators = 0;
    }
    const totalAerators = device.totalAerators || 0;
    
    // Safety cap workingAerators to totalAerators
    if (workingAerators > totalAerators) {
      workingAerators = totalAerators;
    }

    device.workingAerators = workingAerators; // Store it

    const notWorkingCount = totalAerators - workingAerators;

    // 1. Alerts only trigger if number of not working aerators > 2
    if (notWorkingCount > 2) {
      // Increment the consecutive faults counter only if alert is not active and count is under 7
      if (!device.alertActive && (device.consecutiveFaultsCount || 0) < 7) {
        device.consecutiveFaultsCount = (device.consecutiveFaultsCount || 0) + 1;
        console.log(`⚠️ Fault detected for device ${deviceID}: ${notWorkingCount} not working. Consecutive count: ${device.consecutiveFaultsCount}/7`);
      }

      // 2. Consistent for 7 consecutive MQTT messages
      if (device.consecutiveFaultsCount === 7 && !device.alertActive) {
        await triggerNotification(
          deviceID,
          `Alert: ${notWorkingCount} Aerator(s) not working! (${workingAerators}/${totalAerators})`
        );
        device.alertActive = true;
        
        // Log to device history
        device.history.push({
          type: 'Alert',
          message: `Critical Alert: ${notWorkingCount} Aerators not working (${workingAerators}/${totalAerators}) triggered after 7 consistent readings.`,
          timestamp: new Date()
        });
      }
    } else {
      // Reset the consecutive counter because we are in a normal/nominal state (notWorkingCount <= 2)
      device.consecutiveFaultsCount = 0;

      // 3. Recovery: Send a notification after the alert when all the aerators are working again
      if (workingAerators === totalAerators) {
        if (device.alertActive) {
          await triggerNotification(
            deviceID,
            `Info: All aerators are working again! (${workingAerators}/${totalAerators})`,
            true
          );
          device.alertActive = false;

          // Log recovery to device history
          device.history.push({
            type: 'Update',
            message: `Recovery: All ${totalAerators} aerators are working again. Alert dismissed.`,
            timestamp: new Date()
          });
        }
      }
    }
  } else {
    device.workingAerators = 0;
    device.consecutiveFaultsCount = 0;
  }

  // Change-tracking state updater (no spammy logs - status logged by interval checker)
  let tracker = activeDevicesTracker.get(deviceID);
  const currentReadingsStr = `${line1Val.toFixed(1)}A, ${line2Val.toFixed(1)}A, ${line3Val.toFixed(1)}A`;

  if (!tracker) {
    tracker = {
      topic: topic,
      lastReadings: currentReadingsStr,
      lastWorkingAerators: device.workingAerators,
      wasActive: false
    };
    activeDevicesTracker.set(deviceID, tracker);
    // Log first time we see a device become active
    const activeList = [...activeDevicesTracker.keys()].join(', ');
    console.log(`[STATUS] 🟢 Device [${deviceID}] on topic [${topic}] is now ONLINE | Active Devices: ${activeDevicesTracker.size} [${activeList}]`);
    tracker.wasActive = true;
  } else {
    tracker.lastReadings = currentReadingsStr;
    tracker.lastWorkingAerators = device.workingAerators;
    tracker.topic = topic;
  }

  await device.save();

  // Broadcast real-time update to WebSocket clients
  try {
    const { broadcastDeviceUpdate } = require('./websocketService');
    broadcastDeviceUpdate(deviceID, device);
  } catch (wsErr) {
    console.error('Error broadcasting WS update:', wsErr);
  }
}

async function triggerNotification(deviceID, message, isRecovery = false) {
  try {
    const Device = require('../models/Device');
    const device = await Device.findOne({ deviceID });
    const deviceLabel = (device && device.name) ? device.name : deviceID;
    const formattedMessage = `[${deviceLabel}] ${message}`;

    const users = await User.find({ assignedDevices: deviceID });
    
    for (const user of users) {
      // Prevent spamming the same user with the same alert within 5 minutes
      // Since aerator faults contain varying current values or counts,
      // we check using regular expressions to match any aerator fault alerts.
      // We also scope this check strictly per-device by matching the device prefix.
      let query = {
        userEmail: user.email,
        timestamp: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
      };

      if (message.includes('Aerator(s) not working!')) {
        const escapedLabel = deviceLabel.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        query.message = { $regex: new RegExp(`^\\[${escapedLabel}\\].*not working!`) };
      } else {
        query.message = formattedMessage;
      }

      const recentAlert = await Notification.findOne(query);

      if (!recentAlert) {
        const notificationTitle = isRecovery ? '✅ Aerator Recovered' : '⚠️ Aerator Alert';
        const notificationType = isRecovery ? 'INFO' : 'ALARM';
        const alarmFlag = isRecovery ? '0' : '1';

        await new Notification({ 
          title: notificationTitle, 
          message: formattedMessage, 
          type: notificationType,
          userEmail: user.email 
        }).save();
        
        // Fetch tokens for this user
        const tokens = await DeviceToken.find({ userEmail: user.email });
        const registrationTokens = tokens.map(t => t.token);

        if (registrationTokens.length > 0) {
          const payload = {
            notification: {
              title: notificationTitle,
              body: formattedMessage,
            },
            data: {
              title: notificationTitle,
              body: formattedMessage,
              alarm: alarmFlag,
              deviceID: deviceID,
              alertId: `ALERT_${Date.now()}`,
            },
            tokens: registrationTokens,
            android: {
              priority: 'high',
            },
          };

          const response = await admin.messaging().sendEachForMulticast(payload);
          console.log(`Successfully sent ${response.successCount} push notifications to ${user.email}`);
          
          // Cleanup invalid tokens
          if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
              if (!resp.success) failedTokens.push(registrationTokens[idx]);
            });
            if (failedTokens.length > 0) {
              await DeviceToken.deleteMany({ token: { $in: failedTokens } });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error sending FCM notification:', error);
  }
}

let hasAlertedAdminServerIssue = false;

// Periodic Activity Checker (Every 1 minute)
setInterval(async () => {
  try {
    const Device = require('../models/Device');
    const { broadcastDeviceUpdate, broadcastGlobalMessage } = require('./websocketService');
    const User = require('../models/User');
    const admin = require('firebase-admin');

    const devices = await Device.find({});
    if (devices.length === 0) return;

    let activeCount = 0;
    const timeoutThreshold = 5 * 60 * 1000; // 5 minutes

    for (let device of devices) {
      if (device.isActive) {
        if (device.lastSeen && (Date.now() - device.lastSeen.getTime() > timeoutThreshold)) {
          // Device timed out
          device.isActive = false;
          device.inactiveSince = device.lastSeen;
          device.history.push({
            type: 'Alert',
            message: `Device went offline (no data received for 5 minutes).`,
            timestamp: new Date()
          });
          await device.save();

          console.log(`[STATUS] 🔴 Device [${device.deviceID}] is now OFFLINE | Last seen: ${device.lastSeen.toISOString()} | Inactive since: ${device.inactiveSince.toISOString()}`);
          
          // Remove from in-memory tracker so it re-logs when it comes back
          activeDevicesTracker.delete(device.deviceID);
          const remainingList = [...activeDevicesTracker.keys()].join(', ') || 'none';
          console.log(`[STATUS] 📊 Active Devices remaining: ${activeDevicesTracker.size} [${remainingList}]`);
          
          try {
            broadcastDeviceUpdate(device.deviceID, device);
          } catch (e) { console.error('Error broadcasting WS:', e); }
        } else {
          activeCount++;
        }
      }
    }

    // Global Server Issue Check
    if (activeCount === 0 && devices.length > 0) {
      try {
        broadcastGlobalMessage('server_issue_warning', { status: true, message: 'All devices are offline. Possible server issue.' });
      } catch (e) {}

      if (!hasAlertedAdminServerIssue) {
        hasAlertedAdminServerIssue = true;
        // Notify Admins
        const admins = await User.find({ role: 'Admin' });
        for (const adminUser of admins) {
           if (adminUser.fcmToken) {
              const payload = {
                notification: {
                  title: 'Critical Server Warning',
                  body: 'All connected devices have gone offline. Please check the MQTT broker and backend connectivity.'
                },
                token: adminUser.fcmToken
              };
              try {
                await admin.messaging().send(payload);
              } catch(e) { console.error('FCM Admin Send Error:', e); }
           }
        }
      }
    } else {
      hasAlertedAdminServerIssue = false;
      try {
        broadcastGlobalMessage('server_issue_warning', { status: false });
      } catch (e) {}
    }

  } catch (err) {
    console.error('Error in periodic activity checker:', err);
  }
}, 60000);

module.exports = client;
