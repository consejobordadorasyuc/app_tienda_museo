import { AppError } from './errors.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export async function readJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'La solicitud debe enviarse como JSON.');
  }

  try {
    return await request.json();
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'El contenido JSON no es válido.');
  }
}

export function errorResponse(error) {
  if (error instanceof AppError) {
    return json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      error.status,
    );
  }

  console.error(error);
  return json(
    {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ocurrió un error inesperado. Intenta nuevamente.',
      },
    },
    500,
  );
}

export function ok(data = {}, status = 200, extraHeaders = {}) {
  return json({ ok: true, ...data }, status, extraHeaders);
}

export function getPathParts(request) {
  const pathname = new URL(request.url).pathname.replace(/^\/api\/?/, '');
  return pathname.split('/').filter(Boolean).map(decodeURIComponent);
}

export function normalizeMethod(request) {
  return request.method.toUpperCase();
}
