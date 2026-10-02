/** Small in-memory TTL cache used to stay within public API usage limits. */
class TTLCache {
  constructor({ ttlMs, maxEntries = 500 }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    if (this.store.size >= this.maxEntries) {
      // Map preserves insertion order, so the first key is the oldest.
      this.store.delete(this.store.keys().next().value);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  clear() {
    this.store.clear();
  }
}

module.exports = TTLCache;
