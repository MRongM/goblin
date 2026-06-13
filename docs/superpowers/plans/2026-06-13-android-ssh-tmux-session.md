# Android SSH Tmux Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Android built-in SSH terminals attach to a stable remote tmux session per workspace path, with native SSH shell fallback.

**Architecture:** Keep the feature at the SSH startup boundary. `SshTerminalService` still opens the SSHJ shell and schedules startup input; `SshTerminalStartupCommand` becomes target-aware and emits a tmux-first shell script. Session manager, UI, emulator, foreground service, and external Termux handoff stay unchanged.

**Tech Stack:** Kotlin, Android JVM unit tests, SSHJ shell sessions, POSIX shell startup script, tmux.

---

Project instruction override: this plan intentionally omits git commit and branch steps because `AGENTS.md` says not to plan or execute git commits/branches unless the user explicitly asks.

## File Structure

- Modify: `android/app/src/main/java/dev/goblin/android/terminals/SshTerminalService.kt`
  - Wire `SshTerminalService.openShell(...)` to a target-aware startup input helper.
  - Add stable tmux session-name generation and tmux-first shell script generation inside `SshTerminalStartupCommand`.
- Modify: `android/app/src/test/java/dev/goblin/android/terminals/SshTerminalStartupCommandTest.kt`
  - Replace path-only `cd && pwd` assertions with tmux-first startup command tests.
  - Keep startup input failure output coverage.
- Do not modify: `android/app/src/main/java/dev/goblin/android/termux/TermuxCommandBuilder.kt`
  - External Termux handoff remains out of scope.
- Do not modify: `TerminalSessionManager`, `TerminalController`, emulator, foreground service, or UI files.

## Task 1: Lock The Startup Contract With Tests

**Files:**
- Modify: `android/app/src/test/java/dev/goblin/android/terminals/SshTerminalStartupCommandTest.kt`
- Test: `android/app/src/test/java/dev/goblin/android/terminals/SshTerminalStartupCommandTest.kt`

- [x] **Step 1: Replace startup command tests with the tmux-first contract**

Replace the full contents of `android/app/src/test/java/dev/goblin/android/terminals/SshTerminalStartupCommandTest.kt` with:

```kotlin
package dev.goblin.android.terminals

import dev.goblin.android.domain.ssh.RemoteTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SshTerminalStartupCommandTest {
    @Test
    fun `workspace shell starts tmux first and falls back to native shell`() {
        val target = target(remotePath = "/srv/app")
        val command = SshTerminalStartupCommand.initialInputForTarget(target)
        val sessionName = SshTerminalStartupCommand.tmuxSessionName(target)

        assertTrue(command.contains("goblin_remote_path='/srv/app'"))
        assertTrue(command.contains("goblin_tmux_session='$sessionName'"))
        assertTrue(command.contains("command -v tmux >/dev/null 2>&1"))
        assertTrue(command.contains("tmux new-session -A -s \"\$goblin_tmux_session\""))
        assertTrue(command.contains("tmux unavailable (exit %s); falling back to shell"))
        assertTrue(command.contains("exec \"\${SHELL:-sh}\""))
        assertTrue(command.endsWith("\r"))
    }

    @Test
    fun `workspace shell quotes paths with spaces and single quotes`() {
        val command = SshTerminalStartupCommand.initialInputForTarget(
            target(remotePath = "/srv/app's worktree"),
        )

        assertTrue(command.contains("goblin_remote_path='/srv/app'\"'\"'s worktree'"))
        assertTrue(command.contains("cd \"\$goblin_remote_path\""))
        assertFalse(command.contains("goblin_remote_path=/srv/app's worktree"))
    }

    @Test
    fun `root path still starts tmux first`() {
        val command = SshTerminalStartupCommand.initialInputForTarget(target(remotePath = "/"))

        assertTrue(command.contains("goblin_remote_path='/'"))
        assertTrue(command.contains("command -v tmux >/dev/null 2>&1"))
        assertTrue(command.contains("tmux new-session -A -s \"\$goblin_tmux_session\""))
        assertTrue(command.contains("exec \"\${SHELL:-sh}\""))
    }

    @Test
    fun `tmux session name is stable and shell safe`() {
        val first = SshTerminalStartupCommand.tmuxSessionName(target(remotePath = "/srv/app"))
        val second = SshTerminalStartupCommand.tmuxSessionName(target(remotePath = "/srv/app"))

        assertEquals(first, second)
        assertTrue(first.matches(Regex("goblin-[A-Za-z0-9_-]{16}")))
        assertTrue(first.length <= 32)
    }

    @Test
    fun `tmux session name changes by remote path`() {
        val app = SshTerminalStartupCommand.tmuxSessionName(target(remotePath = "/srv/app"))
        val api = SshTerminalStartupCommand.tmuxSessionName(target(remotePath = "/srv/api"))

        assertNotEquals(app, api)
    }

    @Test
    fun `startup input failure output includes exception class when message is blank`() {
        val output = SshTerminalStartupCommand.startupInputFailureOutput(BlankMessageException())

        assertTrue(output.contains("Startup cd failed"))
        assertTrue(output.contains("BlankMessageException"))
    }

    private fun target(remotePath: String): RemoteTarget = RemoteTarget(
        id = "lee@example.com:22$remotePath",
        alias = "Dev",
        host = "example.com",
        user = "lee",
        port = 22,
        remotePath = remotePath,
        identityRefId = null,
    )

    private class BlankMessageException : RuntimeException()
}
```

