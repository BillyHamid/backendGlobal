/**
 * Origines CORS partagées entre server.js et le gestionnaire d’erreurs
 * (sinon les réponses 500 peuvent manquer Access-Control-Allow-Origin).
 */

function buildAllowedOriginsList() {
  return [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5173',
    'https://global-ex-woad.vercel.app',
    process.env.FRONTEND_URL,
  ].filter(Boolean);
}

function normalizeTrailingSlash(url) {
  return url.replace(/\/$/, '');
}

function isNgrokOrigin(origin) {
  return (
    origin &&
    (origin.includes('ngrok-free.app') ||
      origin.includes('ngrok-free.dev') ||
      origin.includes('ngrok.io') ||
      origin.includes('ngrok.app'))
  );
}

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  const normalized = normalizeTrailingSlash(origin);
  const allowedOrigins = buildAllowedOriginsList();
  if (allowedOrigins.includes(origin) || allowedOrigins.includes(normalized)) return true;
  if (allowedOrigins.some((o) => normalizeTrailingSlash(String(o)) === normalized)) return true;
  if (isNgrokOrigin(origin)) return true;
  if (origin.includes('localhost')) return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

function applyCorsHeadersToErrorResponse(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

module.exports = {
  buildAllowedOriginsList,
  isAllowedCorsOrigin,
  applyCorsHeadersToErrorResponse,
};
