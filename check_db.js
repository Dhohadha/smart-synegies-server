const mongoose = require('mongoose');
require('dotenv').config();

const Device = require('./models/Device');
const User = require('./models/User');
const DeviceToken = require('./models/DeviceToken');
const Notification = require('./models/Notification');

async function check() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('CONNECTED TO MONGO');

    const notifications = await Notification.find({}).sort({ timestamp: -1 }).limit(10);
    console.log('\n--- LATEST 10 NOTIFICATIONS IN DB ---');
    for (const n of notifications) {
      console.log(`Type: ${n.type}`);
      console.log(`Email: ${n.userEmail}`);
      console.log(`Title: ${n.title}`);
      console.log(`Message: ${n.message}`);
      console.log(`Timestamp: ${n.timestamp}`);
      console.log('-----------------');
    }

    const tokens = await DeviceToken.find({});
    console.log('\n--- DEVICE TOKENS IN DB ---');
    for (const t of tokens) {
      console.log(`Email: ${t.userEmail}`);
      console.log(`Token: ${t.token.substring(0, 30)}...`);
      console.log(`Last Updated: ${t.lastUpdated}`);
      console.log('-----------------');
    }

    const users = await User.find({});
    console.log('\n--- USERS IN DB ---');
    for (const u of users) {
      console.log(`Email: ${u.email}`);
      console.log(`Name: ${u.name}`);
      console.log(`Assigned Devices: ${JSON.stringify(u.assignedDevices)}`);
      console.log(`accessRevoked: ${u.accessRevoked}`);
      console.log('-----------------');
    }

    const devices = await Device.find({});
    console.log('\n--- DEVICES IN DB ---');
    for (const d of devices) {
      console.log(`Device ID: ${d.deviceID}`);
      console.log(`isCalibrated: ${d.isCalibrated}`);
      console.log(`fixedCurrentPerAerator: ${d.fixedCurrentPerAerator}`);
      console.log(`totalAerators: ${d.totalAerators}`);
      console.log(`workingAerators: ${d.workingAerators}`);
      console.log(`currentReadings: ${JSON.stringify(d.currentReadings)}`);
      console.log('-----------------');
    }

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await mongoose.disconnect();
    console.log('DISCONNECTED');
  }
}

check();
