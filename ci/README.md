# `ci/` — the recording pipeline

Everything that builds, starts, checks and records this repo lives here. The
only piece outside this folder is `.github/workflows/daily-recorder.yml`, because
GitHub requires that path.

## Layout

```
ci/
├── automate.mjs          entry point — one process, start to finish
├── check-doc-drift.mjs   compares doc-snapshot/ against the live docs
├── list-pages.mjs        prints the recorder's page ids
├── validate-pages.mjs    rejects unknown ids before a run starts
├── resolve-selection.mjs expands dispatch checkboxes + ids into a page list
├── run-name.mjs          names the run's artifacts (MsPy-react-18Aug2026-0612UTC)
├── write-readme-status.mjs regenerates README §8 from nav-config.ts + pages.config.ts
└── lib/
    ├── config.mjs        paths, ports, URLs
    ├── env.mjs           loads .env files the way backend/main.py does
    ├── pages.mjs         reads page ids from the recorder's config
    ├── preflight.mjs     port, credential and warmup checks
    ├── mux.mjs           voiceover muxing (the only implementation)
    └── report.mjs        RUN_REPORT.md / .json
```

## Commands

| Command | What it does |
|---|---|
| `npm run automate` | Full pipeline: drift → preflight → deps → servers → record |
| `npm run automate:pull` | Same, after `git pull` |
| `npm run automate:locked` | Same, but installing the committed lockfiles |
| `npm run drift` | Doc drift check: hashes tracked pages, and compares the sitemap for new upstream pages (new = drift, exit 2) |
| `npm run drift:sync` | Update `doc-snapshot/` to match live docs |
| `npm run ci:pages` | List valid page ids |
| `npm run readme:status` | Rewrite the README status table; `readme:status:check` exits 1 if it is stale |

Anything not consumed by `automate.mjs` is forwarded to the recorder:

```bash
node ci/automate.mjs --pages=quickstart,readables
node ci/automate.mjs --shard=1/3
node ci/automate.mjs --limit=3 --ignore-doc-drift
```

## Flags

| Flag | Effect |
|---|---|
| `--pull` | `git pull` first |
| `--use-lockfile` | Install the committed lockfiles instead of re-resolving (see below) |
| `--skip-install` | Skip dependency installation |
| `--ignore-doc-drift` / `--force` | Record even if the live docs moved |
| `--skip-doc-drift` | Do not contact the docs site at all (the workflow passes this to each shard; the prepare job already ran the check) |
| `--allow-port-reuse` | Record against servers that are already running |
| `--skip-credential-check` | Skip the model-credential preflight |

## What runs, in order

1. **Doc drift** — compares each `doc-snapshot/pages/*.md` hash against the live
   page. Drift halts the run with exit code 2 unless `--ignore-doc-drift`.
2. **Preflight** — loads `.env`, then refuses to continue if a port is already
   held or the model credential is missing/rejected. Both checks are cheap and
   both have cost a full run before.
3. **Dependencies** — `uv sync` for the backend, `npm install` for the frontend
   and recorder.
4. **Servers** — backend and frontend, spawned from this process, logging to
   `autorecorder/videos/logs/`.
5. **Health + warmup** — poll until both answer, then compile the heaviest
   routes so the recorder is not racing a cold Turbopack build.
6. **Record** — hand off to the recorder with the forwarded flags.
7. **Mux + report** — always runs, success or failure.

## Why one process

Each `run:` step in a GitHub Actions job is a separate subshell. A server
started with `&` in one step is reaped before the next step begins. Spawning
both servers from inside `automate.mjs` keeps them alive for the whole run,
which is why the pipeline is a Node program and not a sequence of YAML steps.

## Page selection

`autorecorder/config/pages.config.ts` is the single source of truth for which
demos exist. `lib/pages.mjs` reads the ids from it, `list-pages.mjs` prints
them, and `validate-pages.mjs` checks a selection against them.

The workflow does **not** restate the list. It used to, in two more places, and
they drifted whenever a page was renamed.

### Choosing pages on a manual run

The dispatch form has a checkbox per **doc section** plus a free-text field for
exact ids. Tick sections, type ids, or both — the two are combined.

| Checkbox | Pages |
|---|---|
| Getting Started | quickstart, prebuilt-components |
| Custom Look & Feel | slots, headless-ui, programmatic-control, inspector |
| Generative UI | display-only, interactive, tool-rendering, state-rendering |
| App Control | frontend-tools, in-app-agent-read, in-app-agent-write, readables, auth |
| Rich Threads | threads-drawer, threads-headless, threads-lifecycle |
| Backend | copilot-runtime, ag-ui |

