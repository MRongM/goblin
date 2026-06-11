# Android Global Terminal Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Android terminal `⇈` and `⇊` controls that switch across all project-owned terminal sessions while preserving existing `↑` and `↓` same-workspace switching.

**Architecture:** Keep terminal lifecycle and persistence unchanged. Add pure session filtering/cycling helpers in terminal UI state, let `TerminalScreen` emit a global-switch navigation intent, and let `GoblinAndroidApp` update route context with the existing `AppRoute.terminal(session)` helper.

**Tech Stack:** Kotlin, Jetpack Compose, Android Gradle plugin, JUnit 4.

**Repository Rule:** Do not create branches or commits unless the user explicitly asks.

---

## File Structure

- Modify `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionState.kt`
  - Owns pure UI/session ordering helpers.
  - Add global project session filtering and generic session cycling helpers.
- Modify `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionStateTest.kt`
  - Owns focused JVM tests for terminal UI state helpers.
- Modify `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`
  - Owns terminal detail controls.
  - Add `⇈` and `⇊` controls and call a navigation callback with the selected session record.
- Modify `android/app/src/main/java/dev/goblin/android/GoblinAndroidApp.kt`
  - Owns app route state.
  - Handle global terminal switch by touching the target session and navigating with `AppRoute.terminal(session)`.

## Task 1: Add Failing Helper Tests

**Files:**
- Modify: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionStateTest.kt`

- [ ] **Step 1: Add tests for global project filtering and cycling**

Insert these tests before the existing `terminal target label includes repository and worktree path` test:

```kotlin
    @Test
    fun `global project sessions exclude temporary terminals and sort by creation`() {
        val sessions = listOf(
            terminalRecord(id = "session-b", repositoryId = "repo-b", remotePath = "/srv/b", openedAt = 200L),
            terminalRecord(id = "temporary", repositoryId = null, remotePath = "/", openedAt = 50L),
            terminalRecord(id = "session-c", repositoryId = "repo-c", remotePath = "/srv/c", openedAt = 100L),
            terminalRecord(id = "session-a", repositoryId = "repo-a", remotePath = "/srv/a", openedAt = 100L),
        )

        assertEquals(
            listOf("session-a", "session-c", "session-b"),
            terminalGlobalProjectCreatedSessions(sessions).map { it.id },
        )
    }

    @Test
    fun `terminal cycle session id wraps forward and backward`() {
        val sessions = listOf(
            terminalRecord(id = "session-a", repositoryId = "repo-a", remotePath = "/srv/a", openedAt = 100L),
            terminalRecord(id = "session-b", repositoryId = "repo-b", remotePath = "/srv/b", openedAt = 200L),
            terminalRecord(id = "session-c", repositoryId = "repo-c", remotePath = "/srv/c", openedAt = 300L),
        )

        assertEquals("session-b", terminalCycleSessionId(sessions, activeSessionId = "session-a", direction = 1))
        assertEquals("session-a", terminalCycleSessionId(sessions, activeSessionId = "session-c", direction = 1))
        assertEquals("session-c", terminalCycleSessionId(sessions, activeSessionId = "session-a", direction = -1))
    }

    @Test
    fun `terminal cycle session id returns null without switch targets`() {
        val session = terminalRecord(id = "session-a", repositoryId = "repo-a", remotePath = "/srv/a", openedAt = 100L)

        assertNull(terminalCycleSessionId(emptyList(), activeSessionId = null, direction = 1))
        assertNull(terminalCycleSessionId(listOf(session), activeSessionId = "session-a", direction = 1))
    }

    @Test
    fun `terminal cycle session id uses first item when active session is missing`() {
        val sessions = listOf(
            terminalRecord(id = "session-a", repositoryId = "repo-a", remotePath = "/srv/a", openedAt = 100L),
            terminalRecord(id = "session-b", repositoryId = "repo-b", remotePath = "/srv/b", openedAt = 200L),
            terminalRecord(id = "session-c", repositoryId = "repo-c", remotePath = "/srv/c", openedAt = 300L),
        )

        assertEquals("session-b", terminalCycleSessionId(sessions, activeSessionId = "temporary", direction = 1))
        assertEquals("session-c", terminalCycleSessionId(sessions, activeSessionId = "temporary", direction = -1))
    }
```

- [ ] **Step 2: Run the targeted test and confirm it fails for the right reason**

Run:

```bash
cd "android" && ./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.TerminalInteractionStateTest"
```

Expected: `BUILD FAILED` with unresolved references for `terminalGlobalProjectCreatedSessions` and `terminalCycleSessionId`.

## Task 2: Implement Pure Global Switching Helpers

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionState.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionStateTest.kt`

- [ ] **Step 1: Add helper functions**

In `TerminalInteractionState.kt`, add this block after the existing `terminalWorkspaceCreatedSessions(...)` overloads:

```kotlin
internal fun terminalGlobalProjectCreatedSessions(
    sessions: List<TerminalSessionRecord>,
): List<TerminalSessionRecord> {
    return sessions
        .filter { it.repositoryId != null }
        .sortedWith(terminalWorkspaceCreatedSessionComparator)
}

internal fun terminalCycleSessionId(
    sessions: List<TerminalSessionRecord>,
    activeSessionId: String?,
    direction: Int,
): String? {
    if (sessions.size <= 1) return null
    val currentIndex = sessions.indexOfFirst { it.id == activeSessionId }.takeIf { it >= 0 } ?: 0
    val nextIndex = (currentIndex + direction).mod(sessions.size)
    return sessions[nextIndex].id
}
```

