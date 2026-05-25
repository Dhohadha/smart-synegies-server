const mongoose = require('mongoose');
require('dotenv').config();
const Device = require('./models/Device');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const device = await Device.findOne({ deviceID: 'pms_003' });
  if (device) {
    console.log('lastMessages:', device.lastMessages);
    console.log('currentReadings:', device.currentReadings);
    console.log('fixedCurrentPerAerator:', device.fixedCurrentPerAerator);
    console.log('workingAerators:', device.workingAerators);
    console.log('consecutiveFaultsCount:', device.consecutiveFaultsCount);
    console.log('alertActive:', device.alertActive);
    
    const validMessages = device.lastMessages.map(m => parseFloat(m)).filter(m => !isNaN(m));
    const avgLine3 = validMessages.length > 0 
      ? (validMessages.reduce((a, b) => a + b, 0) / validMessages.length)
      : 0.0;
    console.log('Calculated avgLine3:', avgLine3);
    console.log('Math.floor(avgLine3 / 1.5):', Math.floor(avgLine3 / 1.5));
    console.log('Math.round(avgLine3 / 1.5):', Math.round(avgLine3 / 1.5));
  } else {
    console.log('Device pms_003 not found');
  }
  
  const DeviceToken = require('./models/DeviceToken');
  const tokens = await DeviceToken.find({});
  console.log('\n--- REGISTERED DEVICE TOKENS ---');
  for (const t of tokens) {
    console.log(`User Email: ${t.userEmail}`);
    console.log(`Token: ${t.token.substring(0, 20)}...`);
    console.log('-----------------');
  }
  await mongoose.disconnect();
}

run();
