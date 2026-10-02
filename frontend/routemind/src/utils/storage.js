// Browser storage can be unavailable (private mode, blocked site data); never let that break the app.

function read(store, key, fallback) {
  try {
    const raw = window[store].getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(store, key, value) {
  try {
    if (value === undefined || value === null) window[store].removeItem(key);
    else window[store].setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage blocked: state simply is not persisted.
  }
}

export const local = {
  get: (key, fallback = null) => read('localStorage', key, fallback),
  set: (key, value) => write('localStorage', key, value),
};

// The active trip lives in sessionStorage so it survives a reload but not the browser session.
export const session = {
  get: (key, fallback = null) => read('sessionStorage', key, fallback),
  set: (key, value) => write('sessionStorage', key, value),
};
