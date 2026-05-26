require('dotenv').config();
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(morgan('dev'));

// Debug middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] ${req.method} ${req.url}`);
  next();
});


// Firebase Admin Setup
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
const deviceRoutes = require('./routes/deviceRoutes');
const userRoutes = require('./routes/userRoutes');

app.use('/api/devices', deviceRoutes);
app.use('/api/users', userRoutes);

// Direct test route for settings update
const deviceController = require('./controllers/deviceController');
app.post('/api/devices/config/:id', deviceController.updateDeviceSettings);


// Basic Route
app.get('/', (req, res) => {
  res.send('Smart Synergies Backend is Running');
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

const { initWebSocket } = require('./services/websocketService');
initWebSocket(server);

// MQTT Handler (to be implemented)
require('./services/mqttService');
