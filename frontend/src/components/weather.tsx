// HARNESS CODE -- NOT PUBLISHED BY THE DOCS.
//
// The Tool call rendering snippet imports `@/components/weather` and renders it
// as `<Weather {...result} />` -- spreading the tool's return value straight in.
// Neither the component nor the tool's output shape is published, so the two
// halves of that snippet have no stated contract between them (FINDINGS.md
// finding 2).
//
// This is the smallest component consistent with the tool in
// `mastra-server/src/mastra/tools/weather-tool.ts`.

export function Weather({
  location,
  temperature,
  feelsLike,
  humidity,
  windSpeed,
  conditions,
}: {
  location?: string;
  temperature?: number;
  feelsLike?: number;
  humidity?: number;
  windSpeed?: number;
  conditions?: string;
}) {
  return (
    <div
      data-testid="weather-card"
      className="max-w-xs rounded-lg border border-sky-300 bg-gradient-to-br from-sky-50 to-blue-100 p-4 shadow-sm"
    >
      <h3 className="text-lg font-semibold text-sky-800">{location ?? "Unknown"}</h3>
      <p className="mb-3 text-xs uppercase tracking-wide text-sky-600">
        {conditions ?? "--"}
      </p>

      <div className="text-4xl font-bold text-slate-800">
        {temperature ?? "--"}
        <span className="text-lg text-sky-600">&deg;C</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-sky-200 pt-3 text-center">
        <div>
          <div className="text-[10px] uppercase text-slate-500">Feels like</div>
          <div className="font-mono text-sm">{feelsLike ?? "--"}&deg;</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-500">Humidity</div>
          <div className="font-mono text-sm">{humidity ?? "--"}%</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-500">Wind</div>
          <div className="font-mono text-sm">{windSpeed ?? "--"} km/h</div>
        </div>
      </div>
    </div>
  );
}
