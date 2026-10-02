import L from 'leaflet';
import { FACILITY_STYLE } from '../../constants/emergency';

// HTML/CSS markers (styled in index.css) avoid Leaflet's default image-icon path issues with bundlers.
const cache = new Map();

function icon(key, { className, html, size = [28, 28], anchor }) {
  if (!cache.has(key)) {
    cache.set(
      key,
      L.divIcon({ className: `rm-marker ${className}`, html, iconSize: size, iconAnchor: anchor || [size[0] / 2, size[1] / 2], popupAnchor: [0, -size[1] / 2] }),
    );
  }
  return cache.get(key);
}

export const originIcon = (source) =>
  icon(`origin-${source}`, {
    className: `rm-origin rm-origin--${source}`,
    html: source === 'gps' ? '<span class="rm-pulse"></span><span class="rm-dot"></span>' : `<span class="rm-dot">${source === 'simulated' ? 'S' : 'M'}</span>`,
    size: [22, 22],
  });

export const destinationIcon = () =>
  icon('destination', { className: 'rm-destination', html: '<span>D</span>', size: [34, 42], anchor: [17, 40] });

export const facilityIcon = (category, selected) =>
  icon(`facility-${category}-${selected}`, {
    className: `rm-facility rm-facility--${category}${selected ? ' is-selected' : ''}`,
    html: `<span>${FACILITY_STYLE[category]?.symbol || '?'}</span>`,
    size: [28, 28],
  });

export const hazardIcon = (severity, simulated) =>
  icon(`hazard-${severity}-${simulated}`, {
    className: `rm-hazard rm-hazard--${severity.toLowerCase()}${simulated ? ' is-simulated' : ''}`,
    html: `<span>!</span>${simulated ? '<em>SIM</em>' : ''}`,
    size: [30, 30],
  });

export const pendingIcon = () => icon('pending', { className: 'rm-pending', html: '<span>+</span>', size: [26, 26] });
