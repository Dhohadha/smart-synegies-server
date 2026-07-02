const admin = require('firebase-admin');
const User = require('../models/User');
const Device = require('../models/Device');
const DeviceToken = require('../models/DeviceToken');
const Notification = require('../models/Notification');

exports.registerUser = async (req, res) => {
  try {
    const { name, phone, email, deviceId, ponds, aerators } = req.body;
    
    // In a full implementation, we'd create a Firebase user here using admin.auth().createUser()
    // For now, we simulate this by accepting a generated UID or mocking it if missing.
    // However, since we are doing Google Sign-In, the user already has a Firebase UID when they sign up.
    // Since the Admin is creating the user before they log in, we can either:
    // 1. Just store the email, and when they login with Google, we link it.
    // 2. Pre-create the Firebase user.
    // Let's go with #1: We create a User record. We can use email as a unique identifier for now, and update UID on first login.
    
    let normalizedEmail = email.toLowerCase();
    console.log(`[Admin] Registering/Updating user with email: ${normalizedEmail}`);
    let user = await User.findOne({ email: normalizedEmail });
    if (user) {
      // Update existing
      user.name = name;
      user.phone = phone;
      if (deviceId && !user.assignedDevices.includes(deviceId)) {
        user.assignedDevices.push(deviceId);
      }
      if (!user.settings) {
        user.settings = { alertSoundEnabled: true };
      } else if (user.settings.alertSoundEnabled === undefined) {
        user.settings.alertSoundEnabled = true;
      }
    } else {
      user = new User({
        uid: normalizedEmail, // Temporary UID, replace with actual Firebase UID on first login
        name,
        phone,
        email: normalizedEmail,
        assignedDevices: deviceId ? [deviceId] : [],
        settings: { alertSoundEnabled: true }
      });
    }

    await user.save();

    // Create device if not exists, or update if exists
    if (deviceId) {
      let device = await Device.findOne({ deviceID: deviceId });
      const rCount = parseInt(req.body.relayCount) || 2;
      const aeratorsVal = parseInt(aerators) || 0;
      
      if (!device) {
        const relayList = [];
        for (let i = 0; i < rCount; i++) {
          relayList.push({ name: `Relay ${i + 1}`, status: false });
        }
        
        device = new Device({
          deviceID: deviceId,
          relayCount: rCount,
          relays: relayList,
          totalAerators: aeratorsVal,
        });
        await device.save();
      } else {
        // Device already exists (e.g. from MQTT autosave), update its parameters
        device.totalAerators = aeratorsVal;
        device.relayCount = rCount;
        
        // Adjust relays array size if needed
        if (device.relays.length < rCount) {
          for (let i = device.relays.length; i < rCount; i++) {
            device.relays.push({ name: `Relay ${i + 1}`, status: false });
          }
        } else if (device.relays.length > rCount) {
          device.relays = device.relays.slice(0, rCount);
        }
        await device.save();
      }
    }

    res.status(201).json({ message: 'User registered successfully', user });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ message: 'Error registering user' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const users = await User.find().select('-fcmToken');
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users' });
  }
};

exports.getUserProfile = async (req, res) => {
  try {
    const email = req.user.email.toLowerCase(); // From Firebase Token
    console.log(`[User] Searching for profile with email: ${email}`);
    
    const user = await User.findOne({ email });
    if (!user) {
      console.log(`[User] Profile not found for email: ${email}`);
      return res.status(404).json({ message: 'User profile not found' });
    }
    
    console.log(`[User] Found profile for: ${email}`);
    // If UID is still email (pre-registered by admin), update it to actual Firebase UID
    if (user.uid === user.email && req.user.uid) {
      user.uid = req.user.uid;
      await user.save();
    }

    // If revoked user now has active pending invitations from a new owner, clear the revoked flag
    const activePendingInvites = (user.pendingInvitations || []).filter(i => i.status !== 'declined');
    if (user.accessRevoked && activePendingInvites.length > 0) {
      user.accessRevoked = false;
      user.revokedBy = null;
      await user.save();
    }

    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user profile' });
  }
};

