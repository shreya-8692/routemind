import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useEmergency, useLocation } from '../context/contexts';
import { EMERGENCY_TYPES, emergencyById } from '../constants/emergency';
import LocationStatus from '../components/panels/LocationStatus';
import Disclaimer from '../components/layout/Disclaimer';

const DESTINATION_OPTIONS = [
  { mode: 'nearest', title: 'Nearest suitable facility', text: 'Use my current location and let RouteMind pick the facility reachable soonest by road.' },
  { mode: 'facilities', title: 'Choose from nearby facilities', text: 'See hospitals / stations near you with distance and ETA.' },
  { mode: 'search', title: 'Search for a destination', text: 'A specific hospital, station or any address.' },
  { mode: 'map', title: 'Select on the map', text: 'Tap the destination directly on the map.' },
];

export default function EmergencyPage() {
  const navigate = useNavigate();
  const { trip, startTrip, setEmergencyType } = useEmergency();
  const { origin } = useLocation();
  const [step, setStep] = useState(trip.emergencyType && !trip.plan ? 2 : 1);
  const selected = emergencyById(trip.emergencyType);

  const choose = (id) => {
    // Changing the type of an untouched trip keeps it; otherwise a new trip starts.
    if (trip.emergencyType && !trip.plan && trip.status === 'idle') setEmergencyType(id);
    else startTrip(id);
    setStep(2);
  };

  return (
    <div className="page page--narrow">
      {step === 1 && (
        <section aria-labelledby="type-heading">
          <h1 id="type-heading">Select Emergency Type</h1>
          <div className="type-grid">
            {EMERGENCY_TYPES.map((t) => (
              <button key={t.id} type="button" className={`type-btn type-btn--${t.id}${trip.emergencyType === t.id ? ' is-selected' : ''}`} onClick={() => choose(t.id)}>
                <span className="type-btn__icon" aria-hidden="true">{t.icon}</span>
                <span className="type-btn__label">{t.label}</span>
                <span className="type-btn__hint">Finds: {t.facilities}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && selected && (
        <section aria-labelledby="dest-heading">
          <div className="panel-type">
            <span className="panel-type__icon" aria-hidden="true">{selected.icon}</span>
            <div>
              <strong>{selected.label}</strong>
              <div className="muted small">Looking for: {selected.facilities}</div>
            </div>
            <button type="button" className="btn btn-small" onClick={() => setStep(1)}>Change</button>
          </div>

          <LocationStatus onPickOnMap={() => navigate('/map')} />

          <h1 id="dest-heading">Where to?</h1>
          <div className="dest-options">
            {DESTINATION_OPTIONS.map((o, i) => (
              <button key={o.mode} type="button" className={`dest-btn${i === 0 ? ' dest-btn--primary' : ''}`} onClick={() => navigate(`/map?mode=${o.mode}`)} disabled={o.mode === 'nearest' && !origin}>
                <strong>{o.title}</strong>
                <span>{o.text}</span>
              </button>
            ))}
          </div>
          {!origin && <p className="muted small">“Nearest suitable facility” becomes available once your location is known.</p>}
        </section>
      )}
      <Disclaimer compact />
    </div>
  );
}
