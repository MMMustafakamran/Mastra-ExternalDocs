// Harness index. Not doc code -- a map of which section of the (single) Mastra
// CopilotKit page each route implements.

const SECTIONS = [
  {
    title: "Integration guide",
    anchor: "#integration-guide",
    covers: "Standalone Mastra server + Next frontend, registerCopilotKit, CopilotChat",
    route: "/quickstart/demo-chat",
    published: "fully",
  },
  {
    title: "Generative UI - Controlled - Tool call rendering",
    anchor: "#controlled",
    covers: "useRenderTool (v2) painting a weather card from a streaming tool call",
    route: "/tool-rendering/demo-chat",
    published: "partly",
  },
  {
    title: "App control - Frontend tools",
    anchor: "#frontend-tools",
    covers: "useFrontendTool running colorChangeTool in the browser",
    route: "/frontend-tools/demo-chat",
    published: "partly",
  },
  {
    title: "App control - Human-in-the-loop",
    anchor: "#human-in-the-loop",
    covers: "useHumanInTheLoop suspending the run until respond() is called",
    route: "/human-in-the-loop/demo-chat",
    published: "partly",
  },
] as const;

const DOC = "https://mastra.ai/guides/build-your-ui/copilotkit/overview";

const BADGE: Record<string, string> = {
  fully: "border-emerald-300 bg-emerald-100 text-emerald-800",
  partly: "border-amber-300 bg-amber-100 text-amber-900",
};

const LABEL: Record<string, string> = {
  fully: "Published in full",
  partly: "Frontend published, backend not",
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">
        Mastra · CopilotKit external-docs harness
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Mastra documents this integration on{" "}
        <a className="underline" href={DOC} target="_blank" rel="noreferrer">
          one page
        </a>
        , so the routes below are sections of it rather than separate pages.
      </p>

      <ul className="mt-8 space-y-4">
        {SECTIONS.map((s) => (
          <li key={s.title} className="rounded-lg border border-slate-200 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <a
                className="font-medium text-slate-900 underline"
                href={DOC + s.anchor}
                target="_blank"
                rel="noreferrer"
              >
                {s.title}
              </a>
              <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${BADGE[s.published]}`}>
                {LABEL[s.published]}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{s.covers}</p>
            <a className="mt-3 inline-block text-sm text-sky-700 underline" href={s.route}>
              Open the demo &rarr;
            </a>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-xs text-slate-500">
        Three of the four sections publish their React in full and their Mastra
        agent in a sentence or not at all. See{" "}
        <code>doc-snapshot/reports/FINDINGS.md</code>.
      </p>
    </main>
  );
}
