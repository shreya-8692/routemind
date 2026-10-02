import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import EmergencyMap from '../components/map/EmergencyMap';
import ErrorBoundary from '../components/common/ErrorBoundary';
import LocationStatus from '../components/panels/LocationStatus';
import FacilityList from '../components/panels/FacilityList';
import PlaceSearch from '../components/panels/PlaceSearch';
import RoutePanel from '../components/panels/RoutePanel';
import RouteAlerts from '../components/panels/RouteAlerts';
import HazardForm from '../components/panels/HazardForm';
import DebugPanel from '../components/panels/DebugPanel';
import Disclaimer from '../components/layout/Disclaimer';
import { Banner, ErrorMessage, Spinner } from '../components/common/Feedback';
import { useEmergency, useLocation, useSettings } from '../context/contexts';
import { useAsync } from '../hooks/useAsync';
import { createHazard, getFacilities, getHazards } from '../services/routemindApi';
import { emergencyById } from '../constants/emergency';
import { advanceAlong } from '../utils/geo';
import { formatCoord } from '../utils/format';

const CLICK_HINTS = {
  origin: 'Tap the map to set your starting location',
  destination: 'Tap the map to choose the destination',
  hazard: 'Tap the map where the hazard is',
  'sim-position': 'SIMULATION: tap the map to place the simulated position',
};

