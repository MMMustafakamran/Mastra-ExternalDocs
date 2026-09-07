# ADAPT.md — porting this recorder to another CopilotKit integration

**Read this file before changing anything. Follow it in order.**

You are adapting a working screen-recording suite from one CopilotKit
integration to another. It currently records **Microsoft Agent Framework
(Python) + React**. The target might be `ms-agent-dotnet`, `agno`, `langgraph`,
an Angular frontend, or anything else CopilotKit documents.

The suite arrives **working**. You are editing a reference implementation, not
filling in blanks. If you find yourself writing a file from scratch, stop and
re-read this.

---

## Definition of done

```bash
npm run doctor          # static: config, files, line ranges, handlers
npm run doctor:online   # also: every demo route, every doc URL, the selectors
npm run record -- --<first-page-id>
```

`doctor` must exit **0**. Then one real recording must report `[PASS]` and the
video must be watchable.

Nothing else counts as finished. Not "the config looks right" — the doctor
exiting zero. If you cannot make it pass, say so and say which check fails;
do not describe the port as complete.

---

## What you may edit

| Path | Edit? | What it is |
|---|---|---|
| `config/project.config.ts` | **Yes** | Framework slug, doc root, URLs, start commands |
| `config/pages.config.ts` | **Yes** | One entry per doc page |
| `config/selectors.config.ts` | **Yes** | How to find the chat surface in this frontend |
| `config/cli.config.ts` | **Yes** | This framework's terminal flows — the scaffolding CLI and the installs |
| `actions/*.action.ts` | **Yes** | What to do on a page that needs more than "send a prompt" |
| `actions/index.ts` | **Yes** | Which handler serves which page id |
| `core/**` | **No** | Engine, IDE simulator, overlays, cursor, doctor, CLI driver |
| `cli.ts`, `cli-capture.ts`, `cli-render.ts` | **No** | Argument parsing and the run summaries |

**Do not edit `core/`.** It contains no framework-specific knowledge — every
such value already comes from `config/`. If you believe a change to `core/` is
required, that is a finding to report, not a change to make quietly: it means
something framework-specific leaked into shared code, and every other repo using
this folder has the same problem.

---

## Step 1 — Identity

Edit `config/project.config.ts`. Every field has a comment saying what it is.

The one to get right is `framework`: the slug exactly as it appears in
`https://docs.copilotkit.ai/<framework>/...`. Doc URLs are built from it, so a
wrong slug silently records the wrong framework's documentation.

`videoPrefix` should identify both sides of the integration — `MSPY-react`,
`MSNET-react`, `AGNO-angular` — because these files end up in one folder
together.

If the backend is not Python, `backendStartCmd` and `backendHealthPath` change.
They are only ever printed or fetched; nothing parses them.

## Step 2 — Fetch the real doc nav

Do not copy the page list from another repo, and do not work from memory. Fetch
`https://docs.copilotkit.ai/<framework>` and read its sidebar.

Frameworks share most pages — quickstart, prebuilt components, slots, headless
UI, generative UI, shared state — but not all. Some lack pages the reference has;
some have pages it does not. A page that 404s is a finding worth reporting, not
something to quietly keep.

## Step 3 — The page registry

Edit `config/pages.config.ts`: delete pages this framework does not document,
add the ones it does, and put them in doc-nav order — order determines the number
in each video filename.

Entries are short because URLs and filenames are derived. Set `docPath` and
`route`; never write a full URL.

`startLine`/`endLine` are what the simulated IDE highlights, and they are the
thing most likely to be wrong after a port. Open each `ideFile` and read the
range. If the frontend marks its interesting lines with `[!code highlight]` or
`#region`, keep those markers — the doctor uses them to detect drift later.

## Step 4 — The selector contract

Edit `config/selectors.config.ts`.

If the target frontend is React using CopilotKit's prebuilt components, the
defaults likely work unchanged. **If it is Angular, or the app renders its own
chat, they will not.** Open a demo page, inspect the real chat input, submit
control and assistant message, and write selectors that match those and nothing
else.

`assistantMessage` is the one to be careful with. It drives both "has the reply
started" and "has it finished". If it matches a container rather than individual
messages, every reply looks complete the instant it begins, and the videos show
prompts with no answers.

`npm run doctor:online` reports which selectors match nothing on a live page.

## Step 5 — The actions

Most pages need nothing: with no entry in `ACTION_MAP` they get
`runStandardAction`, which types the prompt, submits, and waits for the reply.

Write a handler only for pages that need more — switching tabs, clicking an
approval button, opening a panel. Copy the closest existing handler and build on
the helpers in `core/actions.ts` rather than re-implementing them:

```ts
const msgCount = await sendPrompt(page, config.prompt);
await waitForAgentResponseCompletion(page, config.waitAfterPromptMs ?? 4000, msgCount);
```

