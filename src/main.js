// Cache the page elements used by search, status updates, and dashboard rendering.
const form = document.querySelector("#search-form");
const input = document.querySelector("#city-input");
const status = document.querySelector("#search-status");
const results = document.querySelector("#city-results");
const dashboard = document.querySelector("#dashboard");
const popularCityButtons = document.querySelector("#popular-city-buttons");

// Provide direct-load example cities so visitors can explore without typing a search.
const popularCities = [
  { name: "Bangkok", country: "Thailand", latitude: 13.7563, longitude: 100.5018 },
  { name: "London", country: "United Kingdom", latitude: 51.5072, longitude: -0.1276 },
  { name: "New York", country: "United States", latitude: 40.7128, longitude: -74.006 },
  { name: "Reykjavík", country: "Iceland", latitude: 64.1466, longitude: -21.94 },
  { name: "Singapore", country: "Singapore", latitude: 1.3521, longitude: 103.8198 },
  { name: "Tokyo", country: "Japan", latitude: 35.6762, longitude: 139.6503 }
];

// Map Open-Meteo weather codes to concise English labels for the dashboard.
const weatherDescriptions = {
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

// Keep status messaging in one place so loading and error states stay consistent.
function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = `inline-status ${kind}`.trim();
}

// Decode backend JSON and turn HTTP failures into visible user-facing errors.
async function requestJson(url) {
  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Cannot reach the CityPulse server. Start it with `npm run dev` or open the deployed Node service.");
    }
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

// Build city choices with text nodes so API-provided names are not interpreted as HTML.
function addResultButton(place) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "city-result";
  const name = document.createElement("strong");
  name.textContent = place.name;
  const detail = document.createElement("span");
  detail.textContent = [place.admin1, place.country].filter(Boolean).join(", ");
  button.append(name, detail);
  button.addEventListener("click", () => loadCity(place));
  results.append(button);
}

// Render accessible example-city buttons and load the selected coordinates directly.
function renderPopularCities() {
  for (const city of popularCities) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "popular-city-button";
    button.append(
      createTextElement("strong", "", city.name),
      createTextElement("span", "", city.country)
    );
    button.addEventListener("click", () => loadCity(city));
    popularCityButtons.append(button);
  }
}

// Create small labeled elements consistently for all dashboard measurements.
function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

// Render current weather, optional air-quality data, and the MCP-generated summary.
function renderDashboard(data) {
  dashboard.replaceChildren();
  dashboard.hidden = false;

  const heading = document.createElement("div");
  heading.className = "dashboard-heading";
  const titleGroup = document.createElement("div");
  const kicker = createTextElement("p", "section-kicker", "CITY SNAPSHOT");
  const title = createTextElement("h2", "", [data.city.name, data.city.country].filter(Boolean).join(", "));
  titleGroup.append(kicker, title);
  const updated = createTextElement(
    "span",
    "updated-label",
    `Local time ${data.weather.time || "—"}${data.weather.isStale ? " · Cached reading" : ""}`
  );
  heading.append(titleGroup, updated);

  const grid = document.createElement("div");
  grid.className = "metric-grid";
  const current = data.weather.current;
  const weatherCard = document.createElement("article");
  weatherCard.className = "metric-card weather-card";
  weatherCard.append(
    createTextElement("span", "metric-label", "CURRENT WEATHER"),
    createTextElement("span", "weather-symbol", "☼"),
    createTextElement("strong", "temperature", `${Math.round(current.temperature_2m)}°`),
    createTextElement("span", "metric-subtitle", weatherDescriptions[current.weather_code] || "Current conditions"),
    createTextElement(
      "span",
      "metric-footnote",
      `Feels like ${Math.round(current.apparent_temperature)}° · Wind ${Math.round(current.wind_speed_10m)} km/h`
    )
  );
  weatherCard.querySelector(".weather-symbol").setAttribute("aria-hidden", "true");

  const airCard = document.createElement("article");
  airCard.className = "metric-card air-card";
  airCard.append(createTextElement("span", "metric-label", "AIR QUALITY · OPENAQ"));
  if (data.airQuality.available) {
    airCard.append(createTextElement("span", "metric-subtitle", `Station: ${data.airQuality.station || "Nearby station"}`));
    const measures = document.createElement("div");
    measures.className = "air-measures";
    for (const key of ["pm25", "pm10"]) {
      const metric = data.airQuality.measurements.find((item) => item.parameter === key);
      if (!metric) continue;
      const item = document.createElement("div");
      item.className = "air-measure";
      item.append(
        createTextElement("span", "", key === "pm25" ? "PM2.5" : "PM10"),
        createTextElement("strong", "", `${metric.value} ${metric.unit || "unit not provided"}`)
      );
      measures.append(item);
    }
    airCard.append(measures);
    airCard.append(createTextElement(
      "span",
      "metric-footnote",
      data.airQuality.observedAt
        ? `Latest reported reading: ${data.airQuality.observedAt}`
        : "Sample time not provided"
    ));
    if (!measures.childElementCount) {
      airCard.append(createTextElement(
        "span",
        "metric-subtitle",
        "Station found, but no supported PM2.5 or PM10 readings are available."
      ));
    }
  } else {
    airCard.append(createTextElement("span", "metric-subtitle", data.airQuality.message));
  }

  const insight = document.createElement("div");
  insight.className = `insight-card${data.insight.available ? "" : " insight-unavailable"}`;
  insight.append(
    createTextElement("span", "metric-label", "CITYPULSE INSIGHT · MCP"),
    createTextElement("p", "", data.insight.text)
  );
  grid.append(weatherCard, airCard);
  dashboard.append(heading, grid, insight);
}

// Load the selected location while preserving a clear partial-data state.
async function loadCity(place) {
  results.replaceChildren();
  dashboard.hidden = true;
  setStatus(`Loading data for ${place.name}…`, "loading");
  try {
    const query = new URLSearchParams({
      lat: String(place.latitude),
      lon: String(place.longitude),
      name: place.name,
      country: place.country || ""
    });
    const data = await requestJson(`/api/city?${query}`);
    renderDashboard(data);
    setStatus("");
  } catch (error) {
    setStatus(error.message || "Could not load city data. Please try again.", "error");
  }
}

renderPopularCities();

// Search Open-Meteo geocoding results and let the user choose the exact location.
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (query.length < 2) {
    setStatus("Enter a city name with at least 2 characters.", "error");
    return;
  }
  results.replaceChildren();
  dashboard.hidden = true;
  setStatus("Searching for cities…", "loading");
  try {
    const payload = await requestJson(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (!payload.results.length) {
      setStatus("No matching cities found. Check the spelling or try another name.", "error");
      return;
    }
    for (const place of payload.results) addResultButton(place);
    setStatus("Choose a location to view its data.", "success");
  } catch (error) {
    setStatus(error.message || "Search failed. Please try again.", "error");
  }
});
