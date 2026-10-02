// Minimal logger. Never pass raw request bodies or coordinates to it:
// location data is sensitive and must not end up in server logs.
const silent = process.env.NODE_ENV === 'test';

function stamp() {
  return new Date().toISOString();
}

module.exports = {
  info: (...args) => !silent && console.log(stamp(), '[info]', ...args),
  warn: (...args) => !silent && console.warn(stamp(), '[warn]', ...args),
  error: (...args) => !silent && console.error(stamp(), '[error]', ...args),
};
