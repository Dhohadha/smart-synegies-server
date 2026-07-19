const { WebSocketServer } = require('ws');

let wss = null;
const clients = new Set();

function initWebSocket(server) {
  wss = new WebSocketServer({ server });
  console.log('⚡ WebSocket Server initialized');

  wss.on('connection', (ws) => {
    console.log('🔌 Client connected via WebSocket');
    ws.isAlive = true;
    clients.add(ws);
    ws.subscribedDeviceIDs = new Set(); // Track subscriptions per client connection

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        
        if (parsed.type === 'subscribe') {
          const { token, deviceID } = parsed;
          if (!token || !deviceID) {
            ws.send(JSON.stringify({ type: 'error', message: 'Token and DeviceID are required for subscription' }));
            return;
          }

          try {
            const admin = require('firebase-admin');
            const User = require('../models/User');
            
            const decodedToken = await admin.auth().verifyIdToken(token);
            const email = decodedToken.email.toLowerCase();
            const user = await User.findOne({ email });

            if (!user) {
              ws.send(JSON.stringify({ type: 'error', message: 'User not found in database' }));
              return;
            }

            if (!user.assignedDevices.includes(deviceID)) {
              ws.send(JSON.stringify({ type: 'error', message: 'Forbidden: You do not have access to this device' }));
              return;
            }

            ws.subscribedDeviceIDs.add(deviceID);
            console.log(`✅ [WS] Subscribed connection to device: ${deviceID} for: ${email}`);
            ws.send(JSON.stringify({ 
              type: 'subscribed', 
              deviceID, 
              message: `Subscribed successfully to ${deviceID}` 
            }));
          } catch (authErr) {
            console.error('❌ [WS Auth] Subscription authentication failed:', authErr.message);
            ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed for subscription' }));
          }
        }
        
        // Handle ping/pong or client subscription if needed
        if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      console.log('❌ Client disconnected from WebSocket');
      clients.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket client error:', err);
      clients.delete(ws);
    });

    // Send an initial connection success event
    ws.send(JSON.stringify({ type: 'connected', message: 'Successfully connected to Smart Synergies Real-Time System' }));
  });

  // Start ping interval to clean up dead connections
  const interval = setInterval(() => {
    clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log('🧹 [WS] Terminating dead client connection');
        clients.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  // Clear interval on server close
  wss.on('close', () => {
    clearInterval(interval);
  });
}

function broadcastDeviceUpdate(deviceID, deviceData) {
  if (!wss) return;

  const payload = JSON.stringify({
    type: 'device_update',
    deviceID,
    data: deviceData
  });

  clients.forEach((ws) => {
    try {
      if (ws.readyState === 1 && ws.subscribedDeviceIDs && ws.subscribedDeviceIDs.has(deviceID)) {
        ws.send(payload);
      }
    } catch (err) {
      console.error('Error sending WS message to client:', err);
      clients.delete(ws);
    }
  });
}

function broadcastGlobalMessage(type, payloadData) {
  if (!wss) return;

  const payload = JSON.stringify({
    type,
    ...payloadData
  });

  let activeClients = 0;
  clients.forEach((ws) => {
    try {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(payload);
        activeClients++;
      }
    } catch (err) {
      console.error('Error sending global WS message:', err);
      clients.delete(ws);
    }
  });
}

module.exports = {
  initWebSocket,
  broadcastDeviceUpdate,
  broadcastGlobalMessage
};