// Add device to user
exports.addDeviceToUser = async (req, res) => {
  try {
    const { email } = req.params;
    const { deviceId } = req.body;
    
    let user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.assignedDevices.includes(deviceId)) {
      user.assignedDevices.push(deviceId);
      await user.save();
    }

    // Create device if not exists
    let device = await Device.findOne({ deviceID: deviceId });
    if (!device) {
      device = new Device({
        deviceID: deviceId,
        relays: [{ name: 'Relay 1' }, { name: 'Relay 2' }]
      });
      await device.save();
    }

    res.status(200).json({ message: 'Device added successfully', user });
  } catch (error) {
    res.status(500).json({ message: 'Error adding device' });
  }
};

// Remove device from user
exports.removeDeviceFromUser = async (req, res) => {
  try {
    const { email, deviceId } = req.params;
    
    let user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.assignedDevices = user.assignedDevices.filter(id => id !== deviceId);
    await user.save();

    res.status(200).json({ message: 'Device removed successfully', user });
  } catch (error) {
    res.status(500).json({ message: 'Error removing device' });
  }
};

// Share access (User App - Secure, Invitation based)
exports.shareAccess = async (req, res) => {
  try {
    const email = req.user.email.toLowerCase();
    let { sharedEmail, deviceIds } = req.body;
    
    if (!sharedEmail) return res.status(400).json({ error: 'Shared email is required' });
    sharedEmail = sharedEmail.toLowerCase().trim();

    let owner = await User.findOne({ email });
    if (!owner) return res.status(404).json({ error: 'Owner user not found' });

    // Constraint: Shared users cannot share further
    if (owner.isSharedUser) {
      return res.status(403).json({ error: 'Access denied: Shared users cannot share devices' });
    }

    if (!owner.assignedDevices || owner.assignedDevices.length === 0) {
      return res.status(400).json({ error: 'No devices to share' });
    }

    // Determine which devices to share
    const devicesToShare = deviceIds && Array.isArray(deviceIds) ? deviceIds : owner.assignedDevices;
    
    // Filter to ensure only devices owned by the owner are shared
    const unauthorized = devicesToShare.filter(id => !owner.assignedDevices.includes(id));
    if (unauthorized.length > 0) {
      return res.status(403).json({ error: 'You do not have access to some of these devices' });
    }

    let recipient = await User.findOne({ email: sharedEmail });
    if (recipient && recipient.assignedDevices && recipient.assignedDevices.length > 0 && !recipient.isSharedUser) {
      return res.status(403).json({ error: 'You cannot share access with another owner.' });
    }

    // Create invitation instead of immediate assignment
    const invitation = {
      ownerEmail: owner.email,
      ownerName: owner.name,
      devices: devicesToShare,
      status: 'pending'
    };

    if (recipient) {
      recipient.accessRevoked = false;
      recipient.revokedBy = null;

      // Check if a declined invitation from this owner already exists
      const existingInviteIdx = recipient.pendingInvitations.findIndex(
        i => i.ownerEmail === owner.email.toLowerCase()
      );
      if (existingInviteIdx !== -1) {
        // Reset existing invitation to pending with updated devices
        recipient.pendingInvitations[existingInviteIdx].status = 'pending';
        recipient.pendingInvitations[existingInviteIdx].devices = devicesToShare;
        recipient.pendingInvitations[existingInviteIdx].ownerName = owner.name;
        recipient.pendingInvitations[existingInviteIdx].timestamp = new Date();
      } else {
        recipient.pendingInvitations.push(invitation);
      }
      if (!recipient.settings) {
        recipient.settings = { alertSoundEnabled: true };
      } else if (recipient.settings.alertSoundEnabled === undefined) {
        recipient.settings.alertSoundEnabled = true;
      }
      await recipient.save();
    } else {
      recipient = new User({
        uid: sharedEmail,
        name: sharedEmail.split('@')[0],
        phone: 'N/A',
        email: sharedEmail,
        role: 'User',
        pendingInvitations: [invitation],
        settings: { alertSoundEnabled: true }
      });
      await recipient.save();
    }

    // Add to owner's shared list
    if (!owner.sharedWith.includes(sharedEmail)) {
      owner.sharedWith.push(sharedEmail);
      await owner.save();
    }

    // Send FCM notification to recipient
    try {
      const tokens = await DeviceToken.find({ userEmail: sharedEmail });
      if (tokens && tokens.length > 0) {
        const message = {
          notification: {
            title: 'New Device Access Invite',
            body: `${owner.name || owner.email} wants to share device access with you.`,
          },
          data: {
            title: 'New Device Access Invite',
            body: `${owner.name || owner.email} wants to share device access with you.`,
            alertId: 'INVITE'
          },
          tokens: tokens.map(t => t.token)
        };
        await admin.messaging().sendEachForMulticast(message);
      }
    } catch (err) {
      console.error('Error sending invite notification:', err);
    }

    res.status(200).json({ message: 'Invitation sent successfully', status: 'pending' });
  } catch (error) {
    console.error('Error in shareAccess:', error);
    res.status(500).json({ error: 'Error sharing access' });
  }
};

