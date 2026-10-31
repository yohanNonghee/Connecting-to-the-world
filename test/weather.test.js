import assert from "node:assert/strict";
import test from "node:test";
import { loadWeather, normalizeMetNoWeather, weatherCodeFromMetNoSymbol } from "../server/weather.js";

const metNoResponse = {
  properties: {
    timeseries: [{
      time: "2026-10-31T14:00:00Z",
      data: {
        instant: {
          details: {
            air_temperature: 28.8,
            relative_humidity: 79.3,
            wind_speed: 1.2
          }
        },
        next_1_hours: {
          summary: { symbol_code: "partlycloudy_night" }
        }
      }
    }]
  }
};

// Keep fallback normalization stable when provider response fields are updated.
test("MET Norway data is normalized to dashboard units and fields", () => {
  const weather = normalizeMetNoWeather(metNoResponse);
  assert.deepEqual(weather, {
    current: {
      time: "2026-10-31T14:00:00Z",
      temperature_2m: 28.8,
      apparent_temperature: null,
      weather_code: 2,
      wind_speed_10m: 4.32,
      relative_humidity_2m: 79.3
    },
    timezone: "UTC",
    source: "MET Norway"
  });
  assert.equal(weatherCodeFromMetNoSymbol("heavyrain"), 65);
  assert.equal(weatherCodeFromMetNoSymbol("lightsleet"), 68);
  assert.equal(weatherCodeFromMetNoSymbol("heavysleet"), 69);
  assert.equal(weatherCodeFromMetNoSymbol("unknown_symbol"), null);
});

test("MET Norway normalization rejects incomplete current conditions", () => {
  assert.throws(
    () => normalizeMetNoWeather({ properties: { timeseries: [] } }),
    /did not contain current weather/
  );
  assert.throws(
    () => normalizeMetNoWeather({
      properties: {
        timeseries: [{
          time: "2026-10-31T14:00:00Z",
          data: { instant: { details: { air_temperature: 15 } } }
        }]
      }
    }),
    /unsupported weather symbol/
  );
});

// Prove a rate-limited primary provider transparently falls back to MET Norway.
test("weather loader falls back to MET Norway when Open-Meteo is rate-limited", async () => {
  const calls = [];
  const result = await loadWeather({
    latitude: 13.75634,
    longitude: 100.50144,
    openMeteoUrl: new URL("https://api.open-meteo.com/v1/forecast"),
    userAgent: "CityPulse test",
    fetchJson: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("api.open-meteo.com")) {
        throw Object.assign(new Error("rate limited"), { status: 429 });
      }
      return metNoResponse;
    }
  });

  assert.equal(result.source, "MET Norway");
  assert.equal(result.current.temperature_2m, 28.8);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1].url).searchParams.get("lat"), "13.7563");
  assert.equal(new URL(calls[1].url).searchParams.get("lon"), "100.5014");
  assert.equal(calls[1].options.headers["User-Agent"], "CityPulse test");
});

test("weather loader marks successful Open-Meteo responses as the primary source", async () => {
  const result = await loadWeather({
    latitude: 64.1466,
    longitude: -21.94,
    openMeteoUrl: new URL("https://api.open-meteo.com/v1/forecast"),
    userAgent: "CityPulse test",
    fetchJson: async () => ({
      current: { temperature_2m: 8, weather_code: 3 },
      timezone: "Atlantic/Reykjavik"
    })
  });

  assert.equal(result.source, "Open-Meteo");
  assert.equal(result.current.temperature_2m, 8);
});

test("weather loader preserves the Open-Meteo rate limit when both providers fail", async () => {
  const openMeteoError = Object.assign(new Error("rate limited"), { status: 429 });

  await assert.rejects(
    loadWeather({
      latitude: 51.5072,
      longitude: -0.1276,
      openMeteoUrl: new URL("https://api.open-meteo.com/v1/forecast"),
      userAgent: "CityPulse test",
      fetchJson: async (url) => {
        if (String(url).includes("api.open-meteo.com")) throw openMeteoError;
        throw new Error("fallback unavailable");
      }
    }),
    (error) => error === openMeteoError
  );
});
