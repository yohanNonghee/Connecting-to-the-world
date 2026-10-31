import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Verify the real stdio MCP transport and guard against unsupported AQI claims.
test("CityPulse MCP summarizes a city without labeling sensor readings as AQI", async () => {
  const client = new Client({ name: "citypulse-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(rootDir, "server", "mcp.js")],
    cwd: rootDir
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "summarize_city_conditions",
      arguments: {
        city: "Reykjavík, Iceland",
        temperatureC: 8.2,
        weatherDescription: "Partly cloudy",
        pm25: 4.5,
        pm25Unit: "µg/m³",
        pm10: null,
        pm10Unit: null,
        station: "Downtown"
      }
    });

    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /Reykjavík, Iceland/);
    assert.match(result.content[0].text, /PM2\.5 4\.5 µg\/m³/);
    assert.match(result.content[0].text, /not AQI values/);
  } finally {
    await client.close();
  }
});
