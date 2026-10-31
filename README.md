# CityPulse

CityPulse is a city dashboard that combines weather data from Open-Meteo (with MET Norway as a fallback) and nearby particulate readings from OpenAQ. Its backend also calls an MCP tool to summarize the collected snapshot.

## Run locally

1. Use Node.js 20–24 and run `npm install`.
2. Copy `.env.example` to `.env` and set `OPENAQ_API_KEY`. The optional `METNO_USER_AGENT` identifies the app to MET Norway; its default is configured by the server.
3. Run `npm run dev`, then open the Vite URL printed in the terminal.
4. Run `npm test` and `npm run build` to validate the app.

The browser calls same-origin `/api` routes. Provider credentials and upstream requests stay on the server. Weather responses are cached for 10 minutes, can fall back from Open-Meteo to MET Norway, and may serve a clearly labeled cached response for up to six hours during provider outages.

## Deploy

Deploy as a Node web service using `npm ci --include=dev && npm run build` as the build command and `npm start` as the start command. Configure `OPENAQ_API_KEY` as a server-side secret. `render.yaml` provides the Render service configuration. The in-memory cache and rate limiter are appropriate for a single instance; use shared stores if scaling horizontally.