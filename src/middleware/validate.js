/**
 * Runs after a list of express-validator rules and converts any failures
 * into a 400 response with a readable list of problems.
 *
 * Usage in a route:
 *   router.post('/', [body('title').notEmpty()], validate, controller.create);
 */
const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const details = result.array().map((e) => ({ field: e.path, message: e.msg }));
  next(ApiError.badRequest('Validation failed', details));
}

module.exports = validate;
