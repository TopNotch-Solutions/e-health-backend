const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { registerQueueHandlers } = require('./queueHandler');
const { startDashboardBroadcast } = require('./dashboardHandler');

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // JWT authentication middleware for Socket.io
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.userRole = decoded.role;
      socket.facilityId = decoded.facilityId;
      next();
    } catch (err) {
      return next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.userId} [${socket.userRole}]`);

    // Auto-join department room based on role
    const departmentRoom = `room:${socket.userRole}`;
    socket.join(departmentRoom);
    // Clinic master doctor uses a dedicated consultation queue (not emergency unit)
    if (socket.userRole === 'master_doctor') {
      socket.join('room:master_doctor');
    }
    if (socket.userRole === 'dermatologist') {
      socket.join('room:dermatologist');
    }
    if (socket.userRole === 'pap_smear_suite') {
      socket.join('room:pap_smear');
    }
    if (socket.userRole === 'family_planner') {
      socket.join('room:family_planning');
    }
    if (socket.userRole === 'pediatric_corner') {
      socket.join('room:pediatric');
    }
    if (socket.userRole === 'emergency_unit_nurse') {
      socket.join('room:emergency_unit');
    }
    // Clinic/hospital pharmacy staff share the facility pharmacy queue
    if (socket.userRole === 'pharmacist' || socket.userRole === 'pharmacy_supervisor') {
      socket.join('room:pharmacy');
    }
    if (socket.userRole === 'porter' || socket.userRole === 'internal_porter') {
      socket.join('room:internal_porter');
      socket.join('room:porter');
    }
    if (socket.userRole === 'external_porter') {
      socket.join('room:external_porter');
    }
    const { departmentForRole } = require('../config/hospitalOutpatientConfig');
    const hospitalDept = departmentForRole(socket.userRole);
    if (hospitalDept) {
      socket.join(`room:${hospitalDept}`);
    }
    socket.join(`user:${socket.userId}`);
    socket.join(`facility:${socket.facilityId}`);

    // Admin dashboard subscription
    socket.on('admin:subscribe_dashboard', () => {
      if (socket.userRole === 'system_admin') {
        socket.join('room:admin_dashboard');
      }
    });

    // Join specific department room (for cross-department visibility)
    socket.on('queue:join_department', (department) => {
      socket.join(`room:${department}`);
    });

    // Register queue event handlers
    registerQueueHandlers(io, socket);

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.userId}`);
    });
  });

  // Start broadcasting dashboard stats every 5 seconds
  startDashboardBroadcast(io);

  return io;
}

function getIO() {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

module.exports = { initSocket, getIO };
