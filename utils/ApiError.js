class ApiError extends Error {
  constructor(status, message, code = 'ERROR', extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
module.exports = ApiError;
