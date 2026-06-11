# Android Global Terminal Switcher Design

## Summary

Android terminal detail should keep the existing single-arrow workspace switcher and add a double-arrow global project terminal switcher.

The existing `↑` and `↓` controls continue to cycle terminals created for the current host and remote path. The new `⇈` and `⇊` controls cycle across all project-owned terminal sessions, regardless of which repository or worktree opened them.

## Goals

- Add `⇈` and `⇊` controls to the Android terminal detail control row.
- Let users switch between all project terminal sessions from any Android terminal detail screen.
- Preserve existing `↑` and `↓` same-workspace switching behavior.
- Keep global switching ordered by terminal creation time with `id` as a stable tie-breaker.
- Keep navigation context consistent after switching across projects.

## Non-goals

- Do not change SSH, PTY, terminal emulator, reconnect, close, or foreground-service behavior.
- Do not change terminal session identity, persistence, display-name allocation, or creation semantics.
- Do not include temporary Host or Diagnostics terminals in the global project terminal cycle.
- Do not add a new terminal manager lifecycle API for this UI navigation behavior.
- Do not change the repository Terminal tab list, workspace selector, or delete confirmation flow.

## Current State

`TerminalScreen` already has same-workspace terminal switching:

- It observes `TerminalSessionManager.observeSessions`.
- It filters sessions by the current workspace host ids and active remote path.
- It orders matching sessions by creation time through `terminalWorkspaceCreatedSessions`.
- It switches locally by replacing `activeSessionId`.

That local switch is safe only inside the same workspace because `host`, `remotePath`, `repositoryId`, and return behavior still match the active terminal.

For global project switching, local `activeSessionId` replacement is not sufficient. Switching to a terminal from another repository must also update route context so title, reconnect, and back navigation match the target session.

## Selected Approach

Use route-level global switching.

`TerminalScreen` should render double-arrow controls and emit the selected target `TerminalSessionRecord` through a callback. `GoblinAndroidApp` should handle that callback by touching the target session and navigating with the existing route helper:

```kotlin
route = AppRoute.terminal(session)
```

This keeps `TerminalScreen` responsible for UI intent and keeps app-level navigation ownership in `GoblinAndroidApp`.

## Terminal Sets

### Workspace Terminals

Workspace terminals keep the current definition:

- Host id matches the active route's host identity set.
- Normalized remote path matches the active route's remote path.
- Sessions are ordered by `openedAt`, then `id`.

These sessions are controlled by `↑` and `↓`.

### Global Project Terminals

Global project terminals are all sessions where:

- `repositoryId != null`.

Sessions are ordered by:

1. `openedAt`
2. `id`

These sessions are controlled by `⇈` and `⇊`.

Temporary Host or Diagnostics terminals have `repositoryId == null`, so they are excluded from the global project cycle.

## UI Behavior

The bottom terminal control row should keep the current order and add the global pair beside the workspace pair:

```text
↑ ↓ ⇈ ⇊ Restore Reconnect Close
```

Visibility:

- Show `↑` and `↓` only when the current workspace has more than one terminal session.
- Show `⇈` and `⇊` only when there is more than one global project terminal session.

Actions:

- `↑`: previous terminal in current workspace.
- `↓`: next terminal in current workspace.
- `⇈`: previous terminal in global project session order.
- `⇊`: next terminal in global project session order.

The double arrows should not be disabled based on the active terminal's connection state. Disconnected, failed, and exited project terminal records remain selectable so the user can inspect final output or reconnect.

## Component Boundaries

### `TerminalInteractionState.kt`

Add pure helpers:

- `terminalGlobalProjectCreatedSessions(sessions)` filters project sessions and sorts by creation order.
- `terminalCycleSessionId(sessions, activeSessionId, direction)` returns the next session id for an ordered list.

The cycle helper should return `null` when fewer than two sessions are available.

When `activeSessionId` is not found in the ordered list, the helper should use index `0` as the deterministic anchor before applying direction. This gives stable behavior when a temporary terminal screen is used to jump into the project terminal cycle.

### `TerminalScreen.kt`

Add a callback parameter:

```kotlin
onSwitchGlobalTerminal: (TerminalSessionRecord) -> Unit
```

Inside the screen:

- Continue observing all terminal sessions from `TerminalSessionManager`.
- Derive global project sessions from the latest observed session list.
- Render `⇈` and `⇊` when the global project session count is greater than one.
- On click, compute the target id using the pure cycle helper.
- Resolve the id to the latest `TerminalSessionRecord`.
- Call `onSwitchGlobalTerminal(targetSession)` if it still exists.

The screen should not directly mutate route state and should not create a new terminal when switching globally.

### `GoblinAndroidApp.kt`

In the `AppRoute.Terminal` branch, pass:

```kotlin
onSwitchGlobalTerminal = { session ->
    terminalSessionManager.touchSession(session.id)
    route = AppRoute.terminal(session)
}
```

`AppRoute.terminal(session)` already carries:

- `hostId`
- `remotePath`
- `repositoryId`
- `terminalSessionId`

The existing `resolveHostForTerminalRoute` fallback remains important because session host ids can use a derived `RemoteTarget.id`.

## Data Flow

1. User taps `⇈` or `⇊`.
2. `TerminalScreen` computes global project sessions from the observed session snapshot.
3. `TerminalScreen` computes the target session id based on creation order.
4. `TerminalScreen` resolves the target record from the current snapshot.
5. `TerminalScreen` calls `onSwitchGlobalTerminal(targetSession)`.
6. `GoblinAndroidApp` touches the session and navigates with `AppRoute.terminal(targetSession)`.
7. The terminal route recreates `TerminalScreen` with the target session's host, path, repository id, and session id.

## Edge Cases

- Fewer than two global project sessions: hide `⇈` and `⇊`.
- Target session removed between render and click: no navigation occurs.
- Current active session is not a project terminal: global controls can still jump into the project terminal cycle when at least two project terminals exist.
- Target project record no longer exists: the terminal route can still resolve by host id and session path; existing repository route guards handle later back-navigation recovery.
- Inactive sessions remain in the cycle: exited, failed, and disconnected records are still useful for output inspection and reconnect.

## Testing

Add focused JVM tests around the new pure helpers:

- Global project filtering excludes `repositoryId == null`.
- Global project ordering uses `openedAt`, then `id`.
- Forward and backward cycling wrap around.
- Cycling returns `null` for empty and single-item lists.
- Missing active session uses deterministic fallback behavior.

Manual verification:

- Start two project terminals in different repositories or worktrees.
- Confirm `⇈` and `⇊` appear in terminal detail.
- Confirm tapping `⇈` and `⇊` switches across projects.
- Confirm title, reconnect behavior, and back navigation match the target terminal after switching.
- Confirm temporary Host/Diagnostics terminals do not appear in the global cycle.

## Implementation Scope

Expected source files:

- `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionState.kt`
- `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`
- `android/app/src/main/java/dev/goblin/android/GoblinAndroidApp.kt`
- `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionStateTest.kt`

No web, Electron, server, or shared TypeScript files are required.
