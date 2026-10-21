const { Router } = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/auth');
const { generateDescription } = require('../services/ai.service');

const router = Router();
router.use(requireAuth);

// POST /api/ai/describe  { title, notes? }
router.post(
  '/describe',
  [
    body('title').isString().trim().isLength({ min: 3, max: 200 }).withMessage('title must be 3-200 characters'),
    body('notes').optional().isString().isLength({ max: 2000 }),
  ],
  validate,
  async (req, res) => {
    const result = await generateDescription(req.body);
    res.json(result);
  },
);

module.exports = router;
