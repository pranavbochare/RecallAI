/** An external dependency (Ollama / Qdrant) failed. Carries a human hint on how to fix it. */
export class ServiceError extends Error {
  constructor(service, message, { hint = '', status = 503, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ServiceError';
    this.service = service;
    this.hint = hint;
    this.status = status;
  }
}

/** A client mistake (bad input, unknown id...). */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function describeError(err) {
  if (err instanceof ServiceError) return err.hint ? `${err.message}. ${err.hint}` : err.message;
  return err?.message || String(err);
}
