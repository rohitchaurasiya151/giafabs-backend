/**
 * Lightweight console-based logger, gated by config.logging.level.
 * debug < info < warn < error — only messages at or above the configured
 * level are printed.
 */

const config = require('../config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const threshold = LEVELS[config.logging.level] ?? LEVELS.info;

function makeLog(level, consoleMethod) {
  return (...args) => {
    if (LEVELS[level] >= threshold) consoleMethod(...args);
  };
}

module.exports = {
  debug: makeLog('debug', console.debug),
  info: makeLog('info', console.info),
  warn: makeLog('warn', console.warn),
  error: makeLog('error', console.error),
};