- [ ] **Step 2: Run the targeted test and confirm it passes**

Run:

```bash
cd "android" && ./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.TerminalInteractionStateTest"
```

Expected: `BUILD SUCCESSFUL`.

## Task 3: Add Global Switch Controls To TerminalScreen

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`

- [ ] **Step 1: Import the session record type**

Add this import near the other terminal imports:

```kotlin
import dev.goblin.android.terminals.TerminalSessionRecord
```

- [ ] **Step 2: Add the global switch callback parameter**

Update the `TerminalScreen` signature so the callback sits before `onBack`:

```kotlin
    onFitToScreenChange: (Boolean) -> Unit,
    onSwitchGlobalTerminal: (TerminalSessionRecord) -> Unit,
    onBack: (String?) -> Unit,
```

- [ ] **Step 3: Add a global cycle action**

Add this function after the existing `cycleWorkspaceTerminal(direction: Int)` function:

```kotlin
    fun cycleGlobalProjectTerminal(direction: Int) {
        val availableSessions = terminalGlobalProjectCreatedSessions(terminalSessions)
        val targetSessionId = terminalCycleSessionId(
            sessions = availableSessions,
            activeSessionId = activeSessionId,
            direction = direction,
        ) ?: return
        val targetSession = availableSessions.firstOrNull { it.id == targetSessionId } ?: return
        onSwitchGlobalTerminal(targetSession)
    }
```

- [ ] **Step 4: Derive global switch visibility**

After the existing `workspaceSessions` and `hasWorkspaceSwitchTargets` values, add:

```kotlin
    val globalProjectSessions = terminalGlobalProjectCreatedSessions(terminalSessions)
    val hasGlobalSwitchTargets = globalProjectSessions.size > 1
```

The surrounding block should read:

```kotlin
    val workspaceSessions = terminalWorkspaceCreatedSessions(
        sessions = terminalSessions,
        hostIds = workspaceHostIds,
        remotePath = activeTerminalPath,
    )
    val hasWorkspaceSwitchTargets = workspaceSessions.size > 1
    val globalProjectSessions = terminalGlobalProjectCreatedSessions(terminalSessions)
    val hasGlobalSwitchTargets = globalProjectSessions.size > 1
```

- [ ] **Step 5: Render the double-arrow buttons**

In the bottom control `Row`, place this block immediately after the existing workspace `↑` and `↓` block:

```kotlin
                    if (hasGlobalSwitchTargets) {
                        TerminalTextButton(text = "⇈", onClick = { cycleGlobalProjectTerminal(-1) })
                        TerminalTextButton(text = "⇊", onClick = { cycleGlobalProjectTerminal(1) })
                    }
```

The intended order is:

```text
↑ ↓ ⇈ ⇊ Restore Reconnect Close
```

- [ ] **Step 6: Compile Android Kotlin**

Run:

```bash
cd "android" && ./gradlew ":app:compileDebugKotlin"
```

Expected: `BUILD SUCCESSFUL`.

## Task 4: Wire Route-Level Navigation In GoblinAndroidApp

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/GoblinAndroidApp.kt`

- [ ] **Step 1: Pass the global switch callback into TerminalScreen**

In the `AppRoute.Terminal` branch, inside the `TerminalScreen(...)` call, add this argument after `onFitToScreenChange`:

```kotlin
                    onSwitchGlobalTerminal = { session ->
                        terminalSessionManager.touchSession(session.id)
                        route = AppRoute.terminal(session)
                    },
```

The nearby call should include:

```kotlin
                    fitToScreen = terminalFitToScreen,
                    onFitToScreenChange = { fitToScreen ->
                        terminalFitToScreen = fitToScreen
                        terminalSettingsStore.setTerminalFitToScreen(fitToScreen)
                    },
                    onSwitchGlobalTerminal = { session ->
                        terminalSessionManager.touchSession(session.id)
                        route = AppRoute.terminal(session)
                    },
                    backHint = if (isHostTemporaryTerminal(currentRoute.remotePath, currentRoute.repositoryId)) {
```

- [ ] **Step 2: Compile Android Kotlin**

Run:

```bash
cd "android" && ./gradlew ":app:compileDebugKotlin"
```

Expected: `BUILD SUCCESSFUL`.

## Task 5: Final Verification

**Files:**
- Verify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionState.kt`
- Verify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`
- Verify: `android/app/src/main/java/dev/goblin/android/GoblinAndroidApp.kt`
- Verify: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionStateTest.kt`

- [ ] **Step 1: Run targeted terminal state tests**

Run:

```bash
cd "android" && ./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.TerminalInteractionStateTest"
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 2: Run Android unit tests**

Run:

```bash
cd "android" && ./gradlew ":app:testDebugUnitTest"
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Run repository TypeScript typecheck**

Run:

```bash
bun run typecheck
```

Expected: exits with status `0`.

- [ ] **Step 4: Run repository tests**

Run:

```bash
bun run test
```

Expected: exits with status `0`.

- [ ] **Step 5: Manual Android smoke test**

Use an emulator or device with at least two project terminal sessions:

1. Open project terminal A.
2. Open project terminal B from a different repository or worktree.
3. Confirm `⇈` and `⇊` appear next to `↑` and `↓`.
4. Tap `⇊` and confirm the terminal changes to the next project terminal.
5. Confirm the screen title, Reconnect action, and Back destination match the target terminal's repository/path.
6. Open a temporary Host/Diagnostics terminal and confirm it is not included in the `⇈` / `⇊` project terminal cycle.

Expected: global switching changes route context, not only visible terminal output.
