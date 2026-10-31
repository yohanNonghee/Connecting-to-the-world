import assert from "node:assert/strict";
import test from "node:test";
import { createTtlCache } from "../server/ttl-cache.js";

// Keep a controllable clock so cache expiration tests do not depend on wall time.
test("TTL cache reuses fresh values and shares concurrent provider loads", async () => {
  let now = 1000;
  let loads = 0;
  const cache = createTtlCache({ ttlMs: 100, now: () => now });
  const loader = async () => {
    loads += 1;
    return { temperature: 18 };
  };

  const [first, concurrent] = await Promise.all([
    cache.get("city", loader),
    cache.get("city", loader)
  ]);
  const fresh = await cache.get("city", loader);

  assert.deepEqual(first, { value: { temperature: 18 }, stale: false });
  assert.deepEqual(concurrent, first);
  assert.deepEqual(fresh, first);
  assert.equal(loads, 1);
});

test("TTL cache serves a stale value when refresh fails within the stale window", async () => {
  let now = 1000;
  const cache = createTtlCache({ ttlMs: 100, staleTtlMs: 500, now: () => now });
  await cache.get("city", async () => ({ temperature: 18 }));
  now += 101;

  const result = await cache.get("city", async () => {
    throw new Error("provider unavailable");
  });

  assert.deepEqual(result, { value: { temperature: 18 }, stale: true });
});