// Pre-flight check before sharing access
exports.verifyEmailToShare = async (req, res) => {
  try {
    const { emailToShare } = req.body;
    const owner = await User.findOne({ uid: req.user.uid });

    if (!owner) return res.status(404).json({ error: 'Owner not found' });
    if (owner.isSharedUser) {
      return res.json({ status: 'no_permission', message: 'Shared users cannot share access with others.' });
    }

    const normalizedEmail = emailToShare.toLowerCase().trim();

    if (normalizedEmail === owner.email) {
      return res.json({ status: 'self', message: 'You cannot share access with yourself.' });
    }

    const alreadySharedByYou = owner.sharedWith.includes(normalizedEmail);
    if (alreadySharedByYou) {
      // Check if the invitation was declined — allow reshare in that case
      const targetUser = await User.findOne({ email: normalizedEmail });
      if (targetUser) {
        const invite = targetUser.pendingInvitations.find(
          i => i.ownerEmail === owner.email.toLowerCase()
        );
        if (invite && invite.status === 'declined') {
          return res.json({ status: 'declined_can_reshare', message: `${targetUser.name || normalizedEmail} declined your previous invite. You can reshare.`, name: targetUser.name });
        }
      }
      return res.json({ status: 'already_shared', message: 'You have already shared access with this email.' });
    }

    const targetUser = await User.findOne({ email: normalizedEmail });

    if (!targetUser) {
      return res.json({ status: 'new_user', message: 'This user is not registered yet. They will receive the invite when they sign in.', name: null });
    }

    if (targetUser.assignedDevices && targetUser.assignedDevices.length > 0 && !targetUser.isSharedUser) {
      return res.json({ status: 'is_owner', message: 'You cannot share access with another owner.' });
    }

    const sharedByOtherOwner = targetUser.isSharedUser && targetUser.mainUserEmail && targetUser.mainUserEmail !== owner.email;

    return res.json({
      status: 'ok',
      name: targetUser.name,
      role: targetUser.role,
      sharedByOtherOwner,
      otherOwnerEmail: sharedByOtherOwner ? targetUser.mainUserEmail : null,
      message: sharedByOtherOwner
        ? `This user is already managed by ${targetUser.mainUserEmail}. They can still receive your invite.`
        : `User found: ${targetUser.name}.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Accept Device Access Invitation
exports.acceptInvitation = async (req, res) => {
  try {
    const { ownerEmail } = req.body;
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const invite = user.pendingInvitations.find(i => i.ownerEmail === ownerEmail.toLowerCase());
    if (!invite) return res.status(404).json({ error: 'Invitation not found' });

    // Add devices
    for (const deviceId of invite.devices) {
      if (!user.assignedDevices.includes(deviceId)) {
        user.assignedDevices.push(deviceId);
      }
    }

    user.isSharedUser = true;
    user.mainUserEmail = invite.ownerEmail;
    user.accessRevoked = false;
    user.revokedBy = null;

    // Remove invitation
    user.pendingInvitations = user.pendingInvitations.filter(i => i.ownerEmail !== ownerEmail.toLowerCase());
    
    await user.save();
    res.json({ message: 'Invitation accepted', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Decline Device Access Invitation
exports.declineInvitation = async (req, res) => {
  try {
    const { ownerEmail } = req.body;
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const invite = user.pendingInvitations.find(i => i.ownerEmail === ownerEmail.toLowerCase());
    if (!invite) return res.status(404).json({ error: 'Invitation not found' });

    invite.status = 'declined';
    await user.save();
    res.json({ message: 'Invitation declined' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Revoke shared access from a user
exports.revokeAccess = async (req, res) => {
  try {
    const owner = await User.findOne({ uid: req.user.uid });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

    const sharedEmail = req.params.sharedEmail.toLowerCase();

    // Remove from owner's sharedWith list
    owner.sharedWith = owner.sharedWith.filter(e => e !== sharedEmail);
    await owner.save();

    // Update shared user
    const sharedUser = await User.findOne({ email: sharedEmail });
    if (sharedUser) {
      if (sharedUser.mainUserEmail === owner.email) {
        sharedUser.assignedDevices = sharedUser.assignedDevices.filter(d => !owner.assignedDevices.includes(d));
        sharedUser.isSharedUser = false;
        sharedUser.mainUserEmail = null;
      }
      sharedUser.accessRevoked = true;
      sharedUser.revokedBy = owner.email;
      await sharedUser.save();
    }

    res.json({ message: 'Access revoked successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get shared details for an owner
exports.getSharedDetails = async (req, res) => {
  try {
    const { email } = req.params;
    const owner = await User.findOne({ email: email.toLowerCase() });
    if (!owner) return res.status(404).json({ message: 'Owner not found' });

    const sharedUsers = await User.find({ email: { $in: owner.sharedWith } });
    
    const details = sharedUsers.map(u => {
      const isAccepted = u.mainUserEmail === owner.email;
      let sharedDevices = [];
      let status = 'Pending';
      
      if (isAccepted) {
        // Only return devices that this owner has assigned and the shared user has
        sharedDevices = u.assignedDevices.filter(d => owner.assignedDevices.includes(d));
        status = 'Accepted';
      } else {
        // Check pending invitation
        const invite = u.pendingInvitations.find(
          i => i.ownerEmail === owner.email.toLowerCase()
        );
        sharedDevices = invite ? invite.devices : [];
        if (invite && invite.status === 'declined') {
          status = 'Declined';
        }
      }

      return {
        email: u.email,
        name: u.name,
        role: u.role,
        status,
        devices: sharedDevices
      };
    });

    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update shared devices for a shared user (User App - Owner only)
exports.updateSharedDevices = async (req, res) => {
  try {
    const ownerEmail = req.user.email.toLowerCase();
    let { sharedEmail, deviceIds } = req.body;
    
    if (!sharedEmail) return res.status(400).json({ error: 'Shared email is required' });
    sharedEmail = sharedEmail.toLowerCase().trim();
    
    if (!deviceIds || !Array.isArray(deviceIds)) {
      return res.status(400).json({ error: 'deviceIds must be an array' });
    }

    const owner = await User.findOne({ email: ownerEmail });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

    // Ensure owner actually owns all of these devices
    const unauthorized = deviceIds.filter(id => !owner.assignedDevices.includes(id));
    if (unauthorized.length > 0) {
      return res.status(403).json({ error: 'You do not have access to some of these devices' });
    }

    const sharedUser = await User.findOne({ email: sharedEmail });
    if (!sharedUser) return res.status(404).json({ error: 'Shared user not found' });

    // Check if pending invitation exists
    const inviteIndex = sharedUser.pendingInvitations.findIndex(
      i => i.ownerEmail === ownerEmail
    );

    if (inviteIndex !== -1) {
      // It's still pending: update the invitation's devices
      sharedUser.pendingInvitations[inviteIndex].devices = deviceIds;
      await sharedUser.save();
      return res.json({ message: 'Pending invitation devices updated successfully', status: 'Pending' });
    }

    // It's accepted: update their active assigned devices
    if (sharedUser.mainUserEmail === owner.email) {
      // Filter out any devices that belong to the owner first
      const otherDevices = sharedUser.assignedDevices.filter(d => !owner.assignedDevices.includes(d));
      // Set new device list
      sharedUser.assignedDevices = [...otherDevices, ...deviceIds];
      await sharedUser.save();
      return res.json({ message: 'Shared devices updated successfully', status: 'Accepted' });
    }

    return res.status(400).json({ error: 'This user is not currently shared with you or pending' });
  } catch (err) {
    console.error('Error updating shared devices:', err);
    res.status(500).json({ error: 'Error updating shared devices' });
  }
};


// Admin Share Access (Admin Panel - No Token)
exports.adminShareAccess = async (req, res) => {
  try {
    const { email } = req.params; // Main User Email
    let { sharedEmail, deviceIds } = req.body;
    
    if (!sharedEmail) return res.status(400).json({ message: 'Shared email is required' });
    sharedEmail = sharedEmail.toLowerCase();

    let owner = await User.findOne({ email: email.toLowerCase() });
    if (!owner) return res.status(404).json({ message: 'Owner user not found' });

    // Determine which devices to share
    let devicesToShare = deviceIds && Array.isArray(deviceIds) ? deviceIds : owner.assignedDevices;
    
    // Filter to ensure only devices owned by the owner are shared
    devicesToShare = devicesToShare.filter(id => owner.assignedDevices.includes(id));

    if (devicesToShare.length === 0) {
      return res.status(400).json({ message: 'No valid devices selected for sharing' });
    }

    let sharedUser = await User.findOne({ email: sharedEmail });
    if (sharedUser) {
      devicesToShare.forEach(deviceId => {
        if (!sharedUser.assignedDevices.includes(deviceId)) {
          sharedUser.assignedDevices.push(deviceId);
        }
      });
      sharedUser.isSharedUser = true;
      sharedUser.mainUserEmail = owner.email;
      if (!sharedUser.settings) {
        sharedUser.settings = { alertSoundEnabled: true };
      } else if (sharedUser.settings.alertSoundEnabled === undefined) {
        sharedUser.settings.alertSoundEnabled = true;
      }
      await sharedUser.save();
    } else {
      sharedUser = new User({
        uid: sharedEmail,
        name: 'Shared User',
        phone: 'N/A',
        email: sharedEmail,
        assignedDevices: [...devicesToShare],
        isSharedUser: true,
        mainUserEmail: owner.email,
        settings: { alertSoundEnabled: true }
      });
      await sharedUser.save();
    }

    if (!owner.sharedWith.includes(sharedEmail)) {
      owner.sharedWith.push(sharedEmail);
      await owner.save();
    }

    res.status(200).json({ message: 'Access shared successfully', sharedUser, sharedDevices: devicesToShare });
  } catch (error) {
    res.status(500).json({ message: 'Error sharing access' });
  }
};

exports.updateAlertSound = async (req, res) => {
  try {
    const email = req.user.email.toLowerCase();
    const { alertSoundEnabled } = req.body;
    
    let user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    if (!user.settings) {
      user.settings = {};
    }
    user.settings.alertSoundEnabled = alertSoundEnabled;
    await user.save();
    
    res.status(200).json({ message: 'Settings updated', settings: user.settings });
  } catch (error) {
    res.status(500).json({ message: 'Error updating settings' });
  }
};

exports.updateMutedDevices = async (req, res) => {
  try {
    const email = req.user.email.toLowerCase();
    const { mutedDevices } = req.body;

    if (!Array.isArray(mutedDevices)) {
      return res.status(400).json({ error: 'mutedDevices must be an array' });
    }

    let user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.settings) {
      user.settings = {};
    }
    user.settings.mutedDevices = mutedDevices;
    await user.save();

    res.status(200).json({ message: 'Muted devices updated', settings: user.settings });
  } catch (error) {
    console.error('Error updating muted devices:', error);
    res.status(500).json({ message: 'Error updating muted devices' });
  }
};

exports.updateUserProfile = async (req, res) => {
  try {
    const email = req.user.email.toLowerCase();
    const { name } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    let user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    user.name = name.trim();
    await user.save();
    
    res.status(200).json({ message: 'Profile updated successfully', user });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ message: 'Error updating user profile' });
  }
};

exports.updateDevicesOrder = async (req, res) => {
  try {
    const email = req.user.email.toLowerCase();
    const { deviceIds } = req.body;

    if (!deviceIds || !Array.isArray(deviceIds)) {
      return res.status(400).json({ error: 'deviceIds must be an array' });
    }

    let user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Validate that the array contains the exact same devices
    const currentSet = new Set(user.assignedDevices);
    const newSet = new Set(deviceIds);

    if (currentSet.size !== newSet.size || !deviceIds.every(id => currentSet.has(id))) {
      return res.status(400).json({ error: 'Invalid devices array: must contain only the user\'s currently assigned devices' });
    }

    user.assignedDevices = deviceIds;
    await user.save();

    res.status(200).json({ message: 'Device order updated successfully', user });
  } catch (error) {
    console.error('Error updating device order:', error);
    res.status(500).json({ message: 'Error updating device order' });
  }
};

exports.registerFcmToken = async (req, res) => {
  try {
    const { token } = req.body;
    const userEmail = req.user.email.toLowerCase();
    if (!token) return res.status(400).json({ error: 'Token is required' });

    // 1. Store in DeviceToken for multi-device support
    await DeviceToken.findOneAndUpdate(
      { token },
      { userEmail, lastUpdated: Date.now() },
      { upsert: true }
    );

    // 2. Store directly in User document under fcmToken
    await User.findOneAndUpdate(
      { email: userEmail },
      { fcmToken: token }
    );

    console.log(`✅ FCM Token registered/updated for ${userEmail}`);
    console.log(`🔑 [FCM TOKEN LOG] Token for ${userEmail}: ${token}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    const latest = await Notification.find({ userEmail }).sort({ timestamp: -1 }).limit(100);
    res.json(latest);
  } catch(err) { res.status(500).json({ error: err.message }); }
};

exports.clearNotifications = async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    await Notification.deleteMany({ userEmail });
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
};

exports.deleteNotification = async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    await Notification.findOneAndDelete({ _id: req.params.id, userEmail });
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
};

