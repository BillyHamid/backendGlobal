/**
 * Logger structuré - Production-ready
 */
const isDev = process.env.NODE_ENV !== 'production';

const format = (level, message, meta = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(Object.keys(meta).length && { meta }),
  };
  return isDev
    ? `[${entry.timestamp}] ${level.toUpperCase()}: ${message}${Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''}`
    : JSON.stringify(entry);
};

const logger = {
  info: (message, meta = {}) => console.log(format('info', message, meta)),
  warn: (message, meta = {}) => console.warn(format('warn', message, meta)),
  error: (message, meta = {}) => console.error(format('error', message, meta)),
  debug: (message, meta = {}) => {
    if (isDev) console.debug(format('debug', message, meta));
  },
};

module.exports = logger;
