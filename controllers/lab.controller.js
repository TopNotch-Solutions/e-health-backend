const { v4: uuidv4 } = require('uuid');
const {
  LabRequest, LabResult, Visit, Patient, Vital, QueueEntry, sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const notificationService = require('../services/notificationService');
const { getIO } = require('../socket');
const { LAB_TEST_CATALOG } = require('../constants/labTests');

const ACTIVE_LAB_STATUSES = ['pending_sample', 'sample_collected', 'processing'];

const labInclude = [
  {
    association: 'visit',
    include: [
      { model: Patient, as: 'patient' },
      { model: Vital, as: 'vitals', required: false },
    ],
  },
  { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
  { association: 'nurse', attributes: ['id', 'first_name', 'last_name'], required: false },
  { association: 'result', include: [{ association: 'processedBy', attributes: ['id', 'first_name', 'last_name'] }] },
];

exports.getTestCatalog = async (req, res) => {
  return success(res, LAB_TEST_CATALOG);
};

exports.getQueue = async (req, res) => {
  try {
    const requests = await LabRequest.findAll({
      where: { status: { [Op.in]: ACTIVE_LAB_STATUSES } },
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
      // Sort in JS: SQL `ORDER BY is_emergency` is ambiguous because `patients` also has `is_emergency`.
      order: [['created_at', 'ASC']],
    });

    requests.sort((a, b) => {
      const ae = a.is_emergency ? 0 : 1;
      const be = b.is_emergency ? 0 : 1;
      if (ae !== be) return ae - be;
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return ta - tb;
    });

    return success(res, requests);
  } catch (err) {
    console.error('Get lab queue error:', err);
    return error(res, 'Failed to fetch laboratory queue', 500);
  }
};

exports.getById = async (req, res) => {
  try {
    const request = await LabRequest.findByPk(req.params.id, { include: labInclude });
    if (!request) return error(res, 'Lab request not found', 404);
    return success(res, request);
  } catch (err) {
    return error(res, 'Failed to fetch lab request', 500);
  }
};

exports.startProcessing = async (req, res) => {
  try {
    const request = await LabRequest.findByPk(req.params.id);
    if (!request) return error(res, 'Lab request not found', 404);
    if (request.status === 'completed') {
      return error(res, 'Request already completed', 400);
    }

    if (request.status !== 'processing') {
      await request.update({ status: 'processing' });
    }

    const refreshed = await LabRequest.findByPk(req.params.id, { include: labInclude });
    return success(res, refreshed, 'Laboratory work started');
  } catch (err) {
    return error(res, 'Failed to start processing', 500);
  }
};

exports.submitResultsAndReturn = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { test_results, lab_notes, summary } = req.body;

    if (!test_results || !Array.isArray(test_results) || test_results.length === 0) {
      if (!t.finished) await t.rollback();
      return error(res, 'test_results array is required', 400);
    }

    const request = await LabRequest.findByPk(id, {
      include: [{ association: 'visit', include: [{ model: Patient, as: 'patient' }] }],
      transaction: t,
    });
    if (!request) {
      if (!t.finished) await t.rollback();
      return error(res, 'Lab request not found', 404);
    }
    if (request.status === 'completed') {
      if (!t.finished) await t.rollback();
      return error(res, 'Results already submitted', 400);
    }

    const orderedTests = Array.isArray(request.tests) ? request.tests : [];
    const lines = test_results.map((r) => {
      const test = orderedTests.find((x) => x.id === r.test_id) || {};
      const label = test.name || r.test_id;
      const val = (r.value ?? '').toString().trim() || '—';
      const unit = r.unit ? ` ${r.unit}` : '';
      const flag = r.flag && r.flag !== 'normal' ? ` [${r.flag}]` : '';
      return `${label}: ${val}${unit}${flag}`;
    });

    const resultsText = [
      summary?.trim() || 'Laboratory results',
      lab_notes?.trim() ? `Notes: ${lab_notes.trim()}` : null,
      ...lines,
    ]
      .filter(Boolean)
      .join('\n');

    const existingResult = await LabResult.findOne({
      where: { lab_request_id: id },
      transaction: t,
    });

    if (existingResult) {
      await existingResult.update(
        {
          results: resultsText,
          result_data: { test_results, lab_notes: lab_notes || null, summary: summary || null },
          processed_by: req.user.id,
        },
        { transaction: t }
      );
    } else {
      await LabResult.create(
        {
          id: uuidv4(),
          lab_request_id: id,
          processed_by: req.user.id,
          results: resultsText,
          result_data: { test_results, lab_notes: lab_notes || null, summary: summary || null },
        },
        { transaction: t }
      );
    }

    await request.update({ status: 'completed' }, { transaction: t });

    let doctorQueueEntry = null;
    if (request.queue_entry_id) {
      const labEntry = await QueueEntry.findByPk(request.queue_entry_id, { transaction: t });
      if (labEntry && ['waiting', 'in_progress'].includes(labEntry.status)) {
        const result = await queueService.completeEntry(
          labEntry.id,
          {
            nextDepartment: 'doctor',
            nextPriority: request.is_emergency ? 'emergency' : 'normal',
            notes: 'Laboratory results ready — returned to doctor',
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
          notes: 'Laboratory results ready',
        },
        t
      );
    }

    await t.commit();

    try {
      notificationService.emitResultReady(request.requested_by, 'lab', {
        lab_request_id: id,
        test_type: request.test_type,
        visit_id: request.visit_id,
        message: `Lab results ready: ${request.test_type}`,
      });
      const io = getIO();
      const labQueue = await LabRequest.findAll({
        where: { status: { [Op.in]: ACTIVE_LAB_STATUSES } },
        include: [
          {
            association: 'visit',
            where: { facility_id: req.user.facility_id },
            attributes: ['id'],
          },
        ],
      });
      io.to('room:lab_technician').emit('queue:refresh', { department: 'lab', entries: labQueue });
      if (doctorQueueEntry) {
        io.to('room:doctor').emit('queue:new_patient', { queueEntry: doctorQueueEntry });
        const doctorEntries = await queueService.getQueue('doctor', req.user.facility_id);
        io.to('room:doctor').emit('queue:refresh', { department: 'doctor', entries: doctorEntries });
      }
    } catch (emitErr) {
      console.error('Lab submit socket emit error:', emitErr.message);
    }

    notificationService.emitLaboratoryActivity({
      labRequestId: id,
      processedBy: req.user.id,
      action: 'results_submitted',
    });

    return success(
      res,
      { lab_request_id: id, doctor_queue_entry: doctorQueueEntry },
      'Results submitted — patient returned to doctor queue'
    );
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Submit lab results error:', err);
    return error(res, err.message || 'Failed to submit results', 500);
  }
};

exports.sampleCollected = async (req, res) => {
  try {
    const { id } = req.params;
    const { blood_details } = req.body;

    const request = await LabRequest.findByPk(id);
    if (!request) return error(res, 'Lab request not found', 404);
    if (request.status !== 'pending_sample') {
      return error(res, 'Sample already collected or processed', 400);
    }

    await request.update({
      status: 'sample_collected',
      blood_details: blood_details || null,
      nurse_id: req.user.id,
    });

    return success(res, request, 'Sample collected - submitted to lab');
  } catch (err) {
    return error(res, 'Failed to update sample status', 500);
  }
};

exports.submitResults = exports.submitResultsAndReturn;

exports.getResultsByVisit = async (req, res) => {
  try {
    const requests = await LabRequest.findAll({
      where: { visit_id: req.params.visitId },
      include: [
        { association: 'result', include: [{ association: 'processedBy', attributes: ['id', 'first_name', 'last_name'] }] },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['created_at', 'DESC']],
    });

    return success(res, requests);
  } catch (err) {
    return error(res, 'Failed to fetch lab results', 500);
  }
};
