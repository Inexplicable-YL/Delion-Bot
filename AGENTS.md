- **This file is maintained by humans. Agents may modify it only with the user's explicit authorization.**

# Working core rules

**"Do not assume by default. Do not hide confusion. Present tradeoffs."**
**"Everyone's thinking is limited by what they know; remind the user of their unknown unknowns."**
**"Read @README.md first."**

## 1. Think before you code

Before implementing:

- State assumptions explicitly; if you are unsure or do not understand, ask. Do not make decisions on the user's behalf.
- When multiple interpretations exist, list them one by one instead of silently choosing one.
- If a simpler solution exists, state it directly and raise an objection when necessary.

## 2. Simplicity first

**"Solve the problem with the least code. Do not write speculative code."**

- Do not implement features beyond the requirements.
- Do not abstract code that is used only once.
- Do not add unrequested "flexibility" or "configurability".
- **Do not handle error scenarios that cannot occur within the current system boundary.**

## 3. Precise changes

**"Change only what must be changed. Clean up only the legacy you created."**

When editing existing code:

- Do not "improve" adjacent code, comments, or formatting.
- Do not refactor code that has no problem.
- **Stay consistent with the existing style.**
- If you find unrelated dead code, raise it instead of deleting it.
- Keep the logic in one function unless it is composable or reusable.
- Read the commit history of the code block to understand the direction of feature improvement.
- Validate once at the boundary where an unknown value enters. Pass typed values inward instead of repeating `typeof value === "object"` and property-existence checks. Do not defensively re-validate values already guaranteed by a schema, a constructor, or internal types.

When your change leaves code orphaned:

- Remove imports, variables, and functions that your change made unused.
- Do not remove pre-existing dead code unless explicitly asked.

Test criterion: "Every changed line must be traceable to the user's request."

Do not pre-extract a helper function that is used only once. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear standalone name that improves the caller.

## 4. Code commits and documentation

**Code strictly follows the self-explanatory principle: express intent through naming, not comments.**

- Code must remain highly readable without comments.
- Do not write comments in TypeScript or JavaScript. The only exception is the `@vitest-environment` directive that sets a test's runtime.
- Never use a comment to paper over code that may misbehave on an edge case, and never disable a rule inline; fix the code or state the tradeoff instead.
- Documentation is responsible only for stating the top-level ideas of the software design, not the specific implementation details. Keep documentation concise at all times and minimize how often it must be updated.
- Commit messages always follow commit conventions and mainstream community norms; do not add useless work-planning information such as "round one" or "batch".
  - Information that is not worth putting in documentation but should not go into comments can go directly into the commit log.
- The code in each commit must serve the same theme, purpose, or task; do not commit several loosely related changes together.
- If the workspace contains code you did not touch, do not modify or commit the other party's changes unless the user asks.
- Format the changed files before every commit.
- Update CHANGELOG only for a PR or a published branch; not every commit should go into the CHANGELOG.

## 5. Code testing

**Before adding complexity for a speculative or highly unlikely race or security edge case, explain the specific failure mode, its likelihood, and the complexity cost to the user, and obtain their consent. Do not silently expand scope for theoretical robustness.**

Tests are volatile code; keep only a small number of high-signal tests.

- Run the tests locally and confirm they pass before submitting a PR.
- After changing code, always check whether the related tests need updating, and delete outdated tests.
- Cover only the current behavioral contract and key regression scenarios; parts that have been verified and run stably do not need tests.
- Do not assert implementation details such as className, pixels, animations, or copy text.
- Do not write tombstone tests (asserting that "a deleted feature continues not to exist"); write negative tests only when the absence or failure itself is part of an API, security, or persistence contract.
- TypeScript tests live under `test/` at the repository root, organized by the relative path of `src/`. For example, tests for `src/modules/todo/main/` live in `test/modules/todo/main/`. Go `*_test.go` files stay in the corresponding package directory under `helper/`.

## 6. React

**Effects are forbidden. Do not import, call, alias, wrap, or destructure `useEffect`, `useLayoutEffect`, or `useInsertionEffect`, and do not implement `getDerivedStateFromProps`. `eslint.config.ts` enforces this.**

Use these instead:

