class TtlCache {
  constructor() { this.items = new Map(); }

  get(key) {
    const entry = this.items.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.items.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.items.set(key, { value, expiresAt: Date.now() + Math.max(1000, Number(ttlMs) || 1000) });
    if (this.items.size > 500) {
      const oldest = this.items.keys().next().value;
      if (oldest) this.items.delete(oldest);
    }
    return value;
  }
}

module.exports = { TtlCache };
