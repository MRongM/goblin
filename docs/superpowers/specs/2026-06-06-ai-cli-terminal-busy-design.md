# AI CLI Terminal Busy Indicator Design

## Purpose

Terminal and worktree loading affordances should reflect active AI CLI work, not whether the embedded terminal PTY is open. Today the visible `running` signal is effectively terminal/session state, so a terminal that remains open can keep showing a spinner even when Codex or Claude is idle or waiting for user input.

## Scope

- Detect Codex and Claude activity from terminal output in the renderer.
- Add a small AI CLI execution state to terminal snapshots and summaries.
- Drive worktree and terminal-list spinner visibility from AI CLI busy state.
- Keep terminal lifecycle state separate from AI CLI execution state.

Out of scope:

- Structured integration with Codex or Claude APIs.
- Persisting AI CLI state across app restarts.
- Full transcript parsing, cost/token display, or task history.
- Detecting every possible AI CLI or arbitrary long-running shell command.

## State Model

Keep the existing terminal lifecycle state unchanged:

```ts
type TerminalPhase = 'opening' | 'open' | 'error'
```

Add an independent AI CLI state:

```ts
type AiCliProvider = 'codex' | 'claude'

type AiCliStatus =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

interface AiCliExecutionState {
  provider: AiCliProvider
  status: AiCliStatus
  updatedAt: number
}
```

Extend terminal data surfaces:

```ts
interface TerminalSnapshot {
  phase: TerminalPhase
  processName: string
  aiCli?: AiCliExecutionState | null
}

interface TerminalSessionSummary {
  phase: TerminalPhase
  aiCli?: AiCliExecutionState | null
  aiCliBusy: boolean
}
```

Derived busy rule:

```ts
const aiCliBusy =
  aiCli?.status === 'starting' ||
  aiCli?.status === 'running'
```

`waiting`, `succeeded`, `failed`, and `cancelled` are not busy. This avoids showing a spinner while the CLI is waiting for user confirmation or after the task has ended.

## Parsing

Add a focused renderer module:

```text
src/renderer/components/terminal/ai-cli-status.ts
```

Responsibilities:

- Strip ANSI escape sequences before matching.
- Identify provider from `processName` and conservative output markers.
- Only parse status when the provider is known.
- Preserve prior provider/status when new chunks are neutral.
- Return `null` when output does not look like Codex or Claude.

Initial provider detection:

- `processName` equal to or containing `codex` maps to Codex.
- `processName` equal to or containing `claude` maps to Claude.
- Output command echoes such as `codex ...` or `claude ...` can establish provider if process name remains the shell.

Initial status detection:

- Fresh provider output defaults to `running`.
- Waiting prompts, approval prompts, selection prompts, or explicit "waiting" language map to `waiting`.
- Failure/error language maps to `failed`.
- Cancel/interrupted language maps to `cancelled`.
- Completion language maps to `succeeded`.

Rules stay conservative. Unknown output should leave the current AI CLI state unchanged rather than inventing a state.

## Data Flow

1. Main process continues emitting terminal output events with `sessionId`, `data`, `seq`, and `processName`.
2. `ManagedTerminalSession.handleOutput()` updates `processName`, sends the chunk to the AI CLI detector, and stores the resulting state when it changes.
3. `ManagedTerminalSession.snapshot()` includes `aiCli`.
4. `TerminalSessionProvider.sessionSummaries()` includes `aiCli` and `aiCliBusy`.
5. Worktree and terminal-list UI uses `aiCliBusy` for spinner visibility instead of terminal `phase === 'open'` or generic running state.

## UI Behavior

- Terminal overlays remain based on `TerminalPhase`: opening and error behave as they do today.
- Terminal titles continue to use `processName` or existing fallback titles.
- Spinner visibility in terminal and worktree lists is driven by `aiCliBusy`.
- If no Codex or Claude activity is detected, no AI spinner is shown.
- If the CLI is waiting for input, no spinner is shown.

This keeps the UI honest: a live shell is not treated as active AI work.

## Reset Behavior

- Restarting a terminal clears `aiCli`.
- Opening a new PTY starts with `aiCli` unset.
- Terminal exit clears active busy state so stale spinners do not remain.
- A later Codex or Claude invocation in the same shell can establish a fresh AI CLI state from new output.

## Error Handling

AI CLI parsing is best-effort and must never block terminal output rendering. Parser failures should be contained inside the detector and treated as no state change.

If parser confidence is insufficient, prefer no spinner over a false spinner.

## Tests

Add focused tests for:

- Codex provider detection from process name.
- Claude provider detection from process name.
- Provider detection from command echo when process name is a shell.
- `running`, `waiting`, `failed`, `cancelled`, and `succeeded` status parsing.
- ANSI stripping before matching.
- `ManagedTerminalSession` snapshot updates `aiCli` from output.
- Restart and exit clear AI CLI busy state.
- Terminal switcher/worktree list spinners use `aiCliBusy`, not terminal open state.

## Design Checks

- KISS: uses a small derived busy flag instead of introducing a task system.
- YAGNI: supports only Codex and Claude because those are the confirmed first targets.
- DRY: parser logic lives in one module and UI consumes shared summary state.
- SOLID: terminal lifecycle remains separate from AI CLI execution state.
