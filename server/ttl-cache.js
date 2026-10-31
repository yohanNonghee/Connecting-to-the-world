// Cache successful provider results, share concurrent loads, and optionally serve stale data.
export function createTtlCache({ ttlMs, staleTtlMs = 0, maxEntries = 100, now = Date.now }) {
  const entries = new Map();
  const pending = new Map();

  return {
    async get(key, loader) {
      const currentTime = now();
      const entry = entries.get(key);
      if (entry && entry.expiresAt > currentTime) {
        return { value: entry.value, stale: false };
      }

      if (pending.has(key)) return pending.get(key);

      const request = Promise.resolve()
        .then(loader)
        .then((value) => {
          const storedAt = now();
          entries.delete(key);
          entries.set(key, {
            value,
            expiresAt: storedAt + ttlMs,
            staleUntil: storedAt + ttlMs + staleTtlMs
          });
          while (entries.size > maxEntries) {
            entries.delete(entries.keys().next().value);
          }
          return { value, stale: false };
        })
        .catch((error) => {
          const cached = entries.get(key);
          if (cached && cached.staleUntil > now()) {
            return { value: cached.value, stale: true };
          }
          throw error;
        })
        .finally(() => pending.delete(key));

      pending.set(key, request);
      return request;
    }
  };
}
