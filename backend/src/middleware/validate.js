function sendValidationError(res, error) {
  return res.status(400).json({
    error: 'Validation failed',
    details: error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    })),
  });
}

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return sendValidationError(res, result.error);
  }
  req.body = result.data;
  next();
};

export const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    return sendValidationError(res, result.error);
  }
  req.query = result.data;
  next();
};

export default validate;