- [x] **Step 2: Run the focused test and verify it fails for the right reason**

Run from `android/`:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.SshTerminalStartupCommandTest"
```

Observed result: FAIL. The failure mentioned unresolved references for `initialInputForTarget` and `tmuxSessionName`.

## Task 2: Implement The Tmux-First Startup Helper

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/terminals/SshTerminalService.kt`
- Test: `android/app/src/test/java/dev/goblin/android/terminals/SshTerminalStartupCommandTest.kt`

- [x] **Step 1: Add the hash import**

In `android/app/src/main/java/dev/goblin/android/terminals/SshTerminalService.kt`, add this import beside the existing Java imports:

```kotlin
import java.security.MessageDigest
```

- [x] **Step 2: Wire SSH startup input to the target-aware helper**

In `SshTerminalService.openShell(...)`, replace:

```kotlin
terminalSession.scheduleStartupInput(
    input = SshTerminalStartupCommand.initialInputForRemotePath(target.remotePath),
    onOutput = onOutput,
)
```

with:

```kotlin
terminalSession.scheduleStartupInput(
    input = SshTerminalStartupCommand.initialInputForTarget(target),
    onOutput = onOutput,
)
```

- [x] **Step 3: Replace `SshTerminalStartupCommand` with the tmux-aware implementation**

In the same file, replace the full `internal object SshTerminalStartupCommand` block with:

