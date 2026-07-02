const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true }, // Firebase UID
  name: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, required: true },
  role: { type: String, enum: ['Admin', 'User'], default: 'User' },
  fcmToken: { type: String },
  settings: {
    alertSoundEnabled: { type: Boolean, default: true },
    mutedDevices: [{ type: String }] // deviceIDs for which sound alerts are muted
  },
  assignedDevices: [{ type: String }], // Array of deviceIDs
  isSharedUser: { type: Boolean, default: false },
  mainUserEmail: { type: String }, // Who gave them access
  sharedWith: [{ type: String }], // Emails of people they shared with
  accessRevoked: { type: Boolean, default: false }, // Set when owner removes access
  revokedBy: { type: String }, // Email of the owner who revoked access
  pendingInvitations: [{
    ownerEmail: String,
    ownerName: String,
    devices: [String],
    status: { type: String, enum: ['pending', 'declined'], default: 'pending' },
    timestamp: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
