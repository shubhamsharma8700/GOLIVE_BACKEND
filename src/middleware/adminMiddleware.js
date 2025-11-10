export const adminMiddleware = (req, res, next) => {
  // No auth check for now
  next();
};
