const mongoose = require('mongoose');
require('dotenv').config();

const Device = require('./models/Device');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('CONNECTED TO MONGO');

    // Update PMS_001
    const pms001 = await Device.findOne({ deviceID: 'PMS_001' });
    if (pms001) {
      pms001.totalAerators = 4;
      pms001.isCalibrated = false;
      pms001.fixedCurrentPerAerator = 0;
      await pms001.save();
      console.log('Updated PMS_001');
    }

    // Update PMS_002
    const pms002 = await Device.findOne({ deviceID: 'PMS_002' });
    if (pms002) {
      pms002.totalAerators = 4;
      pms002.isCalibrated = false;
      pms002.fixedCurrentPerAerator = 0;
      await pms002.save();
      console.log('Updated PMS_002');
    }

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await mongoose.disconnect();
    console.log('DISCONNECTED');
  }
}

run();
