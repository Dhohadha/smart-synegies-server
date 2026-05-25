const admin = require('firebase-admin');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: Missing or invalid token' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    console.log(`[Auth] Token verified for: ${decodedToken.email}`);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('[Auth] Error verifying Firebase ID token:', error);
    res.status(401).json({ message: 'Unauthorized: Invalid token' });
  }
};

const verifyAdmin = async (req, res, next) => {
  // Assuming we store custom claims or we check the User model
  // For simplicity, we can fetch the user from MongoDB and check role
  const User = require('../models/User');
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user || user.role !== 'Admin') {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }
    req.dbUser = user;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

module.exports = { verifyToken, verifyAdmin };