exports.stopAlert = async (req, res) => {
  try {
    const { alertId } = req.body;
    console.log(`🔕 Alert stopped by user: ${alertId}`);
    // Here we can eventually stop a physical siren via MQTT if needed
    res.json({ success: true, message: 'Alert stopped signal received' });
  } catch (err) {
    console.error('❌ Stop alert error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const email = req.params.email.toLowerCase().trim();
    console.log(`[Admin] Deleting user with email: ${email}`);

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // 1. If this is a shared worker, remove them from their main owner's sharedWith list
    if (user.isSharedUser && user.mainUserEmail) {
      await User.updateOne(
        { email: user.mainUserEmail.toLowerCase() },
        { $pull: { sharedWith: email } }
      );
      console.log(`[Admin] Removed shared user ${email} from main user ${user.mainUserEmail}'s sharedWith list`);
    }

    // 2. If this user is an owner who shared devices with workers, revoke access for those workers
    if (user.sharedWith && user.sharedWith.length > 0) {
      const sharedUsers = await User.find({ email: { $in: user.sharedWith } });
      for (const sharedUser of sharedUsers) {
        if (sharedUser.mainUserEmail === user.email) {
          // Filter out devices shared by this owner
          sharedUser.assignedDevices = sharedUser.assignedDevices.filter(
            d => !user.assignedDevices.includes(d)
          );
          // If no devices left, remove shared status
          if (sharedUser.assignedDevices.length === 0) {
            sharedUser.isSharedUser = false;
            sharedUser.mainUserEmail = null;
          }
          sharedUser.accessRevoked = true;
          sharedUser.revokedBy = user.email;
          await sharedUser.save();
        }
      }
      console.log(`[Admin] Revoked access for ${user.sharedWith.length} shared workers of ${email}`);
    }

    // 3. Delete Firebase Auth user if they exist
    try {
      const firebaseUser = await admin.auth().getUserByEmail(email);
      if (firebaseUser) {
        await admin.auth().deleteUser(firebaseUser.uid);
        console.log(`[Admin] Deleted Firebase Auth user for UID: ${firebaseUser.uid}`);
      }
    } catch (authError) {
      // If user doesn't exist in Firebase yet, log warning and proceed
      console.warn(`[Admin] Firebase Auth user deletion skipped: ${authError.message}`);
    }

    // 4. Clean up associated notifications and device tokens
    await Notification.deleteMany({ userEmail: email });
    await DeviceToken.deleteMany({ userEmail: email });
    console.log(`[Admin] Cleaned up notifications and device tokens for ${email}`);

    // 5. Delete user MongoDB document
    await User.deleteOne({ email });
    console.log(`[Admin] Deleted MongoDB User document for ${email}`);

    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Error deleting user', error: error.message });
  }
};

// Admin Get shared details (No Token)
exports.getSharedDetailsAdmin = async (req, res) => {
  try {
    const { email } = req.params;
    const owner = await User.findOne({ email: email.toLowerCase() });
    if (!owner) return res.status(404).json({ message: 'Owner not found' });

    const sharedUsers = await User.find({ email: { $in: owner.sharedWith } });
    
    const details = sharedUsers.map(u => {
      const isAccepted = u.mainUserEmail === owner.email;
      let sharedDevices = [];
      let status = 'Pending';
      
      if (isAccepted) {
        sharedDevices = u.assignedDevices.filter(d => owner.assignedDevices.includes(d));
        status = 'Accepted';
      } else {
        const invite = u.pendingInvitations.find(
          i => i.ownerEmail === owner.email.toLowerCase()
        );
        sharedDevices = invite ? invite.devices : [];
        if (invite && invite.status === 'declined') {
          status = 'Declined';
        }
      }

      return {
        email: u.email,
        name: u.name,
        role: u.role,
        status,
        devices: sharedDevices
      };
    });

    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Admin Revoke shared access from a user (No Token)
exports.revokeAccessAdmin = async (req, res) => {
  try {
    const { ownerEmail, sharedEmail } = req.params;
    const owner = await User.findOne({ email: ownerEmail.toLowerCase() });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

    const targetEmail = sharedEmail.toLowerCase();

    // Remove from owner's sharedWith list
    owner.sharedWith = owner.sharedWith.filter(e => e !== targetEmail);
    await owner.save();

    // Update shared user
    const sharedUser = await User.findOne({ email: targetEmail });
    if (sharedUser) {
      if (sharedUser.mainUserEmail === owner.email) {
        sharedUser.assignedDevices = sharedUser.assignedDevices.filter(d => !owner.assignedDevices.includes(d));
        sharedUser.isSharedUser = false;
        sharedUser.mainUserEmail = null;
      }
      sharedUser.accessRevoked = true;
      sharedUser.revokedBy = owner.email;
      await sharedUser.save();
    }

    res.json({ message: 'Access revoked successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Admin Update shared devices for a shared user (No Token)
exports.updateSharedDevicesAdmin = async (req, res) => {
  try {
    let { ownerEmail, sharedEmail, deviceIds } = req.body;
    
    if (!ownerEmail) return res.status(400).json({ error: 'Owner email is required' });
    if (!sharedEmail) return res.status(400).json({ error: 'Shared email is required' });
    ownerEmail = ownerEmail.toLowerCase().trim();
    sharedEmail = sharedEmail.toLowerCase().trim();
    
    if (!deviceIds || !Array.isArray(deviceIds)) {
      return res.status(400).json({ error: 'deviceIds must be an array' });
    }

    const owner = await User.findOne({ email: ownerEmail });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

    // Ensure owner actually owns all of these devices
    const unauthorized = deviceIds.filter(id => !owner.assignedDevices.includes(id));
    if (unauthorized.length > 0) {
      return res.status(403).json({ error: 'Owner does not have access to some of these devices' });
    }

    const sharedUser = await User.findOne({ email: sharedEmail });
    if (!sharedUser) return res.status(404).json({ error: 'Shared user not found' });

    // Check if pending invitation exists
    const inviteIndex = sharedUser.pendingInvitations.findIndex(
      i => i.ownerEmail === ownerEmail
    );

    if (inviteIndex !== -1) {
      // It's still pending: update the invitation's devices
      sharedUser.pendingInvitations[inviteIndex].devices = deviceIds;
      await sharedUser.save();
      return res.json({ message: 'Pending invitation devices updated successfully', status: 'Pending' });
    }

    // It's accepted: update their active assigned devices
    if (sharedUser.mainUserEmail === owner.email) {
      // Filter out any devices that belong to the owner first
      const otherDevices = sharedUser.assignedDevices.filter(d => !owner.assignedDevices.includes(d));
      // Set new device list
      sharedUser.assignedDevices = [...otherDevices, ...deviceIds];
      await sharedUser.save();
      return res.json({ message: 'Shared devices updated successfully', status: 'Accepted' });
    }

    return res.status(400).json({ error: 'This user is not currently shared with the owner or pending' });
  } catch (err) {
    console.error('Error updating shared devices:', err);
    res.status(500).json({ error: 'Error updating shared devices' });
  }
};



