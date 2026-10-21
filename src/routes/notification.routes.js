const { Router } = require('express');
const requireAuth = require('../middleware/auth');
const ctrl = require('../controllers/notification.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.get('/stream', ctrl.stream);
router.patch('/read-all', ctrl.markAllRead); // must come before /:id/read
router.patch('/:id/read', ctrl.markRead);

module.exports = router;
