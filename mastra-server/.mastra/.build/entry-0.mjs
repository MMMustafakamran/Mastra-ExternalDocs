import { Mastra } from '@mastra/core/mastra';
import { registerCopilotKit } from '@ag-ui/mastra/copilotkit';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const CONDITIONS = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  75: "Heavy snow",
  80: "Rain showers",
  95: "Thunderstorm"
};
const weatherTool = createTool({
  id: "weatherTool",
  description: "Get the current weather for a location.",
  // Matches `z.object({ location: z.string() })` in the page's `useRenderTool`
  // snippet. If these drift apart the renderer stops matching the call.
  inputSchema: z.object({
    location: z.string().describe("City name")
  }),
  outputSchema: z.object({
    location: z.string(),
    temperature: z.number(),
    feelsLike: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    conditions: z.string()
  }),
  execute: async ({ context }) => {
    const { location } = context;
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`
    ).then((r) => r.json());
    const place = geo?.results?.[0];
    if (!place) {
      throw new Error(`Location '${location}' not found`);
    }
    const forecast = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code`
    ).then((r) => r.json());
    const c = forecast.current;
    return {
      location: place.name,
      temperature: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windSpeed: c.wind_speed_10m,
      conditions: CONDITIONS[c.weather_code] ?? "Unknown"
    };
  }
});

const weatherAgent = new Agent({
  id: "weather-agent",
  name: "Weather Agent",
  instructions: "Use the weatherTool to fetch current weather data.",
  model: "openai/gpt-5.6-sol",
  tools: { weatherTool }
});

const planningAgent = new Agent({
  id: "planning-agent",
  name: "Planning Agent",
  instructions: 'When the user asks for a plan, call generate_task_steps with a list of steps. Each step needs a description and a status of "enabled". After the user responds, acknowledge which steps they kept and continue.',
  model: "openai/gpt-5.6-sol"
});

const bgColorAgent = new Agent({
  id: "bg-color-agent",
  name: "Background Color Agent",
  instructions: "When the user asks for a background colour, call colorChangeTool with the requested colour as a CSS colour string. Confirm the change in one short sentence.",
  model: "openai/gpt-5.6-sol"
});

const mastra = new Mastra({
  // ── Not published on the page ────────────────────────────────────────────
  // The page's frontend snippets pass `agent="weatherAgent"` and say: "The
  // `agent` prop names the Mastra agent to route to. It must match a key in
  // your Mastra instance's `agents` map."
  //
  // That map is never shown. Every `new Mastra({...})` block on the page elides
  // it as `// Rest of the configuration...`, so a reader is told to match a key
  // in a structure the page does not display. See FINDINGS.md finding 1.
  //
  // The keys below are the three the page's own snippets name across its
  // sections: `weatherAgent`, `planningAgent` (Human-in-the-loop) and
  // `bgColorAgent` (Frontend tools).
  agents: {
    weatherAgent,
    planningAgent,
    bgColorAgent
  },
  // ── Deployment section ───────────────────────────────────────────────────
  // "you must exclude @copilotkit/runtime from the bundle. This package
  // contains dependencies that aren't compatible with bundling and will cause
  // 500 errors if included."
  //
  // Only bites on `mastra build`, not on `mastra dev` — so a harness that only
  // ever runs dev would never exercise it. Kept anyway: it is one of the page's
  // few unambiguous, testable claims.
  bundler: {
    externals: ["@copilotkit/runtime"]
  },
  // ── Integration guide, step 2 ────────────────────────────────────────────
  server: {
    cors: {
      origin: "*",
      allowMethods: ["*"],
      allowHeaders: ["*"]
    },
    apiRoutes: [registerCopilotKit({
      path: "/copilotkit",
      resourceId: "weatherAgent"
    })]
  }
});

export { mastra };
