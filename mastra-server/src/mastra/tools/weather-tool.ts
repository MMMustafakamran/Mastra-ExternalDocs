// ─────────────────────────────────────────────────────────────────────────────
// HARNESS CODE — NOT PUBLISHED BY THE DOCS.
//
// `../agents/weather-agent.ts` is published verbatim on the page and its second
// line is:
//
//   import { weatherTool } from '../tools/weather-tool'
//
// That file is never shown. Nor is its schema — and the frontend snippet three
// paragraphs later depends on it:
//
//   useRenderTool({
//     name: 'weatherTool',
//     parameters: z.object({ location: z.string() }),
//     render: ({ status, result }) => <Weather {...result} />,
//   })
//
// `<Weather {...result} />` spreads the tool's return value straight into a
// component, so the shape of `result` is the contract between the two published
// snippets — and it is stated in neither. See FINDINGS.md finding 2.
//
// This file is the smallest tool consistent with both: it takes the `location`
// the frontend declares, and returns fields a weather card can render.
// Open-Meteo, so it needs no key of its own.
// ─────────────────────────────────────────────────────────────────────────────

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

const CONDITIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  95: 'Thunderstorm',
}

export const weatherTool = createTool({
  id: 'weatherTool',
  description: 'Get the current weather for a location.',

  // Matches `z.object({ location: z.string() })` in the page's `useRenderTool`
  // snippet. If these drift apart the renderer stops matching the call.
  inputSchema: z.object({
    location: z.string().describe('City name'),
  }),

  outputSchema: z.object({
    location: z.string(),
    temperature: z.number(),
    feelsLike: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    conditions: z.string(),
  }),

  // In @mastra/core 1.64 the signature is `execute(inputData, context)` — the
  // validated input arrives as the FIRST argument. Older Mastra examples (and
  // most of what a search turns up) destructure `{ context }` from the first
  // argument instead, which under 1.64 yields `undefined` and throws inside the
  // tool. The agent then reports "the weather service is temporarily failing"
  // and nothing names the real cause — which is worth knowing, because the page
  // publishes `import { weatherTool } from '../tools/weather-tool'` and never
  // publishes the tool, so a reader has to guess this signature.
  execute: async ({ location }) => {

    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`,
    ).then((r) => r.json())

    const place = geo?.results?.[0]
    if (!place) {
      throw new Error(`Location '${location}' not found`)
    }

    const forecast = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code`,
    ).then((r) => r.json())

    const c = forecast.current

    return {
      location: place.name,
      temperature: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windSpeed: c.wind_speed_10m,
      conditions: CONDITIONS[c.weather_code] ?? 'Unknown',
    }
  },
})
