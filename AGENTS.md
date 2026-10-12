# AGENTS.md - pi-gears

## Project Overview
Extension for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent). It maps model endpoints to numbered "gears" (thinking on/off, temperature, provider/model) and lets the user shift between them with `/gear` or `Alt+Shift+G`. User-facing docs are in `README.md`.

## Core Commands
* **Install deps**: `npm install`
* **Build**: N/A. Pi loads the `.ts` files directly; `tsx` runs scripts and tests.
* **Test all**: `npm test` (runs `tsx test/test-pi-gears.ts`)
* **Type check**: `npm run typecheck` (there is no `tsconfig.json`; `tsx` does not type-check)
* **CI**: .github/workflows/ci.yml runs npm ci, npm test and npm run typecheck
* **Lint**: none set up
* **Installer, preview only**: `npm run install:dry`
* **Installer, global**: `npm run install:global`, or `npm run install:symlink` so repo edits go live right away
* **Installer, per project**: `npx tsx install.ts --project <path> --symlink`
* **Installer help**: `npx tsx install.ts --help`

## Find Things
| Path | What lives there |
|------|------------------|
| `pi-gears.ts` | Extension entry point (default export `piGearsExtension`). Config loading, `/gear` command, shortcut, status line, Pi event hooks |
| `interceptors.ts` | Tool-call interceptors. The subagent interceptor passes the active gear's model and thinking setting to spawned subagents |
| `install.ts` | Installer CLI. Copies or symlinks the extension files and seeds `gears.json`. Never touches `models.json` |
| `gears.json.example` | Generic, committed example config. The real `gears.json` is gitignored |
| `test/test-pi-gears.ts` | The single test file. Plain `node:assert`, no framework |
| `test/setup-env.ts` | Points Pi's agent dir at the fixture. Import it first |
| `test/fixtures/agent/gears.json` | Gear config the tests run against. Tracked |
| `test-sandbox/` | Fake Pi agent dir (`models.json`) used by installer tests |
| `planning/` | Local-only planning files (execution plans, task files, state). Not tracked by git |
| `LICENSE` / `CITATION.cff` | MIT license text and citation metadata |
| `.github/workflows/ci.yml` | CI workflow: npm ci, npm test, npm run typecheck |

## Architecture
* **Model**: A single-package Pi extension. Three top-level TS modules, ESM (`"type": "module"`), with imports written as `./x.js`.
* **Pi hooks used by `pi-gears.ts`**: `registerCommand("gear")`, `registerShortcut(Alt+Shift+G)`, and the events `before_provider_request` (sets `temperature` and `chat_template_kwargs.enable_thinking`), `before_agent_start` (appends the gear's optional `instructions`), `tool_call` (runs interceptors), `session_start`, and `turn_start`.
* **Adding an interceptor**: implement `ToolInterceptor` in `interceptors.ts` and register it in `createDefaultInterceptors()`.

## Non-Obvious System Behaviors
* **Config lookup order, first match wins (no merging)**: `~/.pi/agent/gears.json` → `<cwd>/.pi/gears.json` → `./gears.json`. The first file with `gears` or `interceptors` stops the search. So a global config shadows the project one.
* **No built-in default gears.** If no `gears.json` is found, `loadGearsConfigFile()` throws. This is on purpose (see README).
* **The installer seeds `<target>/gears.json` from `gears.json.example` only when it is missing.** An existing user config is never overwritten.
* **`pi-gears.ts` loads `gears.json` as soon as it is imported.** Tests set `PI_CODING_AGENT_DIR` to `test/fixtures/agent/` in `test/setup-env.ts`, so `import "./setup-env.js"` must stay the first import in any test file.
* **`.gitignore` ignores only the root `/gears.json`.** Fixtures named `gears.json` elsewhere are tracked.
* **In development, run the installer only with `--dry-run` or with `--custom-target` pointing under `test-sandbox/`.** Its default target is `~/.pi/agent`, and a live run there changes the real Pi config. `--dry-run` is read-only (the legacy-file cleanup now runs on the live path only).
* **`test-sandbox/` must end clean.** Only `test-sandbox/models.json` is tracked. `setupSandbox()` wipes the dir at the *start* of each installer test, and section 5 ends with a `setupSandbox()` reset. A test that writes there and runs last leaves untracked files and dirties `git status`.
* **Per-gear `interceptors`** override the top-level `interceptors` block. They are not merged.
* **Thinking suffixes** on subagent model strings (`:high`, `:off`, and so on) count as explicit overrides when `preserveExplicitThinking` is true.

## System Boundaries
### Always
* Run `npm test` after changing any `.ts` file.
* Keep tests inside `test-sandbox/` or in memory.
* Keep `gears.json.example` generic: placeholder providers like `gpu`/`cpu` and models like `large-reasoning`/`medium-fast`.

### Ask First
* Running the installer without `--dry-run`. It writes to `~/.pi/agent/` or `<project>/.pi/`.
* Changing the shortcut key or the config search order.

### Never
* Change `~/.pi` from tests or during development.
* Commit a personal `gears.json` or hardcode real provider or host names (e.g. `r9700`) in shipped code or examples.

## References
* `README.md`: user setup flow, `gears.json` field reference, interceptor options
* Pi extension API: the types in `node_modules/@earendil-works/pi-coding-agent` (`ExtensionAPI`, `ExtensionContext`)
