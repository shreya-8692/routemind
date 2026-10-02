import { useLocation } from '../../context/contexts';
import { Banner, Spinner } from '../common/Feedback';
import PlaceSearch from './PlaceSearch';
import { formatCoord } from '../../utils/format';
import { LOCATION_REQUIRED } from '../../constants/emergency';

const SOURCE_TEXT = {
  gps: 'Live device location (GPS)',
  manual: 'Manually chosen location',
  simulated: 'SIMULATED position (Simulation Mode)',
};

/**
 * Shows where RouteMind thinks the trip starts, and the fallback options when
 * the real location is not available.
 */
export default function LocationStatus({ onPickOnMap, picking }) {
  const { origin, gps, enabled, start, preferManual, switchToDeviceLocation, manualOrigin, setManualOrigin } = useLocation();

  const fallback = (
    <div className="btn-row">
      <button type="button" className={`btn${picking ? ' btn-active' : ''}`} onClick={onPickOnMap}>
        {picking ? 'Tap the map to set your location…' : 'Choose location on map'}
      </button>
      {gps.supported && <button type="button" className="btn" onClick={switchToDeviceLocation}>Retry GPS</button>}
    </div>
  );

  // Without any location, also let the user type where they are.
  const enterLocation = !origin && (
    <details className="enter-location" open={gps.status === 'denied' || gps.status === 'unsupported' || gps.status === 'insecure'}>
      <summary>Enter your location</summary>
      <PlaceSearch label="Search for your current location" placeholder="Street, landmark or area" actionLabel="I'm here" onSelect={setManualOrigin} />
    </details>
  );

  return (
    <section className="card location-status" aria-label="Current location">
      <div className="card__head">
        <h3>Current location</h3>
        {origin && <span className={`badge badge--src-${origin.source}`}>{SOURCE_TEXT[origin.source]}</span>}
      </div>

      {origin ? (
        <>
          <p className="location-status__address">{origin.address || 'Looking up address…'}</p>
          <p className="muted small mono">
            {formatCoord(origin.lat)}, {formatCoord(origin.lng)}
            {Number.isFinite(origin.accuracy) && ` · ±${Math.round(origin.accuracy)} m`}
          </p>
        </>
      ) : null}

      {!enabled && gps.supported && !origin && (
        <>
          <p>RouteMind needs your real location to plan an emergency route.</p>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={start}>Share my location</button>
            <button type="button" className="btn" onClick={onPickOnMap}>Choose on map instead</button>
          </div>
        </>
      )}

      {enabled && gps.status === 'requesting' && !origin && <Spinner label="Waiting for GPS fix… (allow location access if your browser asks)" />}

      {(gps.status === 'denied' || gps.status === 'unsupported' || gps.status === 'insecure') && !preferManual && (
        <Banner tone="warning" title={gps.status === 'denied' ? LOCATION_REQUIRED : 'Live location unavailable'}>
          {gps.status === 'denied'
            ? 'Allow location access for this site in your browser settings, or choose your location on the map.'
            : gps.error?.message}
          {fallback}
        </Banner>
      )}

      {gps.status === 'error' && !origin && (
        <Banner tone="warning" title="Location unavailable">
          {gps.error?.message}
          {fallback}
        </Banner>
      )}

      {gps.status === 'stale' && origin?.source === 'gps' && (
        <p className="muted small">GPS signal weak — showing last known position. {gps.error?.message}</p>
      )}

      {enterLocation}

      {origin && origin.source !== 'simulated' && (
        <div className="btn-row">
          {origin.source === 'gps' && (
            <button type="button" className={`btn btn-small${picking ? ' btn-active' : ''}`} onClick={onPickOnMap}>
              {picking ? 'Tap the map…' : 'Use a different start point'}
            </button>
          )}
          {origin.source === 'manual' && gps.supported && (
            <button type="button" className="btn btn-small" onClick={switchToDeviceLocation}>
              Use my live location
            </button>
          )}
          {origin.source === 'manual' && manualOrigin && (
            <button type="button" className={`btn btn-small${picking ? ' btn-active' : ''}`} onClick={onPickOnMap}>
              {picking ? 'Tap the map…' : 'Move start point'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
