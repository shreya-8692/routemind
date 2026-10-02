// Geometry helpers. Points are { lat, lng }; polylines are arrays of [lat, lng].
const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance from p to segment a-b in metres, using a local equirectangular
 * projection (accurate to well under 1% for segments of a few km).
 * Returns { distance, t } where t in [0,1] is the projection along the segment.
 */
function pointToSegment(p, a, b) {
  const cosLat = Math.cos(toRad(p.lat));
  const ax = toRad(a.lng - p.lng) * cosLat * EARTH_RADIUS_M;
  const ay = toRad(a.lat - p.lat) * EARTH_RADIUS_M;
  const bx = toRad(b.lng - p.lng) * cosLat * EARTH_RADIUS_M;
  const by = toRad(b.lat - p.lat) * EARTH_RADIUS_M;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { distance: Math.sqrt(cx * cx + cy * cy), t };
}

const asPoint = ([lat, lng]) => ({ lat, lng });

function polylineLength(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) total += haversine(asPoint(coords[i - 1]), asPoint(coords[i]));
  return total;
}

/**
 * Closest point of a polyline to p.
 * Returns { distance, segmentIndex, t, alongMeters, totalMeters }.
 */
function nearestOnPolyline(p, coords) {
  if (!coords || coords.length === 0) return null;
  if (coords.length === 1) {
    return { distance: haversine(p, asPoint(coords[0])), segmentIndex: 0, t: 0, alongMeters: 0, totalMeters: 0 };
  }
  let best = { distance: Infinity, segmentIndex: 0, t: 0 };
  let bestAlong = 0;
  let cumulative = 0;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = asPoint(coords[i]);
    const b = asPoint(coords[i + 1]);
    const segLen = haversine(a, b);
    const r = pointToSegment(p, a, b);
    if (r.distance < best.distance) {
      best = { distance: r.distance, segmentIndex: i, t: r.t };
      bestAlong = cumulative + r.t * segLen;
    }
    cumulative += segLen;
  }
  return { ...best, alongMeters: bestAlong, totalMeters: cumulative };
}

/** The part of a polyline after the point closest to p (starting at the projected point). */
function remainingPolyline(p, coords) {
  const near = nearestOnPolyline(p, coords);
  if (!near) return [];
  const a = coords[near.segmentIndex];
  const b = coords[near.segmentIndex + 1] || a;
  const projected = [a[0] + (b[0] - a[0]) * near.t, a[1] + (b[1] - a[1]) * near.t];
  return [projected, ...coords.slice(near.segmentIndex + 1)];
}

function bearing(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached by travelling `meters` from p along `bearingDeg`. */
function destinationPoint(p, bearingDeg, meters) {
  const delta = meters / EARTH_RADIUS_M;
  const theta = toRad(bearingDeg);
  const lat1 = toRad(p.lat);
  const lng1 = toRad(p.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta));
  const lng2 =
    lng1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(lat1), Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

/** Bounding box of polylines, padded by `padMeters`. */
function boundingBox(polylines, padMeters = 0) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const line of polylines) {
    for (const [lat, lng] of line) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  const padLat = padMeters / 111320;
  const padLng = padMeters / (111320 * Math.max(0.01, Math.cos(toRad((minLat + maxLat) / 2))));
  return { minLat: minLat - padLat, maxLat: maxLat + padLat, minLng: minLng - padLng, maxLng: maxLng + padLng };
}

/** Square polygon (GeoJSON ring order: [lng, lat]) of half-width `meters` around p. */
function squareAround(p, meters) {
  const n = destinationPoint(p, 0, meters).lat;
  const s = destinationPoint(p, 180, meters).lat;
  const e = destinationPoint(p, 90, meters).lng;
  const w = destinationPoint(p, 270, meters).lng;
  return [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
}

function isValidCoordinate(lat, lng) {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

module.exports = {
  haversine,
  pointToSegment,
  polylineLength,
  nearestOnPolyline,
  remainingPolyline,
  bearing,
  destinationPoint,
  boundingBox,
  squareAround,
  isValidCoordinate,
};
