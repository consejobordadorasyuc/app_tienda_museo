export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, options = {}) {
  const response = await fetch(`/api/${path.replace(/^\//, '')}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    const error = payload?.error || {};
    throw new ApiError(
      error.message || `La solicitud no pudo completarse (${response.status}).`,
      response.status,
      error.code || 'REQUEST_FAILED',
      error.details,
    );
  }

  return payload;
}
