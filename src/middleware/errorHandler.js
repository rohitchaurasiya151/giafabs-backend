/**
 * Global Error Handler Middleware
 * Catches and formats all errors
 */

const errorHandler = (err, req, res, next) => {
  console.error('[ERROR]', err.message || err);

  // Handle specific error types
  if (err.message === 'OUT_OF_STOCK') {
    return res.status(409).json({
      success: false,
      error: {
        code: 'OUT_OF_STOCK',
        message: `Only ${err.available} units available`,
        available: err.available
      }
    });
  }

  if (err.code === '23505') {
    // PostgreSQL unique constraint violation
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message: 'This entry already exists'
      }
    });
  }

  if (err.code === '23503') {
    // PostgreSQL foreign key violation
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REFERENCE',
        message: 'Referenced record does not exist'
      }
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An error occurred'
    }
  });
};

module.exports = errorHandler;
