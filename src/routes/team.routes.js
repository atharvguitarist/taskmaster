const { Router } = require('express');
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/auth');
const ctrl = require('../controllers/team.controller');

const router = Router();
router.use(requireAuth);

const idParam = param('id').isInt({ min: 1 }).withMessage('Team id must be a positive integer');

router.get('/', ctrl.listMine);
router.post(
  '/',
  [
    body('name').isString().trim().isLength({ min: 2, max: 80 }).withMessage('Team name must be 2-80 characters'),
    body('description').optional().isString().isLength({ max: 500 }),
  ],
  validate,
  ctrl.create,
);
router.post(
  '/join',
  [body('inviteCode').isString().trim().notEmpty().withMessage('inviteCode is required')],
  validate,
  ctrl.join,
);

router.get('/:id', [idParam], validate, ctrl.getOne);
router.patch(
  '/:id',
  [
    idParam,
    body('name').optional().isString().trim().isLength({ min: 2, max: 80 }),
    body('description').optional().isString().isLength({ max: 500 }),
  ],
  validate,
  ctrl.update,
);
router.delete('/:id', [idParam], validate, ctrl.remove);

router.get('/:id/members', [idParam], validate, ctrl.members);
router.post(
  '/:id/invite',
  [idParam, body('email').isEmail().withMessage('A valid email is required').normalizeEmail()],
  validate,
  ctrl.invite,
);
router.delete(
  '/:id/members/:userId',
  [idParam, param('userId').isInt({ min: 1 })],
  validate,
  ctrl.removeMember,
);

module.exports = router;
