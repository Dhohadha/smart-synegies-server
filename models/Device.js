const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceID: { type: String, required: true, unique: true },
  name: { type: String },
  location: { type: String },
  relayCount: { type: Number, default: 2 },
  relays: [{
    name: { type: String },
    status: { type: Boolean, default: false }
  }],
  // Calibration Data
  fixedCurrentPerAerator: { type: Number, default: 0 },
  totalAerators: { type: Number, default: 0 },
  workingAerators: { type: Number, default: 0 },
  lastAlertedWorkingCount: { type: Number, default: 0 },
  consecutiveEscalationCount: { type: Number, default: 0 },
  lastAlertSentAt: { type: Date },
  lastCalibratedAt: { type: Date },
  isCalibrated: { type: Boolean, default: false },
  consecutiveFaultsCount: { type: Number, default: 0 },
  alertActive: { type: Boolean, default: false },
  // Connectivity Status
  isActive: { type: Boolean, default: false },
  lastSeen: { type: Date },
  inactiveSince: { type: Date },
  // Runtime Data
  currentReadings: {
    line1: { type: Number, default: 0 },
    line2: { type: Number, default: 0 },
    line3: { type: Number, default: 0 }
  },
  lastMessages: [{ type: Number }], // Store last 5 line3 values for moving average
  // History (Capped at 1 month or managed by logic)
  history: [{
    timestamp: { type: Date, default: Date.now },
    type: { type: String, enum: ['Alert', 'Calibration', 'Update'] },
    message: { type: String },
    data: mongoose.Schema.Types.Mixed
  }]
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Device', deviceSchema);
