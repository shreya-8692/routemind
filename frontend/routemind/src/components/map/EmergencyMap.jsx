import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { destinationIcon, facilityIcon, hazardIcon, originIcon, pendingIcon } from './mapIcons';
import { formatDistance, formatDuration, formatTime } from '../../utils/format';

const TILE_URL = import.meta.env.VITE_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const SOURCE_LABEL = { gps: 'Your location (GPS)', manual: 'Chosen starting point', simulated: 'SIMULATED position' };

function ClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Moves the view: first fix → centre on the user; new routes → fit them; follow mode → keep the user centred. */
function ViewController({ origin, routes, follow, recenterSignal, fitSignal }) {
  const map = useMap();
  const centred = useRef(false);
  const lastRoutesKey = useRef(null);

  useEffect(() => {
    if (origin && !centred.current) {
      centred.current = true;
      map.setView([origin.lat, origin.lng], 15, { animate: false });
    }
  }, [map, origin]);

  const routesKey = routes.map((r) => r.id + r.distance).join('|');
  useEffect(() => {
    if (!routes.length || routesKey === lastRoutesKey.current) return;
    lastRoutesKey.current = routesKey;
    const bounds = L.latLngBounds(routes.flatMap((r) => r.geometry));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16, animate: false });
  }, [map, routes, routesKey]);

  useEffect(() => {
    if (fitSignal && routes.length) {
      const bounds = L.latLngBounds(routes.flatMap((r) => r.geometry));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
    // Only react to explicit "fit" presses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  useEffect(() => {
    if (recenterSignal && origin) map.setView([origin.lat, origin.lng], Math.max(map.getZoom(), 16));
    // Only react to explicit "recenter" presses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterSignal]);

  useEffect(() => {
    if (follow && origin) map.panTo([origin.lat, origin.lng], { animate: false });
  }, [map, follow, origin?.lat, origin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// dashArray is always set: Leaflet's setStyle() merges options, so an omitted key keeps the old dash pattern.
function routeStyle(route, selected, evaluation) {
  if (selected) return { color: '#0b57d0', weight: 7, opacity: 0.95, dashArray: null };
  if (evaluation?.blocked) return { color: '#c62828', weight: 5, opacity: 0.55, dashArray: '8 8' };
  return { color: '#5f6b7a', weight: 5, opacity: 0.6, dashArray: route.isDetour ? '2 8' : null };
}

export default function EmergencyMap({
  origin,
  destination,
  routes = [],
  evaluations = [],
  selectedRouteId,
  facilities = [],
  selectedFacilityId,
  hazards = [],
  pendingPoint,
  onMapClick,
  onSelectRoute,
  onRouteToFacility,
  follow = false,
  recenterSignal = 0,
  fitSignal = 0,
  clickHint,
  children,
}) {
  const evalById = Object.fromEntries(evaluations.map((e) => [e.routeId, e]));
  // Draw the selected route last so it sits on top.
  const ordered = [...routes].sort((a, b) => (a.id === selectedRouteId) - (b.id === selectedRouteId));

  return (
    <div className="map-wrap">
      {clickHint && <div className="map-hint" role="status">{clickHint}</div>}
      <MapContainer center={[20, 0]} zoom={2} minZoom={2} className="map" worldCopyJump zoomControl>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
        <ClickHandler onMapClick={onMapClick} />
        <ViewController origin={origin} routes={routes} follow={follow} recenterSignal={recenterSignal} fitSignal={fitSignal} />

        {ordered.map((route) => {
          const ev = evalById[route.id];
          const selected = route.id === selectedRouteId;
          return (
            <Polyline
              key={route.id}
              positions={route.geometry}
              pathOptions={routeStyle(route, selected, ev)}
              eventHandlers={{ click: () => onSelectRoute?.(route.id) }}
            >
              <Popup>
                <strong>{route.label}</strong>
                {selected && ' (selected)'}
                <br />
                {formatDistance(route.distance)} · {formatDuration(ev?.adjustedDuration ?? route.duration)}
                {ev?.blocked && <div className="text-danger">Passes a reported blocking hazard</div>}
                {!selected && (
                  <div>
                    <button type="button" className="btn btn-small" onClick={() => onSelectRoute?.(route.id)}>
                      Use this route
                    </button>
                  </div>
                )}
              </Popup>
            </Polyline>
          );
        })}

        {facilities.map((f) => (
          <Marker key={f.id} position={[f.lat, f.lng]} icon={facilityIcon(f.category, f.id === selectedFacilityId)}>
            <Popup>
              <div className="popup">
                <strong>{f.displayName}</strong>
                <div className="muted">{f.categoryLabel}{f.emergencyDepartment === true ? ' · Emergency dept. (OSM tag)' : ''}</div>
                <div>
                  {formatDistance(f.roadDistance ?? f.straightLineDistance)}
                  {f.roadDistance == null && ' (straight line)'}
                  {f.roadDuration != null && ` · ETA ${formatDuration(f.roadDuration)}`}
                </div>
                {f.address && <div className="muted">{f.address}</div>}
                {onRouteToFacility && (
                  <button type="button" className="btn btn-primary btn-small" onClick={() => onRouteToFacility(f)}>
                    Route here
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {hazards.map((h) => (
          <Marker key={h.id} position={[h.latitude, h.longitude]} icon={hazardIcon(h.severity, h.isSimulated)}>
            <Popup>
              <div className="popup">
                {h.isSimulated && <div className="sim-tag">SIMULATION DATA — not a real incident</div>}
                <strong>{h.title}</strong>
                <div>{h.type} · {h.severity}</div>
                {h.description && <div className="muted">{h.description}</div>}
                <div className="muted small">
                  {h.isSimulated ? 'Simulated' : 'User report (unverified)'} · expires {h.expiresAt ? formatTime(h.expiresAt) : 'never'}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
        {hazards.map((h) => (
          <Circle
            key={`${h.id}-r`}
            center={[h.latitude, h.longitude]}
            radius={h.radiusMeters || 100}
            pathOptions={{ color: h.isSimulated ? '#6a1b9a' : '#c62828', weight: 1, fillOpacity: 0.08, dashArray: h.isSimulated ? '4 4' : undefined }}
            interactive={false}
          />
        ))}

        {destination && (
          <Marker position={[destination.lat, destination.lng]} icon={destinationIcon()}>
            <Popup>
              <strong>Destination</strong>
              <br />
              {destination.name || destination.address || `${destination.lat.toFixed(5)}, ${destination.lng.toFixed(5)}`}
            </Popup>
          </Marker>
        )}

        {pendingPoint && <Marker position={[pendingPoint.lat, pendingPoint.lng]} icon={pendingIcon()} />}

        {origin && (
          <>
            {Number.isFinite(origin.accuracy) && origin.accuracy > 0 && (
              <Circle center={[origin.lat, origin.lng]} radius={origin.accuracy} pathOptions={{ color: '#0b57d0', weight: 1, fillOpacity: 0.1 }} interactive={false} />
            )}
            <Marker position={[origin.lat, origin.lng]} icon={originIcon(origin.source)} zIndexOffset={1000}>
              <Popup>
                <strong>{SOURCE_LABEL[origin.source]}</strong>
                <br />
                {origin.address || `${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`}
                {Number.isFinite(origin.accuracy) && <div className="muted">Accuracy ±{Math.round(origin.accuracy)} m</div>}
              </Popup>
            </Marker>
          </>
        )}
      </MapContainer>
      {children}
    </div>
  );
}
