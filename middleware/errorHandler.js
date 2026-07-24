function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    error: {
      message: "Route not found",
      path: req.originalUrl,
    },
  });
}

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const isServerError = statusCode >= 500;

  if (isServerError) {
    console.error("[ERROR]", err.message);
  }

  return res.status(statusCode).json({
    success: false,
    error: {
      message: err.message || "Internal server error",
      statusCode,
      upstreamUrl: err.url || null,
    },
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
