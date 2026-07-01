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
// Behind nginx / load balancer (required for express-rate-limit with X-Forwarded-For)
app.set('trust proxy', 1);
const server = http.createServer(app);

// Initialize Socket.io
const io = initSocket(server);
app.set('io', io);

// Middleware
app.use(helmet());
app.use(compression());
const defaultDevOrigins = ['http://localhost:3000', 'http://localhost:5173', 'https://health.kopanovertex.com'];
const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const corsOrigins = [...new Set([...defaultDevOrigins, ...configuredOrigins])];

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients; in dev allow listed SPA origins
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked origin: ${origin}`));
      }
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Rate limiting — auth routes use a stricter limiter in middleware/rateLimiter.js
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const auth = req.headers.authorization;
    return Boolean(auth && auth.startsWith('Bearer '));
  },
  message: { success: false, message: 'Too many requests. Please wait a moment and try again.' },
});
app.use('/api', limiter);

// Routes
app.use('/api/v1/auth', require('./routes/auth.routes'));
app.use('/api/v1/patients', require('./routes/patient.routes'));
app.use('/api/v1/front-office', require('./routes/frontOffice.routes'));
app.use('/api/v1/queue', require('./routes/queue.routes'));
app.use('/api/v1/vitals', require('./routes/nurse.routes'));
app.use('/api/v1/hiv-art', require('./routes/hivArt.routes'));
app.use('/api/v1/emergency-unit', require('./routes/emergencyUnit.routes'));
app.use('/api/v1/booking-room', require('./routes/bookingRoom.routes'));
app.use('/api/v1/dermatologist', require('./routes/dermatologist.routes'));
app.use('/api/v1/maternity', require('./routes/maternity.routes'));
app.use('/api/v1/pap-smear-suite', require('./routes/papSmearSuite.routes'));
app.use('/api/v1/social-worker-suite', require('./routes/socialWorkerSuite.routes'));
app.use('/api/v1/family-planning-suite', require('./routes/familyPlanningSuite.routes'));
app.use('/api/v1/pediatric-corner', require('./routes/pediatricCorner.routes'));
app.use('/api/v1/consultations', require('./routes/doctor.routes'));
app.use('/api/v1/icd10', require('./routes/icd10.routes'));
app.use('/api/v1/prescriptions', require('./routes/pharmacy.routes'));
app.use('/api/v1/lab', require('./routes/lab.routes'));
app.use('/api/v1/sonar', require('./routes/sonar.routes'));
app.use('/api/v1/wards', require('./routes/ward.routes'));
app.use('/api/v1/transport', require('./routes/transport.routes'));
app.use('/api/v1/clinic-hospital-transfer', require('./routes/clinicHospitalTransfer.routes'));
app.use('/api/v1/hospital-outpatient', require('./routes/hospitalOutpatient.routes'));
app.use('/api/v1/kitchen', require('./routes/kitchen.routes'));
app.use('/api/v1/billing', require('./routes/billing.routes'));
app.use('/api/v1/revenue', require('./routes/revenue.routes'));
app.use('/api/v1/mortuary', require('./routes/mortuary.routes'));
app.use('/api/v1/inventory', require('./routes/inventory.routes'));
app.use('/api/v1/admin', require('./routes/admin.routes'));
app.use('/api/v1/analytics', require('./routes/analytics.routes'));
app.use('/api/v1/executive', require('./routes/executive.routes'));
app.use('/api/v1/reports', require('./routes/userReport.routes'));

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

const { ensureRolesSynced } = require('./services/roleSyncService');
const { ensureReportUploadDirs } = require('./utils/reportUploads');

ensureReportUploadDirs();

sequelize.authenticate()
  .then(() => {
    console.log('Database connected successfully');
    return ensureRolesSynced();
  })
  .then(() => {
    console.log('Roles synced from config');
    const { Facility, FacilityDepartment } = require('./models');
    const { isHospitalFacility } = require('./config/clinicRoles');
    const {
      seedDepartmentsForFacility,
      FULL_HOSPITAL_TEMPLATE_KEYS,
    } = require('./services/clinicFacilityDepartmentService');
    return Facility.findAll({ where: { type: ['hospital', 'health_center'] } }).then(async (hospitals) => {
      for (const hospital of hospitals.filter(isHospitalFacility)) {
        const count = await FacilityDepartment.count({ where: { facility_id: hospital.id } });
        if (count === 0) {
          await seedDepartmentsForFacility(hospital.id, FULL_HOSPITAL_TEMPLATE_KEYS);
        }
      }
    });
  })
  .then(() => {
    console.log('Hospital departments seeded where missing');
  })
  .then(() => {
    // Schema changes belong in migrations (`npm run db:migrate`), not sync+alter.
    // alter:true can add duplicate indexes on every restart and hit MySQL's 64-index limit.
    const runAlterSync = process.env.SEQUELIZE_SYNC_ALTER === '1';
    if (runAlterSync) {
      console.warn('SEQUELIZE_SYNC_ALTER=1: running sequelize.sync({ alter: true }) — not recommended');
      return sequelize.sync({ alter: true });
    }
    // Schema is managed by migrations (`npm run db:migrate`). Do not alter on every startup.
    return Promise.resolve();
  })
  .then(() => {
    if (process.env.SEQUELIZE_SYNC_ALTER === '1') {
      console.log('Database tables synchronized (alter mode)');
    }
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      const { startClinicVisitExpiryScheduler } = require('./services/clinicVisitExpiryService');
      const { startHospitalVisitExpiryScheduler } = require('./services/hospitalVisitExpiryService');
      startClinicVisitExpiryScheduler();
      startHospitalVisitExpiryScheduler();
    });
  })
  .catch((err) => {
    console.error('Unable to connect to database:', err);
  });

module.exports = { app, server };
