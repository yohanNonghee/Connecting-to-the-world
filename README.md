# CityPulse

CityPulse is a city dashboard that combines weather data from Open-Meteo with nearby particulate readings from OpenAQ. Its backend also calls an MCP tool to summarize the collected snapshot.

## Getting started

1. Use Node.js 20–24.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set your `OPENAQ_API_KEY`. Without a key, the app still displays weather and explains that air-quality data is unavailable.
4. Run `npm run dev`.
5. Open the URL printed by Vite (usually `http://localhost:5173`).

The landing page is `/`, the dashboard is `/app.html`, and the technical report is `/report.html`.

## Verification

```sh
npm test
npm run build
npm start
```

After building and starting the service, check `http://localhost:3001/api/health`.

## Deployment

### Render

This repository includes a Render Blueprint in `render.yaml`. In Render, choose **New → Blueprint** and connect this repository. When prompted, enter `OPENAQ_API_KEY` as a secret environment variable. The blueprint configures the health check and trusted proxy hop.

The `OPENAQ_API_KEY` is required for live OpenAQ sensor readings. Obtain a key through OpenAQ and enter it in the hosting provider's environment settings—never commit it or put it in frontend variables. If the key is absent, weather and MCP continue to work, while the dashboard reports air-quality data as unavailable.

### Other Node.js hosts

Use a Node web service that supports Node.js 20–24:

- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Environment variables: `OPENAQ_API_KEY`, `PORT` (provided by the host), and `TRUST_PROXY_HOPS` (set to the number of trusted reverse proxies; usually `1`).

Express serves the built multi-page frontend and `/api/*` from the same service. The backend starts the MCP server as a stdio subprocess, so both must run in the same Node service. Do not deploy this project as static-only hosting.

After deployment, verify `https://YOUR-SERVICE/api/health`. It should return `"status":"ok"` and `"mcp":"connected"`; `"openaqConfigured"` should be `true` after setting the API key.

See the [technical report](./report.html) for architecture, decisions, limitations, deployment guidance, and a submission-comment template.
"# Connecting-to-the-world" 
