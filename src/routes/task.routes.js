const { Router } = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/auth');
const tasks = require('../controllers/task.controller');
const comments = require('../controllers/comment.controller');
const attachments = require('../controllers/attachment.controller');

const router = Router();
router.use(requireAuth);

const STATUSES = ['open', 'in_progress', 'completed'];
const PRIORITIES = ['low', 'medium', 'high'];

const idParam = param('id').isInt({ min: 1 }).withMessage('Task id must be a positive integer');
const taskIdParam = param('taskId').isInt({ min: 1 }).withMessage('Task id must be a positive integer');

// Reusable validation for task fields (used by create and update).
const taskFields = (optional) => [
  (optional ? body('title').optional() : body('title'))
    .isString().trim().isLength({ min: 1, max: 200 }).withMessage('Title is required (max 200 characters)'),
  body('description').optional().isString().isLength({ max: 5000 }),
  body('status').optional().isIn(STATUSES).withMessage(`status must be one of: ${STATUSES.join(', ')}`),
  body('priority').optional().isIn(PRIORITIES).withMessage(`priority must be one of: ${PRIORITIES.join(', ')}`),
  body('dueDate').optional({ values: 'null' }).isISO8601().withMessage('dueDate must be an ISO date, e.g. 2026-12-31'),
  body('assigneeId').optional({ values: 'null' }).isInt({ min: 1 }).toInt(),
  body('teamId').optional({ values: 'null' }).isInt({ min: 1 }).toInt(),
];

// ---- Tasks ----
router.get(
  '/',
  [
    query('status').optional().isIn(STATUSES),
    query('priority').optional().isIn(PRIORITIES),
    query('sortBy').optional().isIn(['createdAt', 'dueDate', 'title', 'status', 'priority', 'updatedAt']),
    query('order').optional().isIn(['asc', 'desc']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  tasks.list,
);
router.post('/', taskFields(false), validate, tasks.create);
router.get('/:id', [idParam], validate, tasks.getOne);
router.patch('/:id', [idParam, ...taskFields(true)], validate, tasks.update);
router.delete('/:id', [idParam], validate, tasks.remove);
router.post('/:id/complete', [idParam], validate, tasks.complete);
router.post(
  '/:id/assign',
  [idParam, body('assigneeId').optional({ values: 'null' }).isInt({ min: 1 }).toInt()],
  validate,
  tasks.assign,
);

// ---- Comments (nested) ----
router.get('/:taskId/comments', [taskIdParam], validate, comments.list);
router.post(
  '/:taskId/comments',
  [taskIdParam, body('content').isString().trim().isLength({ min: 1, max: 2000 }).withMessage('content is required')],
  validate,
  comments.create,
);
router.delete('/:taskId/comments/:id', [taskIdParam, idParam], validate, comments.remove);

// ---- Attachments (nested) ----
router.get('/:taskId/attachments', [taskIdParam], validate, attachments.list);
router.post('/:taskId/attachments', [taskIdParam], validate, attachments.upload, attachments.create);
router.get('/:taskId/attachments/:id/download', [taskIdParam, idParam], validate, attachments.download);
router.delete('/:taskId/attachments/:id', [taskIdParam, idParam], validate, attachments.remove);

module.exports = router;
