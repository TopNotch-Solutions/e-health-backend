require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { initSocket } = require('./socket');
const { sequelize } = require('./models');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = initSocket(server);
app.set('io', io);

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || ['http://localhost:3000', 'http://localhost:5173'], credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Routes
app.use('/api/v1/auth', require('./routes/auth.routes'));
app.use('/api/v1/patients', require('./routes/patient.routes'));
app.use('/api/v1/queue', require('./routes/queue.routes'));
app.use('/api/v1/vitals', require('./routes/nurse.routes'));
app.use('/api/v1/consultations', require('./routes/doctor.routes'));
app.use('/api/v1/prescriptions', require('./routes/pharmacy.routes'));
app.use('/api/v1/lab', require('./routes/lab.routes'));
app.use('/api/v1/sonar', require('./routes/sonar.routes'));
app.use('/api/v1/wards', require('./routes/ward.routes'));
app.use('/api/v1/transport', require('./routes/transport.routes'));
app.use('/api/v1/kitchen', require('./routes/kitchen.routes'));
app.use('/api/v1/billing', require('./routes/billing.routes'));
app.use('/api/v1/revenue', require('./routes/revenue.routes'));
app.use('/api/v1/mortuary', require('./routes/mortuary.routes'));
app.use('/api/v1/inventory', require('./routes/inventory.routes'));
app.use('/api/v1/admin', require('./routes/admin.routes'));
app.use('/api/v1/analytics', require('./routes/analytics.routes'));
app.use('/api/v1/executive', require('./routes/executive.routes'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

const PORT = process.env.PORT || 5000;

sequelize.authenticate()
  .then(() => {
    console.log('Database connected successfully');
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Unable to connect to database:', err);
  });

module.exports = { app, server };
