const router = require('express').Router();
const inventoryController = require('../controllers/inventory.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// === Pharmacy Inventory ===
router.get('/pharmacy', authorize('inventory', 'read'), inventoryController.getPharmacyInventory);
router.get('/pharmacy/alerts', authorize('inventory', 'read'), inventoryController.getAlerts);
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
