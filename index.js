require('dotenv').config();
const logger = require('./services/logger');
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

// Morgan middleware to pipe HTTP logs to Winston logger
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Debug middleware
app.use((req, res, next) => {
  logger.info(`[DEBUG] ${req.method} ${req.url}`);
  next();
});

// Firebase Admin Setup
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => logger.info('Connected to MongoDB'))
  .catch(err => logger.error('MongoDB connection error:', err));

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
  logger.info(`Server is running on port ${PORT}`);
});

const { initWebSocket } = require('./services/websocketService');
initWebSocket(server);

// MQTT Handler
const mqttClient = require('./services/mqttService');

// Graceful Shutdown Handler
const gracefulShutdown = () => {
  logger.info('🔄 Initiating graceful shutdown...');
  
  server.close(() => {
    logger.info('🚪 Express server closed.');
    
    mongoose.connection.close(false)
      .then(() => {
        logger.info('📦 MongoDB connection closed.');
        
        mqttClient.end(false, {}, () => {
          logger.info('🔌 MQTT connection cleanly closed.');
          process.exit(0);
        });
      })
      .catch((err) => {
        logger.error('Error during MongoDB connection shutdown:', err);
        process.exit(1);
      });
  });

  // Fallback timeout to force shutdown if hanging
  setTimeout(() => {
    logger.error('⚠️ Graceful shutdown timed out, force exiting.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
