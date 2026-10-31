import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "citypulse-insights",
  version: "1.0.0"
});

// Expose one narrow tool for summarizing normalized readings without inferring AQI.
server.tool(
  "summarize_city_conditions",
  "Summarize normalized current weather and OpenAQ sensor readings. Do not infer AQI or medical guidance.",
  {
    city: z.string().min(1),
    temperatureC: z.number(),
    weatherDescription: z.string(),
    pm25: z.number().nullable(),
    pm25Unit: z.string().nullable(),
    pm10: z.number().nullable(),
    pm10Unit: z.string().nullable(),
    station: z.string().nullable()
  },
  async ({ city, temperatureC, weatherDescription, pm25, pm25Unit, pm10, pm10Unit, station }) => {
    const parts = [`${city}: ${weatherDescription}, ${temperatureC.toFixed(1)}°C.`];
    if (pm25 !== null || pm10 !== null) {
      const values = [];
      if (pm25 !== null) values.push(`PM2.5 ${pm25} ${pm25Unit || "unit not provided"}`);
      if (pm10 !== null) values.push(`PM10 ${pm10} ${pm10Unit || "unit not provided"}`);
      parts.push(`Station ${station || "nearby"} reports ${values.join(" and ")}.`);
    } else {
      parts.push("No PM2.5 or PM10 readings are available from the selected station.");
    }
    parts.push("Particulate readings are measured concentrations, not AQI values or medical advice; consider the observation time and data source.");
    return { content: [{ type: "text", text: parts.join(" ") }] };
  }
);

// Use stdio so the backend can run this MCP server as a local subprocess.
await server.connect(new StdioServerTransport());