export default function MapPage() {
  const { settings } = useSettings();
  const { origin, start, enabled, setManualOrigin, setSimulatedPosition, simulatedPosition } = useLocation();
  const { trip, planning, planError, clearPlanError, planRoute, selectRoute, selectedRoute } = useEmergency();
  const [params, setParams] = useSearchParams();
  const initialMode = params.get('mode');

  const [tab, setTab] = useState(initialMode === 'search' || initialMode === 'map' ? 'destination' : initialMode === 'facilities' ? 'facilities' : 'route');
  const [clickMode, setClickMode] = useState(initialMode === 'map' ? 'destination' : null);
  const [pendingPoint, setPendingPoint] = useState(null);
  const [hazardDraft, setHazardDraft] = useState(null); // { point, simulated }
  const [focusFacility, setFocusFacility] = useState(null);
  const [follow, setFollow] = useState(false);
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [fitSignal, setFitSignal] = useState(0);
  const [simBusy, setSimBusy] = useState(false);
  const autoPlanned = useRef(false);

  const type = emergencyById(trip.emergencyType);

  // Ask for the real location as soon as the map opens (if not already watching).
  useEffect(() => {
    if (!enabled) start();
  }, [enabled, start]);

  // Facilities near the origin; the key is rounded to ~1 km so moving does not re-query constantly.
  const latKey = origin ? origin.lat.toFixed(2) : null;
  const lngKey = origin ? origin.lng.toFixed(2) : null;
  const facilities = useAsync(
    ({ signal }) => getFacilities({ lat: origin.lat, lng: origin.lng, type: trip.emergencyType }, { signal }),
    [trip.emergencyType, latKey, lngKey],
    { enabled: Boolean(origin && trip.emergencyType), keepData: false },
  );

  const hazards = useAsync(() => getHazards({ includeSimulated: settings.simulationMode }), [settings.simulationMode]);
  const reloadHazards = hazards.reload;
  useEffect(() => {
    const id = setInterval(reloadHazards, 30000);
    return () => clearInterval(id);
  }, [reloadHazards]);

  // Option A from the emergency screen: let the agent pick the nearest suitable facility as soon as the location is known.
  useEffect(() => {
    if (initialMode === 'nearest' && origin && !trip.plan && !planning && !autoPlanned.current) {
      autoPlanned.current = true;
      planRoute(null);
      setParams({}, { replace: true });
    }
  }, [initialMode, origin, trip.plan, planning, planRoute, setParams]);

  if (!type) return <Navigate to="/emergency" replace />;

  const onMapClick = (point) => {
    if (clickMode === 'origin') {
      setManualOrigin(point);
      setClickMode(null);
    } else if (clickMode === 'destination') {
      setPendingPoint(point);
      setClickMode(null);
    } else if (clickMode === 'hazard') {
      setHazardDraft((d) => ({ ...d, point }));
      setClickMode(null);
    } else if (clickMode === 'sim-position') {
      setSimulatedPosition(point);
      setClickMode(null);
    }
  };

  const toggleClick = (mode) => setClickMode((m) => (m === mode ? null : mode));

  const routeToFacility = (f) => {
    setPendingPoint(null);
    setTab('route');
    planRoute({ lat: f.lat, lng: f.lng, name: f.displayName, address: f.address || undefined });
  };

  const routeToPoint = (p) => {
    setPendingPoint(null);
    setTab('route');
    planRoute(p);
  };

  const startHazard = (simulated) => {
    setHazardDraft({ point: null, simulated });
    setClickMode('hazard');
    setTab('hazards');
  };

  // Simulation helpers (clearly labelled, only in Simulation Mode).
  const simStep = (meters) => {
    if (!selectedRoute || !origin) return;
    const next = advanceAlong(selectedRoute.geometry, origin, meters);
    if (next) setSimulatedPosition(next);
  };
  const simBlockAhead = async () => {
    if (!selectedRoute || !origin) return;
    const p = advanceAlong(selectedRoute.geometry, origin, Math.min(1200, selectedRoute.distance * 0.5));
    setSimBusy(true);
    try {
      await createHazard({ type: 'Road Block', severity: 'High', title: 'Simulated road closure ahead', latitude: p.lat, longitude: p.lng, durationHours: 0.5, source: 'simulation' });
      reloadHazards();
    } finally {
      setSimBusy(false);
    }
  };

  const destination = trip.plan?.destination || trip.destination || null;
  const tabs = [
    ['route', trip.plan ? 'Route' : 'Destination'],
    ['facilities', 'Facilities'],
    ['hazards', 'Hazards'],
  ];
  const showDestinationChooser = !trip.plan && (tab === 'route' || tab === 'destination');

  return (
    <div className="map-page">
      <div className="map-page__map">
        <ErrorBoundary compact>
          <EmergencyMap
            origin={origin}
            destination={destination}
            routes={trip.plan?.routes || []}
            evaluations={trip.plan?.evaluation?.evaluations || []}
            selectedRouteId={trip.selectedRouteId}
            facilities={facilities.data?.facilities || []}
            selectedFacilityId={focusFacility?.id || trip.plan?.facility?.id}
            hazards={hazards.data?.hazards || []}
            pendingPoint={pendingPoint || hazardDraft?.point}
            onMapClick={onMapClick}
            onSelectRoute={selectRoute}
            onRouteToFacility={routeToFacility}
            follow={follow}
            recenterSignal={recenterSignal}
            fitSignal={fitSignal}
            clickHint={clickMode ? CLICK_HINTS[clickMode] : null}
          >
            <div className="map-controls">
              <button type="button" className="map-btn" onClick={() => setRecenterSignal((n) => n + 1)} disabled={!origin} title="Recenter on current location" aria-label="Recenter on current location">
                ◎
              </button>
              <button type="button" className={`map-btn${follow ? ' is-active' : ''}`} onClick={() => setFollow((f) => !f)} disabled={!origin} aria-pressed={follow} title="Follow my position" aria-label="Follow my position">
                ➤
              </button>
              {trip.plan && (
                <button type="button" className="map-btn" onClick={() => setFitSignal((n) => n + 1)} title="Show whole route" aria-label="Show whole route">
                  ⤢
                </button>
              )}
            </div>
            {planning && (
              <div className="map-overlay-status">
                <Spinner label="Emergency Route Agent: fetching routes, hazards and conditions…" />
              </div>
            )}
          </EmergencyMap>
        </ErrorBoundary>
      </div>

      <aside className="map-page__panel" aria-label="Emergency route panel">
        <div className="panel-type">
          <span className="panel-type__icon" aria-hidden="true">{type.icon}</span>
          <div>
            <strong>{type.label}</strong>
            <div className="muted small">Looking for: {type.facilities}</div>
          </div>
          <Link to="/emergency" className="btn btn-small">Change</Link>
        </div>

        <RouteAlerts />
        {planError && (
          <Banner tone="danger" title="Route could not be calculated" actions={<button type="button" className="btn btn-small" onClick={clearPlanError}>Dismiss</button>}>
            {planError.message}
          </Banner>
        )}

        <LocationStatus picking={clickMode === 'origin'} onPickOnMap={() => toggleClick('origin')} />

        <div className="tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id || (id === 'route' && tab === 'destination')}
              className={`tab${tab === id || (id === 'route' && tab === 'destination') ? ' is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {showDestinationChooser && (
          <section className="card" aria-label="Choose destination">
            <h3>Choose destination</h3>
            {!origin && <p className="muted">Your starting location is needed first.</p>}
            <button type="button" className="btn btn-primary btn-large btn-block" onClick={() => planRoute(null)} disabled={!origin || planning}>
              {planning ? 'Calculating…' : `Nearest suitable ${type.id === 'fire' ? 'fire station' : type.id === 'police' ? 'police station' : 'facility'} (automatic)`}
            </button>
            <p className="muted small">The Emergency Route Agent ranks real OpenStreetMap facilities by road travel time and plans the route.</p>

            <h4>Search for a destination</h4>
            <PlaceSearch near={origin} onSelect={routeToPoint} actionLabel="Route here" />

            <h4>Or select on the map</h4>
            <button type="button" className={`btn${clickMode === 'destination' ? ' btn-active' : ''}`} onClick={() => toggleClick('destination')}>
              {clickMode === 'destination' ? 'Tap the map… (cancel)' : 'Select destination on map'}
            </button>
            {pendingPoint && (
              <Banner tone="info" title="Selected point" actions={
                <>
                  <button type="button" className="btn btn-primary btn-small" onClick={() => routeToPoint({ ...pendingPoint, name: 'Selected point on map' })} disabled={!origin || planning}>Route here</button>
                  <button type="button" className="btn btn-small" onClick={() => setPendingPoint(null)}>Clear</button>
                </>
              }>
                <span className="mono">{formatCoord(pendingPoint.lat)}, {formatCoord(pendingPoint.lng)}</span>
              </Banner>
            )}
          </section>
        )}

        {tab === 'route' && trip.plan && <RoutePanel />}

        {tab === 'facilities' && (
          <section className="card" aria-label="Nearby facilities">
            <div className="card__head">
              <h3>Nearby: {type.facilities}</h3>
              <button type="button" className="btn btn-small" onClick={facilities.reload} disabled={!origin || facilities.loading}>Refresh</button>
            </div>
            {!origin ? (
              <p className="muted">Waiting for your location…</p>
            ) : (
              <FacilityList
                result={facilities.data}
                loading={facilities.loading}
                error={facilities.error}
                onReload={facilities.reload}
                onRoute={routeToFacility}
                onFocus={setFocusFacility}
                selectedId={focusFacility?.id}
                disabled={planning}
              />
            )}
          </section>
        )}

        {tab === 'hazards' && (
          <section className="card" aria-label="Hazards">
            <div className="card__head">
              <h3>Road hazards</h3>
              <button type="button" className="btn btn-small" onClick={hazards.reload}>Refresh</button>
            </div>
            <ErrorMessage error={hazards.error} title="Hazard reports unavailable" onRetry={hazards.reload} />
            {hazards.data && (
              <p className="muted small">
                {hazards.data.hazards.length} active hazard report(s){settings.simulationMode ? ' incl. simulated' : ''}. RouteMind has no live incident feed: hazards come from user reports{settings.simulationMode ? ' and Simulation Mode' : ''}.
              </p>
            )}
            {hazardDraft ? (
              <HazardForm
                point={hazardDraft.point}
                simulated={hazardDraft.simulated}
                onCreated={() => {
                  setHazardDraft(null);
                  reloadHazards();
                }}
                onCancel={() => {
                  setHazardDraft(null);
                  setClickMode(null);
                }}
              />
            ) : (
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => startHazard(false)}>Report a hazard</button>
                {settings.simulationMode && <button type="button" className="btn btn-sim" onClick={() => startHazard(true)}>Add simulated hazard</button>}
              </div>
            )}

            {settings.simulationMode ? (
              <div className="sim-tools">
                <h4>Simulation tools <span className="badge badge--sim">DEMO</span></h4>
                <p className="muted small">Move a simulated position along the route to test monitoring, off-route detection and rerouting without travelling.</p>
                <div className="btn-row">
                  <button type="button" className={`btn btn-small btn-sim${clickMode === 'sim-position' ? ' btn-active' : ''}`} onClick={() => toggleClick('sim-position')}>Place simulated position</button>
                  <button type="button" className="btn btn-small btn-sim" onClick={() => simStep(250)} disabled={!selectedRoute || !origin}>Advance 250 m</button>
                  <button type="button" className="btn btn-small btn-sim" onClick={() => simStep(1000)} disabled={!selectedRoute || !origin}>Advance 1 km</button>
                  <button type="button" className="btn btn-small btn-sim" onClick={simBlockAhead} disabled={!selectedRoute || !origin || simBusy}>Simulate road block ahead</button>
                  {simulatedPosition && <button type="button" className="btn btn-small" onClick={() => setSimulatedPosition(null)}>Use real position</button>}
                </div>
              </div>
            ) : (
              <p className="muted small">Developers: enable Simulation Mode in <Link to="/settings">Settings</Link> to test rerouting with labelled demo hazards.</p>
            )}
          </section>
        )}

        {settings.showDebug && <DebugPanel />}
        <Disclaimer compact />
      </aside>
    </div>
  );
}
