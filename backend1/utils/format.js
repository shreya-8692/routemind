function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return 'unknown';
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function formatDistance(meters) {
  if (meters == null || !Number.isFinite(meters)) return 'unknown';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

module.exports = { formatDuration, formatDistance };