```kotlin
internal object SshTerminalStartupCommand {
    const val InputDelayMillis = 150L

    fun initialInputForTarget(target: RemoteTarget): String {
        val normalizedPath = normalizeRemotePath(target.remotePath)
        val sessionName = tmuxSessionName(target)
        return """
            goblin_remote_path=${shellQuote(normalizedPath)}
            goblin_tmux_session=${shellQuote(sessionName)}
            if cd "${'$'}goblin_remote_path"; then
              if command -v tmux >/dev/null 2>&1; then
                tmux new-session -A -s "${'$'}goblin_tmux_session"
                goblin_tmux_status=${'$'}?
                if [ "${'$'}goblin_tmux_status" -eq 0 ]; then
                  exit 0
                fi
                printf '\r\ntmux unavailable (exit %s); falling back to shell\r\n' "${'$'}goblin_tmux_status"
              fi
              exec "${'$'}{SHELL:-sh}"
            else
              exit 1
            fi
        """.trimIndent() + "\r"
    }

    fun tmuxSessionName(target: RemoteTarget): String {
        val normalizedPath = normalizeRemotePath(target.remotePath)
        val identity = "${target.authority}\u0000$normalizedPath"
        return "goblin-${sha256HexPrefix(identity)}"
    }

    fun startupInputFailureOutput(error: Throwable): String =
        "\r\nStartup cd failed: ${error.toTerminalDetail()}\r\n"

    private fun normalizeRemotePath(remotePath: String): String =
        remotePath.trim().ifEmpty { "/" }

    private fun sha256HexPrefix(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(StandardCharsets.UTF_8))
        return digest
            .take(8)
            .joinToString("") { byte ->
                val intValue = byte.toInt() and 0xff
                "${HexChars[intValue ushr 4]}${HexChars[intValue and 0x0f]}"
            }
    }

    private fun shellQuote(value: String): String = "'${value.replace("'", "'\"'\"'")}'"

    private fun Throwable.toTerminalDetail(): String {
        val message = message?.trim()?.takeIf { it.isNotBlank() }
        val className = this::class.java.simpleName.takeIf { it.isNotBlank() }
            ?: this::class.java.name
        return message ?: className
    }

    private val HexChars = "0123456789abcdef".toCharArray()
}
```

- [x] **Step 4: Run the focused test and verify it passes**

Run from `android/`:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.SshTerminalStartupCommandTest"
```

Observed result: PASS for `SshTerminalStartupCommandTest`.

## Task 3: Verify Scope Boundaries And Full Test Suite

**Files:**
- Verify: `android/app/src/main/java/dev/goblin/android/termux/TermuxCommandBuilder.kt`
- Verify: `android/app/src/main/java/dev/goblin/android/terminals/SshTerminalService.kt`
- Verify: `android/app/src/test/java/dev/goblin/android/terminals/SshTerminalStartupCommandTest.kt`

- [x] **Step 1: Confirm Termux handoff stayed unchanged**

Run:

```bash
git diff -- "android/app/src/main/java/dev/goblin/android/termux/TermuxCommandBuilder.kt"
```

Observed result: no diff output.

- [x] **Step 2: Confirm the implementation only changes Android built-in SSH startup**

Run:

```bash
git diff -- "android/app/src/main/java/dev/goblin/android/terminals/SshTerminalService.kt" "android/app/src/test/java/dev/goblin/android/terminals/SshTerminalStartupCommandTest.kt"
```

Observed result: diff only shows:

- `SshTerminalService.openShell(...)` calling `initialInputForTarget(target)`;
- `SshTerminalStartupCommand` adding tmux-first startup command generation;
- startup command unit tests updated for tmux.

- [x] **Step 3: Run Android JVM tests**

Run from `android/`:

```bash
./gradlew test
```

Observed result: PASS.

- [x] **Step 4: Run TypeScript typecheck**

Run:

```bash
bun run typecheck
```

Observed result: PASS.

- [x] **Step 5: Run repository test suite**

Run:

```bash
bun run test
```

Observed result: PASS.

## Self-Review Checklist

- Spec coverage:
  - tmux detection: Task 1 tests and Task 2 helper.
  - stable session per `user@host:port + remotePath`: Task 1 session-name tests and Task 2 hash helper.
  - reconnect continuity: covered by stable naming; no manager changes required.
  - multi-client same-output semantics: covered by tmux attach behavior; no Goblin broadcast layer added.
  - native shell fallback: Task 1 assertions and Task 2 shell script.
  - Termux handoff unchanged: Task 3 boundary check.
- Placeholder scan: no incomplete task language remains.
- Type consistency:
  - `initialInputForTarget(target: RemoteTarget): String` is defined before use.
  - `tmuxSessionName(target: RemoteTarget): String` is defined and tested.
  - `StandardCharsets.UTF_8` remains available from the existing import.
  - `MessageDigest` is added by Task 2.