- Subscribe to external stores with `useSyncExternalStore`, with a stable `subscribe` and a cached `getSnapshot`.
- Acquire imperative resources in ref callbacks and return their cleanup; re-key the component when the resource identity changes.
- `useEffectEvent` is allowed: it creates a stable event callback and does not run an Effect.
- Compute derived values directly during rendering; use `key` when state needs to be reset; write side effects caused by events in event handlers
- Read backend data with TanStack Query; put backend-pushed data into the store of the corresponding domain; perform navigation with actions
- Do not hand-write `useMemo` or `useCallback` (React Compiler is responsible for them); use `useRef` only for DOM nodes and imperative instances
- Do not use module-level mutable singletons, request counters, `let active` guards, latest-value refs, or `setTimeout` to wait for a render

Existing violations are capped in `eslint-suppressions.json`; a file's cap may only shrink. Never raise a cap, and remove the entry once its code is migrated.

## 7. UI and Design System

- Follow @DESIGN.md strictly; when requirements conflict, @DESIGN.md takes precedence.
- Prefer components and design tokens from `ui` for the UI; do not write arbitrary values and do not use Tailwind's built-in color palette.
- The semantic names and hierarchy of tokens are frozen (ADR 0018): they may only be added, never modified or deleted; values may be adjusted.
- When the same UI structure appears more than twice, extract it into a component; compose basic components first, and extract only recurring complex compositions into higher-level components.

## 8. Other

- Do not write .mjs files; always convert them to .ts.
- Prefer mature community dependencies and do not reinvent the wheel; check maintenance status, license, and size before introducing a new dependency.

# Delion Bot architecture

Delion Bot is a local-first personal agent. The first release uses its own data directory, imports no legacy data, and keeps no compatibility layer for the previous version. See `docs/adr/` for design decisions.

Feature modules live in `src/modules/`. Export the module definition and cross-module interfaces through `index.ts`, declare IPC contracts in `contract.ts` where needed, and put implementations in `main/`, `view/`, or `data/`. Register main-process modules in `src/app/modules.ts`.

Dependency rules (checked by CI):

1. `core` depends only on Pi and Node; `core/protocol` depends only on zod.
2. `ui` depends only on react, radix, cva, and lucide.
3. Modules reference each other only through the other module's `index.ts`; `view/` may reference only `core/protocol`, not other parts of core, and not `main/`.
4. Modules may reference only `app/module.ts`, not other parts of app.

When you receive a requirement, first decide where the change belongs:

| What you need to do                      | Where to change                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| Change a feature's UI                    | The corresponding module's `view/`                                              |
| Change a feature's service wiring        | The corresponding module's `main/`                                              |
| Add domain capabilities for the Agent    | The corresponding module's commands and Skills                                  |
| Read another module's data               | Call the interface exported by that module's `index.ts`                         |
| Add a general-purpose tool for the Agent | `core/capabilities`                                                             |
| Change the Agent protocol                | `core/protocol`; **confirm the versioning strategy with the user first**        |
| Introduce a new cross-module concept     | `core` or `app/module.ts`; **write an ADR and obtain the user's consent first** |

# File directory

Before making changes, locate the relevant module and read its contract and implementation.

```text
delion-bot/
├─ src/
│  ├─ core/                   Agent kernel; depends only on Pi and Node
│  │  ├─ protocol/            Agent protocol, module contract utilities, and desktop-private view types (depends only on zod)
│  │  ├─ agent/               Pi integration, sessions, sidechats, subagents, and background tasks
│  │  ├─ capabilities/        Tools, Skills, MCP, web access, and the registry
│  │  ├─ remote/              Remote execution backend and helper channel
│  │  └─ ports.ts             Host ports (HostPorts)
│  ├─ ui/                     Design System (forked from beautiful-ui), zero business dependencies
│  ├─ modules/                General modules (chat, mail, note, notifications, onboarding, preview,
│  │                          remotes, search, settings, terminal, todo, update, workspace)
│  └─ app/                    Host and shell
│     ├─ module.ts            Module and view definitions; the only app file modules may reference
│     ├─ modules.ts           Main-process module list
│     ├─ contracts.ts         IPC contract list
│     ├─ views.ts             Renderer view list
│     ├─ main/                Electron entry, database, IPC registration, and host port implementations
│     ├─ preload/             contextBridge and bridges allowlisted by contract
│     └─ renderer/            Shell UI: shell, workbench, navigation, workspace, settings, styles
├─ test/                      TypeScript tests, grouped by app, core, modules, and ui
├─ helper/                    Go remote helper and in-package tests
├─ scripts/                   Development, smoke, packaging, and validation scripts
├─ docs/                      Development docs, terms of use, and interface references
├─ vendor/                    Vendored helper, search tools, and OpenSSH
├─ assets/                    Icons and brand assets
└─ build/                     Build resources such as packaging icons
```

Update this directory tree promptly when large code changes occur.
