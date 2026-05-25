const { v4: uuidv4 } = require('uuid');
const {
  SonarRequest, SonarResult, Visit, Patient, Vital, QueueEntry, sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');
const notificationService = require('../services/notificationService');
const billingChargeService = require('../services/billingChargeService');
const queueService = require('../services/queueService');
const { getIO } = require('../socket');
const { SONAR_SCAN_CATALOG } = require('../constants/sonarScans');

const ACTIVE_SONAR_STATUSES = ['pending', 'in_progress', 'awaiting_report'];

const sonarInclude = [
  {
    association: 'visit',
    include: [
      { model: Patient, as: 'patient' },
      { model: Vital, as: 'vitals', required: false },
    ],
  },
  { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
  {
    association: 'result',
    include: [{ association: 'performedBy', attributes: ['id', 'first_name', 'last_name'] }],
  },
];

exports.getScanCatalog = async (req, res) => {
  return success(res, SONAR_SCAN_CATALOG);
};

exports.getQueue = async (req, res) => {
  try {
    const requests = await SonarRequest.findAll({
      where: { status: { [Op.in]: ACTIVE_SONAR_STATUSES } },
      include: [
        {
          association: 'visit',
          where: { facility_id: req.user.facility_id },
          include: [
            { model: Patient, as: 'patient' },
            { model: Vital, as: 'vitals', required: false },
          ],
        },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['created_at', 'ASC']],
    });

    requests.sort((a, b) => {
      const ae = a.is_emergency ? 0 : 1;
      const be = b.is_emergency ? 0 : 1;
      if (ae !== be) return ae - be;
      return new Date(a.created_at) - new Date(b.created_at);
    });

    return success(res, requests);
  } catch (err) {
    console.error('Get sonar queue error:', err);
    return error(res, 'Failed to fetch sonar queue', 500);
  }
};

exports.getById = async (req, res) => {
  try {
    const request = await SonarRequest.findByPk(req.params.id, { include: sonarInclude });
    if (!request) return error(res, 'Sonar request not found', 404);
    return success(res, request);
  } catch (err) {
    return error(res, 'Failed to fetch sonar request', 500);
  }
};

exports.startScan = async (req, res) => {
  try {
    const request = await SonarRequest.findByPk(req.params.id);
    if (!request) return error(res, 'Sonar request not found', 404);
    if (request.status === 'completed') return error(res, 'Request already completed', 400);
    if (request.status === 'pending') {
      await request.update({ status: 'in_progress', started_at: new Date() });
    } else if (!request.started_at) {
      await request.update({ started_at: new Date() });
    }

    const refreshed = await SonarRequest.findByPk(req.params.id, { include: sonarInclude });
    return success(res, refreshed, 'Ultrasound session started');
  } catch (err) {
    return error(res, 'Failed to start scan', 500);
  }
};

/** Sonographer documents capture notes before formal interpretation. */
exports.saveImaging = async (req, res) => {
  try {
    const { id } = req.params;
    const { imaging_notes } = req.body;

    const request = await SonarRequest.findByPk(id);
    if (!request) return error(res, 'Sonar request not found', 404);
    if (request.status === 'completed') return error(res, 'Request already completed', 400);

    const nextStatus =
      request.status === 'completed' ? 'completed' : 'awaiting_report';
    await request.update({
      imaging_notes: imaging_notes?.trim() || null,
      status: nextStatus,
    });

    const refreshed = await SonarRequest.findByPk(id, { include: sonarInclude });
    return success(res, refreshed, 'Imaging documentation saved');
  } catch (err) {
    return error(res, 'Failed to save imaging notes', 500);
  }
};

exports.submitResultsAndReturn = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { findings, impression, report, imaging_notes } = req.body;

    if (!report?.trim() && !findings?.trim()) {
      await t.rollback();
      return error(res, 'Diagnostic report or findings are required', 400);
    }

    const request = await SonarRequest.findByPk(id, {
      include: [{ association: 'visit', include: [{ model: Patient, as: 'patient' }] }],
      transaction: t,
    });
    if (!request) {
      await t.rollback();
      return error(res, 'Sonar request not found', 404);
    }
    if (request.status === 'completed') {
      await t.rollback();
      return error(res, 'Results already submitted', 400);
    }

    let imagesPaths = req.body.images || null;
    if (req.files?.length > 0) {
      imagesPaths = req.files.map((f) => f.path);
    }

    const reportText = [
      impression?.trim() ? `Impression: ${impression.trim()}` : null,
      findings?.trim() ? `Findings: ${findings.trim()}` : null,
      report?.trim() || null,
    ]
      .filter(Boolean)
      .join('\n\n');

    const existing = await SonarResult.findOne({
      where: { sonar_request_id: id },
      transaction: t,
    });

    const payload = {
      findings: findings?.trim() || null,
      impression: impression?.trim() || null,
      report: reportText,
      images: imagesPaths,
      performed_by: req.user.id,
    };

    if (existing) {
      await existing.update(payload, { transaction: t });
    } else {
      await SonarResult.create(
        { id: uuidv4(), sonar_request_id: id, ...payload },
        { transaction: t }
      );
    }

    if (imaging_notes?.trim()) {
      await request.update({ imaging_notes: imaging_notes.trim() }, { transaction: t });
    }

    await request.update({ status: 'completed', completed_at: new Date() }, { transaction: t });

    let doctorQueueEntry = null;
    if (request.queue_entry_id) {
      const sonarEntry = await QueueEntry.findByPk(request.queue_entry_id, { transaction: t });
      if (sonarEntry && ['waiting', 'in_progress'].includes(sonarEntry.status)) {
        const result = await queueService.completeEntry(
          sonarEntry.id,
          {
            nextDepartment: 'doctor',
            nextPriority: request.is_emergency ? 'emergency' : 'normal',
            notes: 'Ultrasound report ready — returned to referring doctor',
            pushed_by: req.user.id,
          },
          t
        );
        doctorQueueEntry = result.nextEntry;
      }
    } else {
      doctorQueueEntry = await queueService.pushToQueue(
        {
          visit_id: request.visit_id,
          department: 'doctor',
          priority: request.is_emergency ? 'emergency' : 'normal',
          pushed_by: req.user.id,
          notes: 'Ultrasound report ready',
        },
        t
      );
    }

    await t.commit();

    try {
      await billingChargeService.chargeSonarFee(
        request.visit_id,
        id,
        req.user.facility_id
      );
    } catch (billErr) {
      console.error('Sonar billing charge error:', billErr.message);
    }

    try {
      notificationService.emitResultReady(request.requested_by, 'sonar', {
        sonar_request_id: id,
        scan_type: request.scan_type,
        visit_id: request.visit_id,
        message: `Ultrasound report ready: ${request.scan_type}`,
      });
      const io = getIO();
      const sonarQueue = await SonarRequest.findAll({
        where: { status: { [Op.in]: ACTIVE_SONAR_STATUSES } },
        include: [
          {
            association: 'visit',
            where: { facility_id: req.user.facility_id },
            attributes: ['id'],
          },
        ],
      });
      io.to('room:radiologist').emit('queue:refresh', { department: 'sonar', entries: sonarQueue });
      io.to('room:radiologist').emit('sonar:queue_update', { sonar_request_id: id });
      if (doctorQueueEntry) {
        io.to('room:doctor').emit('queue:new_patient', { queueEntry: doctorQueueEntry });
        const doctorEntries = await queueService.getQueue('doctor', req.user.facility_id);
        io.to('room:doctor').emit('queue:refresh', { department: 'doctor', entries: doctorEntries });
      }
    } catch (emitErr) {
      console.error('Sonar submit socket emit error:', emitErr.message);
    }

    notificationService.emitRadiologistSupervisorActivity({
      sonarRequestId: id,
      performedBy: req.user.id,
      action: 'results_submitted',
      scanType: request.scan_type,
    });

    return success(
      res,
      { sonar_request_id: id, doctor_queue_entry: doctorQueueEntry },
      'Diagnostic report submitted — patient returned to doctor queue'
    );
  } catch (err) {
    await t.rollback();
    console.error('Submit sonar results error:', err);
    return error(res, err.message || 'Failed to submit results', 500);
  }
};

exports.submitResults = exports.submitResultsAndReturn;

exports.getResultsByVisit = async (req, res) => {
  try {
    const requests = await SonarRequest.findAll({
      where: { visit_id: req.params.visitId },
      include: sonarInclude,
      order: [['created_at', 'DESC']],
    });
    return success(res, requests);
  } catch (err) {
    return error(res, 'Failed to fetch sonar results', 500);
  }
};
