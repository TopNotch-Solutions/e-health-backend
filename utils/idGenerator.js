const { v4: uuidv4 } = require('uuid');

function generatePatientNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Math.floor(1000 + Math.random() * 9000);
  return `PAT-${date}-${seq}`;
}

function generateVisitNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Math.floor(1000 + Math.random() * 9000);
  return `VIS-${date}-${seq}`;
}

function generateEmergencyId() {
  const seq = Math.floor(1000 + Math.random() * 9000);
  return `EMG-${seq}`;
}

function generateUUID() {
  return uuidv4();
}

module.exports = { generatePatientNumber, generateVisitNumber, generateEmergencyId, generateUUID };
