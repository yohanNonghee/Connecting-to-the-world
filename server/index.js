import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import rateLimit from "express-rate-limit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createTtlCache } from "./ttl-cache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const app = express();
const port = Number(process.env.PORT || 3001);
const requestTimeoutMs = 15000;
const upstreamRetryDelayMs = 300;
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
const weatherCache = createTtlCache({
  ttlMs: 10 * 60 * 1000,
  staleTtlMs: 6 * 60 * 60 * 1000,
  maxEntries: 100
});

class DataProviderError extends Error {
  constructor(provider, status, retryAfter) {
    super(`${provider} returned ${status}`);
    this.provider = provider;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error("TRUST_PROXY_HOPS must be a non-negative integer.");
}

app.set("trust proxy", trustProxyHops);

// Limit bursts against upstream providers; use a shared store for multi-instance production.
const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 50,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." }
});

app.disable("x-powered-by");
app.use("/api", apiLimiter);

// Retry a transient provider failure once while preserving rate-limit details.
async function fetchJson(url, options = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(requestTimeoutMs),
        headers: { Accept: "application/json", ...options.headers }
      });
    } catch (error) {
      if (attempt === 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, upstreamRetryDelayMs));
      continue;
    }

    if (response.ok) return response.json();

    if (response.status === 429) {
      throw new DataProviderError(new URL(url).hostname, response.status, response.headers.get("retry-after"));
    }
    if (response.status < 500 || attempt === 1) {
      throw new DataProviderError(new URL(url).hostname, response.status, response.headers.get("retry-after"));
    }
    await new Promise((resolve) => setTimeout(resolve, upstreamRetryDelayMs));
  }
  throw new Error("Data provider request failed after retry.");
}

function retryAfterSeconds(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(Math.ceil(seconds), 3600);
  if (value) {
    const dateDelay = Math.ceil((Date.parse(value) - Date.now()) / 1000);
    if (Number.isFinite(dateDelay) && dateDelay > 0) return Math.min(dateDelay, 3600);
  }
  return 60;
}

// Normalize and validate external input before using it in provider requests.
function validCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function normalizeParameter(value = "") {
  return String(value).toLowerCase().replaceAll(".", "").replaceAll("_", "");
}

function isParticleSensor(sensor) {
  const name = sensor.parameter?.name ?? sensor.parameter ?? "";
  const normalized = normalizeParameter(name);
  return normalized === "pm25" || normalized === "pm10";
}

function findReadingParameter(reading, sensorsById) {
  const sensorId = reading.sensorsId ?? reading.sensorId ?? reading.sensor_id;
  const sensor = sensorsById.get(sensorId);
  const name = reading.parameter?.name
    ?? reading.parameter
    ?? sensor?.parameter?.name
    ?? sensor?.parameter
    ?? sensor?.name
    ?? "";
  const normalized = normalizeParameter(name);
  if (normalized === "pm25") return "pm25";
  if (normalized === "pm10") return "pm10";
  return null;
}

