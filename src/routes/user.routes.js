const { Router } = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/auth');
const ctrl = require('../controllers/user.controller');

const router = Router();

// Everything under /api/users requires a logged-in user.
router.use(requireAuth);

router.get('/', ctrl.searchUsers);
router.get('/me', ctrl.getProfile);
router.patch(
  '/me',
  [
    body('name').optional().isString().trim().isLength({ min: 2, max: 80 }),
    body('email').optional().isEmail().normalizeEmail(),
    body('bio').optional().isString().isLength({ max: 500 }),
    body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  ctrl.updateProfile,
);

module.exports = router;
