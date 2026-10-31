---
name: citypulse-development
description: "Build, change, test, or deploy CityPulse features that use Open-Meteo, OpenAQ, Express, or its MCP insight tool. Use when working on this app's data flow, security, UI states, or technical report."
---

# CityPulse Development

Use this workflow for CityPulse changes so API data, MCP behavior, and user-facing explanations remain consistent.

## Project boundaries

- The browser calls only same-origin `/api/*` routes. Keep upstream requests and credentials on the server.
- Open-Meteo geocoding and forecast plus OpenAQ v3 are data APIs. MET Norway is the weather fallback when Open-Meteo fails or rate-limits; send a User-Agent and preserve its attribution requirements. The `citypulse-insights` MCP server summarizes normalized values; it is not a substitute for either API.
- OpenAQ PM readings are concentrations, not AQI. Do not invent AQI categories, health claims, or data timestamps.
- Keep the MCP tool narrow and typed. Do not add arbitrary SQL, shell execution, or untrusted prompt-driven actions.

## Change workflow

1. Trace the relevant browser → Express route → upstream API/MCP tool flow before editing.
2. Validate query parameters at the server boundary, set finite request timeouts, cache successful provider data, and return explicit HTTP errors including retry guidance for upstream rate limits.
3. Keep OpenAQ failures separate from weather failures so a missing station/key does not hide available weather. Show a clear unavailable state rather than a success-shaped placeholder.
4. Render remote text with DOM text APIs; do not inject API values as HTML.
5. Keep loading, empty, partial-data, rate-limit, and retryable error states understandable.
6. Preserve same-origin behavior. In development, use the Vite `/api` proxy; in production, serve the built pages and API from the Node service.
7. Update `report.html` when architecture, provider behavior, security, limitations, or deployment steps change.
8. Run `npm test` and `npm run build`; check `/api/health` and the city-search flow when the server can be started.

## Secrets and operations

- Read API keys from server environment variables (`OPENAQ_API_KEY`); never commit `.env` or expose secrets in browser bundles, logs, or MCP responses.
- Use the API rate limiter and provider terms/quota; production multi-instance deployments need a shared rate-limit store.
- The MCP server uses stdio. Keep protocol output on stdout and diagnostics on stderr.