// Fetch the nearest supported OpenAQ station while preserving its units and timestamp.
async function getAirQuality(latitude, longitude) {
  if (!process.env.OPENAQ_API_KEY) {
    return { available: false, message: "OpenAQ API key is not configured on the server.", measurements: [] };
  }

  const freshnessWindowMs = 7 * 24 * 60 * 60 * 1000;
  const locationsUrl = new URL("https://api.openaq.org/v3/locations");
  locationsUrl.searchParams.set("coordinates", `${latitude},${longitude}`);
  locationsUrl.searchParams.set("radius", "25000");
  locationsUrl.searchParams.set("limit", "100");
  const headers = { "X-API-Key": process.env.OPENAQ_API_KEY };
  const locationPayload = await fetchJson(locationsUrl, { headers });
  const locations = Array.isArray(locationPayload.results) ? locationPayload.results : [];
  const now = Date.now();
  const locationsWithRecentData = locations
    .filter((location) => {
      if (!(location.sensors || []).some(isParticleSensor)) return false;
      const lastReportedAt = Date.parse(location.datetimeLast?.utc || "");
      const age = now - lastReportedAt;
      return Number.isFinite(lastReportedAt) && age >= -60 * 60 * 1000 && age <= freshnessWindowMs;
    })
    .sort((left, right) => (left.distance ?? Infinity) - (right.distance ?? Infinity));

  if (!locationsWithRecentData.length) {
    return { available: false, message: "No OpenAQ station reporting PM2.5 or PM10 was found within 25 km.", measurements: [] };
  }

  // Skip inactive or empty nearby stations and stop after a bounded number of provider calls.
  for (const location of locationsWithRecentData.slice(0, 8)) {
    const latestUrl = `https://api.openaq.org/v3/locations/${encodeURIComponent(location.id)}/latest`;
    const latestPayload = await fetchJson(latestUrl, { headers });
    const sensorsById = new Map((location.sensors || []).map((sensor) => [sensor.id, sensor]));
    const readings = Array.isArray(latestPayload.results) ? latestPayload.results : [];
    const measurements = readings.flatMap((reading) => {
      const parameter = findReadingParameter(reading, sensorsById);
      const value = Number(reading.value);
      const datetime = reading.datetime?.utc ?? reading.datetime ?? reading.date?.utc ?? null;
      const timestamp = Date.parse(datetime || "");
      const age = now - timestamp;
      if (!parameter || !Number.isFinite(value) || !Number.isFinite(timestamp) || age < -60 * 60 * 1000 || age > freshnessWindowMs) return [];
      return [{
        parameter,
        value,
        unit: reading.parameter?.units
          ?? sensorsById.get(reading.sensorsId ?? reading.sensorId ?? reading.sensor_id)?.parameter?.units
          ?? null,
        datetime
      }];
    });

    if (!measurements.length) continue;

    const latestTimestamp = measurements
      .map((item) => item.datetime)
      .sort()
      .at(-1);
    return {
      available: true,
      station: location.name || "OpenAQ station",
      observedAt: latestTimestamp,
      measurements
    };
  }

  return {
    available: false,
    message: "No recent PM2.5 or PM10 readings were found at nearby OpenAQ stations.",
    measurements: []
  };
}

function getPmMeasurement(measurements, parameter) {
  return measurements.find((measurement) => measurement.parameter === parameter) ?? null;
}

// Keep MCP tools server-side and start the local stdio process before serving requests.
const mcpClient = new Client({ name: "citypulse-web", version: "1.0.0" });
const mcpTransport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(__dirname, "mcp.js")],
  cwd: rootDir
});

await mcpClient.connect(mcpTransport);

// Expose runtime health for deployment checks and local diagnostics.
app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", mcp: "connected", openaqConfigured: Boolean(process.env.OPENAQ_API_KEY) });
});

// Resolve city names through Open-Meteo without exposing upstream details to the browser.
app.get("/api/geocode", async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (query.length < 2 || query.length > 100) {
    response.status(400).json({ error: "Enter a city name between 2 and 100 characters." });
    return;
  }
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", query);
    url.searchParams.set("count", "6");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const payload = await fetchJson(url);
    response.json({
      results: (payload.results || []).map((place) => ({
        name: place.name,
        country: place.country || "",
        admin1: place.admin1 || "",
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: place.timezone || "auto"
      }))
    });
  } catch (error) {
    console.error("Geocoding request failed:", error.message);
    response.status(502).json({ error: "Could not search Open-Meteo right now. Please try again later." });
  }
});

