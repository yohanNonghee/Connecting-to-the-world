// Map MET Norway symbol codes to the closest Open-Meteo WMO code for shared UI labels.
export function weatherCodeFromMetNoSymbol(symbolCode = "") {
  const symbol = symbolCode.replace(/_(day|night|polartwilight)$/, "");
  if (symbol === "clearsky") return 0;
  if (symbol === "fair") return 1;
  if (symbol === "partlycloudy") return 2;
  if (symbol === "cloudy") return 3;
  if (symbol === "fog") return 45;
  if (symbol.includes("thunder")) return 95;
  if (symbol.includes("snow")) return symbol.includes("heavy") ? 75 : 71;
  if (symbol.includes("sleet")) return symbol.includes("heavy") ? 69 : 68;
  if (symbol.includes("rain")) {
    if (symbol.includes("showers")) return 80;
    if (symbol.includes("heavy")) return 65;
    return 61;
  }
  return null;
}

// Convert MET Norway's instantaneous values to the common dashboard weather shape.
export function normalizeMetNoWeather(payload) {
  const series = payload.properties?.timeseries;
  const currentPoint = Array.isArray(series) ? series[0] : null;
  const details = currentPoint?.data?.instant?.details;
  if (!details || typeof details.air_temperature !== "number" || typeof currentPoint.time !== "string") {
    throw new Error("MET Norway response did not contain current weather.");
  }

  const symbolCode = currentPoint.data.next_1_hours?.summary?.symbol_code
    ?? currentPoint.data.next_6_hours?.summary?.symbol_code
    ?? currentPoint.data.next_12_hours?.summary?.symbol_code
    ?? "";
  const weatherCode = weatherCodeFromMetNoSymbol(symbolCode);
  if (weatherCode === null) {
    throw new Error("MET Norway returned an unsupported weather symbol.");
  }

  return {
    current: {
      time: currentPoint.time,
      temperature_2m: details.air_temperature,
      apparent_temperature: null,
      weather_code: weatherCode,
      wind_speed_10m: typeof details.wind_speed === "number" ? details.wind_speed * 3.6 : null,
      relative_humidity_2m: typeof details.relative_humidity === "number" ? details.relative_humidity : null
    },
    timezone: "UTC",
    source: "MET Norway"
  };
}

// Fall back to MET Norway when Open-Meteo is temporarily unavailable or rate-limited.
export async function loadWeather({ latitude, longitude, openMeteoUrl, fetchJson, userAgent }) {
  try {
    const payload = await fetchJson(openMeteoUrl);
    if (!payload.current || typeof payload.current.temperature_2m !== "number") {
      throw new Error("Open-Meteo response did not contain current weather.");
    }
    return { ...payload, source: "Open-Meteo" };
  } catch (openMeteoError) {
    const fallbackUrl = new URL("https://api.met.no/weatherapi/locationforecast/2.0/compact");
    fallbackUrl.searchParams.set("lat", latitude.toFixed(4));
    fallbackUrl.searchParams.set("lon", longitude.toFixed(4));
    try {
      const payload = await fetchJson(fallbackUrl, {
        headers: { "User-Agent": userAgent }
      });
      return normalizeMetNoWeather(payload);
    } catch (fallbackError) {
      if (openMeteoError.status === 429) {
        openMeteoError.fallbackError = fallbackError;
        throw openMeteoError;
      }
      fallbackError.openMeteoError = openMeteoError;
      throw fallbackError;
    }
  }
}
