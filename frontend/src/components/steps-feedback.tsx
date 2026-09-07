"use client";

// HARNESS CODE — NOT PUBLISHED BY THE DOCS.
//
// The Human-in-the-loop snippet imports `@/components/steps-feedback` and never
// publishes it. What the page says about it, in full:
//
//   "Inside StepsFeedback, let the user toggle steps and then call
//    respond({ accepted: true, steps }) to resume the agent, or
//    respond({ accepted: false }) to reject. The agent reads the returned value
//    and continues accordingly. See the full component in the UI Dojo."
//
// That paragraph is the whole specification, so this component is written from
// it and nothing else — which is the point: if a component built only from the
// page's prose resumes the agent correctly, the prose is sufficient. If it does
// not, the gap is real. See FINDINGS.md finding 2.

import { useEffect, useState } from "react";

type Step = { description: string; status: "enabled" | "disabled" | "executing" };

export function StepsFeedback({
  args,
  respond,
  status,
}: {
  args: { steps?: Step[] };
  respond?: (result: unknown) => void;
  status: string;
}) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [answered, setAnswered] = useState(false);

  // Arguments stream in, so the list fills as the agent writes it.
  useEffect(() => {
    if (args?.steps?.length) {
      setSteps(args.steps);
    }
  }, [args?.steps]);

  if (!steps.length) {
    return <div className="text-sm text-slate-500">Generating steps…</div>;
  }

  const toggle = (i: number) =>
    setSteps((prev) =>
      prev.map((s, j) =>
        j === i
          ? { ...s, status: s.status === "enabled" ? "disabled" : "enabled" }
          : s,
      ),
    );

  const send = (accepted: boolean) => {
    setAnswered(true);
    // The two shapes the page names, and nothing else.
    respond?.(accepted ? { accepted: true, steps } : { accepted: false });
  };

  // `status` is "executing" while the agent waits on `respond`. Once the run has
  // moved on there is nothing left to answer, so the controls come down.
  const waiting = status === "executing" && !answered;

  return (
    <div data-testid="steps-feedback" className="rounded-lg border border-slate-300 p-4">
      <div className="mb-3 text-sm font-medium text-slate-800">
        Select the steps to keep
      </div>

      <ul className="space-y-2">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={step.status === "enabled"}
              disabled={!waiting}
              onChange={() => toggle(i)}
            />
            <span className={step.status === "disabled" ? "text-slate-400 line-through" : ""}>
              {step.description}
            </span>
          </li>
        ))}
      </ul>

      {waiting ? (
        <div className="mt-4 flex gap-2">
          <button
            data-testid="steps-accept"
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
            onClick={() => send(true)}
          >
            Continue
          </button>
          <button
            data-testid="steps-reject"
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            onClick={() => send(false)}
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="mt-4 text-xs text-slate-500">
          {answered ? "Sent to the agent." : "No longer awaiting a response."}
        </div>
      )}
    </div>
  );
}