// Fetch required weather first; air quality and the MCP insight are independent optional data.
app.get("/api/city", async (request, response) => {
  const latitude = validCoordinate(request.query.lat, -90, 90);
  const longitude = validCoordinate(request.query.lon, -180, 180);
  const name = typeof request.query.name === "string" ? request.query.name.trim().slice(0, 100) : "";
  const country = typeof request.query.country === "string" ? request.query.country.trim().slice(0, 100) : "";
  if (latitude === null || longitude === null || !name) {
    response.status(400).json({ error: "Invalid coordinates or city name." });
    return;
  }

  const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
  weatherUrl.searchParams.set("latitude", String(latitude));
  weatherUrl.searchParams.set("longitude", String(longitude));
  weatherUrl.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m");
  weatherUrl.searchParams.set("timezone", "auto");
  weatherUrl.searchParams.set("forecast_days", "1");

  let weather;
  let weatherIsStale = false;
  try {
    const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
    const cachedWeather = await weatherCache.get(cacheKey, async () => {
      const payload = await fetchJson(weatherUrl);
      if (!payload.current || typeof payload.current.temperature_2m !== "number") {
        throw new Error("Open-Meteo response did not contain current weather.");
      }
      return payload;
    });
    weather = cachedWeather.value;
    weatherIsStale = cachedWeather.stale;
  } catch (error) {
    console.error("Weather request failed:", error.message, error.cause?.message || "");
    if (error instanceof DataProviderError && error.status === 429) {
      const retryAfter = retryAfterSeconds(error.retryAfter);
      response.set("Retry-After", String(retryAfter));
      response.status(503).json({
        error: `Open-Meteo is rate-limiting requests. Please retry in about ${retryAfter} seconds.`
      });
      return;
    }
    response.status(502).json({ error: "Could not load weather from Open-Meteo. Please try again later." });
    return;
  }

  let airQuality;
  try {
    airQuality = await getAirQuality(latitude, longitude);
  } catch (error) {
    console.error("OpenAQ request failed:", error.message);
    airQuality = {
      available: false,
      message: "Could not load OpenAQ data right now.",
      measurements: []
    };
  }

  // Keep the MCP summary's weather labels consistent with the English UI.
  const weatherCodeDescriptions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    80: "Rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Severe thunderstorm with hail"
  };
  const current = weather.current;
  let insight;
  try {
    const pm25 = getPmMeasurement(airQuality.measurements, "pm25");
    const pm10 = getPmMeasurement(airQuality.measurements, "pm10");
    const toolResult = await mcpClient.callTool({
      name: "summarize_city_conditions",
      arguments: {
        city: [name, country].filter(Boolean).join(", "),
        temperatureC: current.temperature_2m,
        weatherDescription: weatherCodeDescriptions[current.weather_code] || "Current conditions",
        pm25: pm25?.value ?? null,
        pm25Unit: pm25?.unit ?? null,
        pm10: pm10?.value ?? null,
        pm10Unit: pm10?.unit ?? null,
        station: airQuality.available ? airQuality.station : null
      }
    });
    const text = toolResult.content?.find((item) => item.type === "text")?.text;
    if (toolResult.isError || !text) throw new Error("MCP tool returned no summary");
    insight = { available: true, text };
  } catch (error) {
    console.error("MCP insight request failed:", error.message);
    insight = { available: false, text: "Could not generate the MCP summary. The weather data above is still available." };
  }

  response.json({
    city: { name, country, latitude, longitude },
    weather: { current, time: current.time, timezone: weather.timezone, isStale: weatherIsStale },
    airQuality,
    insight
  });
});

// Keep unknown API requests from falling through to static files.
app.use("/api", (_request, response) => {
  response.status(404).json({ error: "API route not found." });
});

// Serve the built multi-page frontend; missing assets should remain real 404 responses.
app.use(express.static(path.join(rootDir, "dist")));

const httpServer = app.listen(port, () => {
  console.log(`CityPulse API listening on port ${port}`);
});

// Close both HTTP and MCP transports cleanly when the process receives a shutdown signal.
async function shutdown() {
  httpServer.close(async () => {
    await mcpClient.close();
    process.exitCode = 0;
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