Pass that count through on multi-turn pages, or the previous turn's reply is
mistaken for this one's.

Delete handlers for pages that no longer exist. The doctor warns about orphans.

## Step 5b — The CLI flows

Only if this framework's quickstart tells people to run a command. Most do:
`npx copilotkit@latest create` is the same entrypoint everywhere, but the
answers are not.

Edit `config/cli.config.ts`: the constants at the top (app name, the
framework row to select, the Intelligence project), and the prompts if this
CLI asks different ones. `npm run capture -- --login` is the first real run
and doubles as the check that the PTY works on this machine: it opens a
browser and waits on the terminal, which a pipe cannot do.

**Name rows; never count keypresses.** Write
`select: { label: 'Mastra' }`, not twelve `Down` keys. The framework list has
23 entries today and grows with every integration CopilotKit ships, so a count
that is right this week silently scaffolds the wrong framework next week — and
reports success while doing it. `npm run doctor` rejects a step that sends more
than one arrow key without a `select`.

Mark genuinely conditional prompts `optional: true`. Two in the reference are:
npx only asks to install when the package is uncached, and only 18 of the 23
frameworks' starters offer a chat channel at all.

```bash
npm run capture -- --login       # once; sign-in opens a browser
npm run capture -- --scaffold    # runs the real CLI, writes a cast
npm run capture -- --distribute  # copies the scaffold, seeds the model key
npm run capture -- --install-npm # one per package manager (pnpm, yarn, bun)
npm run cli:videos               # films everything, decides video 3 per manager
```

The deliverable is one CLI clip plus three per package manager: the install
(always, pass or fail), then **either** the app running **or** the failure
explained. `cli:videos` reads each install's `casts/*.report.json` and films
the finding clip (`onFailure`) for a failed install or records the live demo
(`onSuccess` → a page in `pages.config.ts`) for one that worked. Nobody picks
which by hand. `config/cli.config.ts` generates all of it from
`PACKAGE_MANAGERS`; change that one list and every clip follows.

A failure you have not analysed yet still produces a finding clip: the note is
built from the report (command, exit code, last lines on screen). Put what you
learn into `INSTALL_ANALYSIS` afterwards and re-render — it is appended under
the facts.

Capture and render are separate on purpose: the CLI runs once, and re-shooting
the video never re-scaffolds anything or asks anyone to sign in again.

If this framework's starter is not a Next app, change `readyPattern` on the
matrix pages in `pages.config.ts`: it is the text the dev server prints when it
is actually serving, and waiting for the wrong string means waiting the whole
timeout and then reporting that a healthy server never started.

## Step 6 — Prove it

```bash
npm run doctor:online
npm run record -- --<first-page-id>
```

Then **watch the video**. The doctor cannot tell you the cursor rested somewhere
useless or the IDE highlighted the wrong function. Check: the doc page scrolls
and the taskbar is visible; the IDE shows the code the page is about; the demo
gets a real answer.

Then record the rest.

---

## Things that will bite you

**A page that never answers now fails the run.** That is deliberate — it used to
report `[PASS]`. If a page fails this way, the demo is broken or
`assistantMessage` does not match; both are real findings.

**Pages that replace the message view.** A page that swaps in a custom message
component renders none of CopilotKit's classes, so detection finds nothing and
reports "agent never responded" on a page that works. Pass a per-page selector
instead of widening the global one:

```ts
await sendPrompt(page, prompt, { messageSelector: '.my-custom-bubble' });
await waitForAgentResponseCompletion(page, wait, msgCount, '.my-custom-bubble');
```

`actions/slots.action.ts` does exactly this for its level-3 tab.

**Controls underneath the taskbar overlay.** The simulated taskbar occupies the
bottom 48px and swallows clicks. A send button sitting there never receives the
click; the submit lands via the Enter fallback instead. Harmless, but do not
spend an afternoon on why a click "did nothing".

**Line ranges drift silently.** Nothing errors when a range points at the wrong
code — the video just shows the wrong thing. Re-run `npm run doctor` after
touching the frontend.

**Not every page can use the shared helper.** One page in the reference
(`headless-ui`) is deliberately left on its own implementation because routing it
through `sendPrompt` broke it. If a page misbehaves only after you "tidied" it,
put it back and leave a comment saying why.

---

## Reporting back

When you finish, state:

- which pages you added, removed, or renumbered, and why
- any doc page that 404s or is missing from the nav for this framework
- which selectors you had to change
- any page whose recording fails, and the doctor output for it
- which CLI prompts differed from the reference, and any that turned out to be
  conditional on this framework
- anything that made you want to edit `core/`

A port that silently drops pages to make the doctor pass is worse than one that
reports three failures honestly.
