// Points are { lat, lng }; polylines are arrays of [lat, lng] (same as the backend).
const R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const asPoint = ([lat, lng]) => ({ lat, lng });

/**
 * Simulation Mode helper: the point `meters` further along `geometry` than the
 * vertex nearest to `position`. Used only to move a clearly labelled simulated
 * position for testing monitoring and rerouting without travelling.
 */
export function advanceAlong(geometry, position, meters) {
  if (!geometry?.length) return null;
  let nearest = 0;
  let best = Infinity;
  geometry.forEach((p, i) => {
    const d = haversine(position, asPoint(p));
    if (d < best) {
      best = d;
      nearest = i;
    }
  });
  let remaining = meters;
  for (let i = nearest; i < geometry.length - 1; i += 1) {
    const a = asPoint(geometry[i]);
    const b = asPoint(geometry[i + 1]);
    const seg = haversine(a, b);
    if (seg >= remaining) {
      const t = seg === 0 ? 0 : remaining / seg;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    remaining -= seg;
  }
  return asPoint(geometry[geometry.length - 1]);
}

export const samePoint = (a, b) => Boolean(a && b && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7);
