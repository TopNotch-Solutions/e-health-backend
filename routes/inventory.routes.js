const router = require('express').Router();
const inventoryController = require('../controllers/inventory.controller');
const { authenticate } = require('../middleware/auth');
const { authorize, allowRoles } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// === Pharmacy Inventory ===
router.get('/pharmacy', authorize('inventory', 'read'), inventoryController.getPharmacyInventory);
router.get('/pharmacy/medication-catalog', authorize('inventory', 'read'), inventoryController.getMedicationCatalog);
router.get('/pharmacy/stock-status', authorize('inventory', 'read'), inventoryController.checkMedicationStock);
router.get('/pharmacy/alerts', authorize('inventory', 'read'), inventoryController.getAlerts);
router.get('/pharmacy/supervisor-metrics', authorize('inventory', 'read'), inventoryController.getSupervisorMetrics);
router.get('/pharmacy/recent-prescriptions', authorize('prescription', 'read'), inventoryController.getRecentPrescriptions);
router.get(
  '/pharmacy/pending-receipts',
  allowRoles('pharmacy_supervisor'),
  inventoryController.getPendingReceipts
);
router.get(
  '/pharmacy/confirmed-receipts',
  allowRoles('pharmacy_supervisor'),
  inventoryController.getConfirmedReceipts
);
router.post(
  '/pharmacy/receipts/:transactionId/confirm',
  allowRoles('pharmacy_supervisor'),
  auditMiddleware('inventory'),
  inventoryController.confirmReceipt
);
router.post('/pharmacy', authorize('inventory', 'create'), auditMiddleware('inventory'), inventoryController.addMedication);
router.post('/pharmacy/:id/receive', authorize('inventory', 'update'), auditMiddleware('inventory'), inventoryController.receiveStock);
router.put('/pharmacy/:id', authorize('inventory', 'update'), auditMiddleware('inventory'), inventoryController.updateMedication);
router.put('/pharmacy/:id/adjust', authorize('inventory', 'update'), auditMiddleware('inventory'), inventoryController.adjustStock);
router.get('/pharmacy/:id/transactions', authorize('inventory', 'read'), inventoryController.getTransactions);

// === Kitchen Inventory ===
router.get('/kitchen', authorize('inventory', 'read'), inventoryController.getKitchenInventory);
router.post('/kitchen', authorize('inventory', 'create'), auditMiddleware('inventory'), inventoryController.addKitchenItem);
router.put('/kitchen/:id', authorize('inventory', 'update'), auditMiddleware('inventory'), inventoryController.updateKitchenItem);

module.exports = router;