Nothing ticked and nothing typed means **all pages** — what the nightly schedule
does.

**Why sections rather than one checkbox per page:** GitHub allows a
`workflow_dispatch` at most **10 inputs**. Twenty page checkboxes plus the
options came to 24, which made the workflow invalid — every manual run failed
before a job started. Six section checkboxes plus four options is exactly 10, so
the form is now at the cap: adding an input means removing one.

The section map lives in `PAGE_GROUPS` in `lib/pages.mjs`, and a run fails if any
page belongs to no section, so nothing can quietly become unreachable.

## Adding a page

1. Add it to `autorecorder/config/pages.config.ts`.
2. Add its id to a section in `PAGE_GROUPS` (`ci/lib/pages.mjs`).

Skipping step 2 fails the run with the page named, rather than silently dropping
it from the form.

## Which versions get recorded

A run re-resolves its dependencies by default: the lockfiles are dropped and
`npm install` (plus `uv sync --upgrade` where there is a Python agent) pick the
newest versions the ranges in `package.json` and `pyproject.toml` already allow.
`@copilotkit/*` is a caret range, so a release is recorded the night it ships,
and a major version still cannot arrive without someone editing the manifest.

This is the same thing as deleting `node_modules` and `package-lock.json` by
hand, which is how these demos have always been checked before a release. On CI
there is nothing to delete beside the lockfile: every run starts on a clean
runner.

`--use-lockfile` (dispatch checkbox **Install the committed lockfiles**) opts
back into the committed versions. Reach for it to reproduce an older run, or to
find out whether a break came from the demo or from the tree beneath it.

What no run does is rewrite the ranges. `ncu -u --peer` used to run here and was
the largest single source of CI failures across these repos: it bumped every
`@angular/*` package past a lockfile that still pinned the old ones, and the
exact inter-package peer requirements made the result unsatisfiable. Raising a
range is a reviewed edit to `package.json`, not something a nightly recording
run should do to itself.

## CI shape

`prepare` resolves the run name and page list once. Three workers each record a
third of the pages under `xvfb-run`, then `consolidate-recordings` merges the
artifacts.

```
            ┌─ Worker 1/3 ─┐
prepare ────┼─ Worker 2/3 ─┼─→ consolidate-recordings
            └─ Worker 3/3 ─┘
```

## Artifact names

Every artifact is named for the project and the moment the run started:

```
MsPy-react-18Aug2026-0612UTC             ← consolidated, all clips
MsPy-react-18Aug2026-0612UTC-shard-1     ← one worker's output
```

`prepare` computes the stamp once (`ci/run-name.mjs`) and passes it to the other
jobs, so all four names agree. Change the prefix via `PROJECT_SLUG` in
`lib/config.mjs`.

## Secrets and variables

| Name | Kind | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | secret | Model provider key |
| `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_ENDPOINT` | secret | Azure instead of OpenAI |
| `COPILOTKIT_LICENSE_TOKEN` | secret | Unlocks the Rich Threads pages |
| `CPK_INTELLIGENCE_API_KEY` | secret | Managed thread store (old name `INTELLIGENCE_API_KEY` still read) |
| `OPENAI_CHAT_MODEL_ID` | variable | Model override (default `gpt-4o-mini`) |
| `INTELLIGENCE_API_URL` / `INTELLIGENCE_GATEWAY_WS_URL` | variable | Endpoint overrides |

Without the Intelligence pair the three Rich Threads pages still record, but the
drawer stays locked and mutations return 422.

## Troubleshooting

**"Ports already in use"** — a previous run's servers survived. Stop the listed
PIDs, or pass `--allow-port-reuse` to record against them. Do not ignore this:
Windows lets a second process bind a port another is already listening on, and
requests then land on whichever accepts first, so a stale server holding old
environment variables can answer instead of the new one.

**"OPENAI_API_KEY is missing or still the placeholder"** — set a real key in
`backend/.env` or the repo-root `.env`. Note the precedence: `backend/.env` is
read first, so an uncommented placeholder there shadows a real key at the root.

**Server died mid-run** — read `autorecorder/videos/logs/backend.log` and
`frontend.log`. They are uploaded with the CI artifacts.

**Recorder aborts on preflight** — the frontend was still compiling. The warmup
step covers the usual routes; a page added to `WARMUP_ROUTES` in `lib/config.mjs`
gets the same treatment.
