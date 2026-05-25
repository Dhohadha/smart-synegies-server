const { WebSocketServer } = require('ws');

let wss = null;
const clients = new Set();

function initWebSocket(server) {
  wss = new WebSocketServer({ server });
  console.log('⚡ WebSocket Server initialized');

  wss.on('connection', (ws) => {
    console.log('🔌 Client connected via WebSocket');
    clients.add(ws);

    ws.on('message', (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        console.log('📩 Received WebSocket message from client:', parsed);
        
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
}

function broadcastDeviceUpdate(deviceID, deviceData) {
  if (!wss) return;

  const payload = JSON.stringify({
    type: 'device_update',
    deviceID,
    data: deviceData
  });

  let activeClients = 0;
  clients.forEach((ws) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(payload);
      activeClients++;
    }
  });

  if (activeClients > 0) {
    console.log(`📤 Broadcasted real-time update for device [${deviceID}] to ${activeClients} client(s)`);
  }
}

module.exports = {
  initWebSocket,
  broadcastDeviceUpdate
};
