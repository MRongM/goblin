# Android Worktree Tmux Terminal ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Android project/worktree terminals use independent tmux sessions keyed by numeric terminal ids while temporary host terminals remain plain SSH shells.

**Architecture:** Add an explicit project terminal identity to `TerminalSessionRecord`, pass a small startup context through `TerminalSessionManager -> TerminalController -> TerminalSessionFactory`, and generate tmux names from resolved remote identity, repository path, worktree path, and numeric terminal id. Keep close/delete local-only; no remote tmux discovery or kill behavior is introduced.

**Tech Stack:** Kotlin, Android JVM unit tests, SSHJ shell sessions, POSIX shell startup script, tmux, Gradle.

---

Project instruction override: this plan intentionally omits git commit and branch steps because `AGENTS.md` says not to plan or execute git commits/branches unless the user explicitly asks.

## File Structure

- Create: `android/app/src/main/java/dev/goblin/android/terminals/TerminalStartupContext.kt`
  - Holds project-only tmux startup identity: repository path, worktree path, numeric terminal id.
- Modify: `android/app/src/main/java/dev/goblin/android/terminals/TerminalSessionModels.kt`
  - Adds persisted `terminalId` and `repositoryRemotePath` fields with focused validation.
- Modify: `android/app/src/main/java/dev/goblin/android/data/TerminalSessionStore.kt`
  - Extends terminal session codec while retaining legacy decode.
- Modify: `android/app/src/main/java/dev/goblin/android/terminals/SshTerminalService.kt`
  - Makes tmux startup conditional on `TerminalStartupContext`; temporary terminals use plain shell startup.
- Modify: `android/app/src/main/java/dev/goblin/android/terminals/TerminalController.kt`
  - Passes optional startup context into `TerminalSessionFactory`.
- Modify: `android/app/src/main/java/dev/goblin/android/terminals/TerminalSessionManager.kt`
  - Allocates smallest available numeric terminal id for project worktrees and preserves it on reconnect.
- Modify: `android/app/src/main/java/dev/goblin/android/GoblinAndroidApp.kt`
  - Passes repository root path into project terminal creation and terminal screen routes.
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`
  - Accepts repository root path and forwards it to create/reconnect calls.
- Modify tests:
  - `android/app/src/test/java/dev/goblin/android/terminals/SshTerminalStartupCommandTest.kt`
  - `android/app/src/test/java/dev/goblin/android/terminals/TerminalSessionManagerTest.kt`
  - `android/app/src/test/java/dev/goblin/android/data/TerminalSessionStoreTest.kt`
  - Fake `TerminalSessionFactory` implementations in terminal tests.

## Task 1: Add Terminal Identity Storage

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/terminals/TerminalSessionModels.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/data/TerminalSessionStore.kt`
- Test: `android/app/src/test/java/dev/goblin/android/data/TerminalSessionStoreTest.kt`

- [ ] **Step 1: Write failing codec tests for new identity fields**

Add these assertions to `terminal sessions round trip through serialized storage payload` in `android/app/src/test/java/dev/goblin/android/data/TerminalSessionStoreTest.kt`:

```kotlin
assertEquals(2, decoded.single().terminalId)
assertEquals("/srv/repo", decoded.single().repositoryRemotePath)
```

Update the `terminalRecord(...)` helper in the same test file:

```kotlin
private fun terminalRecord(
    id: String = "terminal-1",
    lastOutputSnapshot: String = "recent output",
    terminalId: Int? = 2,
    repositoryRemotePath: String? = "/srv/repo",
): TerminalSessionRecord = TerminalSessionRecord(
    id = id,
    hostId = "host-1",
    repositoryId = "repo-1",
    remotePath = "/srv/app",
    targetLabel = "App - /srv/app",
    status = TerminalSessionStatus.Disconnected,
    displayName = "terminal-${terminalId ?: 1}",
    terminalId = terminalId,
    repositoryRemotePath = repositoryRemotePath,
    lastOutputSnapshot = lastOutputSnapshot,
    lastActivityAt = 250L,
    openedAt = 100L,
    foregroundServiceOwned = true,
    disconnectedReason = TerminalDisconnectedReason.AndroidServiceStopped,
    disconnectedMessage = "service process stopped",
)
```

- [ ] **Step 2: Write failing validation tests**

Add this test to `TerminalSessionStoreTest`:

```kotlin
@Test
fun `temporary terminal session round trip keeps tmux identity empty`() {
    val record = terminalRecord(
        id = "temporary-1",
        terminalId = null,
        repositoryRemotePath = null,
    )

    val decoded = TerminalSessionCodec.decode(TerminalSessionCodec.encode(listOf(record))).single()

    assertEquals(null, decoded.terminalId)
    assertEquals(null, decoded.repositoryRemotePath)
}
```

- [ ] **Step 3: Run the focused codec test and verify it fails**

Run from `android/`:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.data.TerminalSessionStoreTest"
```

Expected: FAIL because `TerminalSessionRecord` has no `terminalId` or `repositoryRemotePath` properties.

- [ ] **Step 4: Add identity fields to the terminal record**

In `android/app/src/main/java/dev/goblin/android/terminals/TerminalSessionModels.kt`, update the `TerminalSessionRecord` constructor:

```kotlin
data class TerminalSessionRecord(
    val id: String,
    val hostId: String,
    val repositoryId: String?,
    val remotePath: String,
    val targetLabel: String,
    val displayName: String = "",
    val terminalId: Int? = null,
    val repositoryRemotePath: String? = null,
    val status: TerminalSessionStatus,
    val lastOutputSnapshot: String = "",
    val lastActivityAt: Long? = null,
    val openedAt: Long,
    val foregroundServiceOwned: Boolean = false,
    val disconnectedReason: TerminalDisconnectedReason? = null,
    val disconnectedMessage: String? = null,
)
```

Add these validations inside the existing `init` block:

```kotlin
require(terminalId == null || terminalId >= 1) {
    "Terminal id must be positive when present"
}
require(repositoryRemotePath == null || repositoryRemotePath.startsWith("/")) {
    "Terminal repository path must be absolute"
}
require(repositoryRemotePath == null || terminalId != null) {
    "Project terminal records require a terminal id"
}
```

- [ ] **Step 5: Extend the terminal session codec**

In `android/app/src/main/java/dev/goblin/android/data/TerminalSessionStore.kt`, replace the field count constants with:

```kotlin
private const val LegacyRecordFieldCount = 11
private const val DisplayNameRecordFieldCount = 12
private const val DisconnectMessageRecordFieldCount = 13
private const val TmuxIdentityRecordFieldCount = 15
```

In `encode(...)`, append the new fields after `disconnectedMessage`:

```kotlin
terminalDisconnectedMessageSnapshot(session.disconnectedMessage).orEmpty(),
session.terminalId?.toString().orEmpty(),
session.repositoryRemotePath.orEmpty(),
```

In `decodeSession(...)`, replace the field count guard and decoded flags with:

```kotlin
if (
    fields.size !in listOf(
        LegacyRecordFieldCount,
        DisplayNameRecordFieldCount,
        DisconnectMessageRecordFieldCount,
        TmuxIdentityRecordFieldCount,
    )
) return null
val hasDisplayName = fields.size >= DisplayNameRecordFieldCount
val hasDisconnectMessage = fields.size >= DisconnectMessageRecordFieldCount
val hasTmuxIdentity = fields.size == TmuxIdentityRecordFieldCount
```

Add these constructor arguments to the decoded `TerminalSessionRecord`:

```kotlin
terminalId = fields.getOrNull(13)
    ?.takeIf { hasTmuxIdentity && it.isNotBlank() }
    ?.toIntOrNull(),
repositoryRemotePath = fields.getOrNull(14)
    ?.takeIf { hasTmuxIdentity && it.isNotBlank() },
```

- [ ] **Step 6: Run the focused codec test and verify it passes**

Run from `android/`:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.data.TerminalSessionStoreTest"
```

Expected: PASS.

## Task 2: Make Tmux Startup Context Explicit

**Files:**
- Create: `android/app/src/main/java/dev/goblin/android/terminals/TerminalStartupContext.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/terminals/SshTerminalService.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/terminals/TerminalController.kt`
- Test: `android/app/src/test/java/dev/goblin/android/terminals/SshTerminalStartupCommandTest.kt`
- Test fakes in:
  - `android/app/src/test/java/dev/goblin/android/terminals/TerminalControllerTest.kt`
  - `android/app/src/test/java/dev/goblin/android/terminals/TerminalForegroundBridgeTest.kt`
  - `android/app/src/test/java/dev/goblin/android/terminals/TerminalSessionManagerTest.kt`
  - `android/app/src/test/java/dev/goblin/android/terminals/TerminalSessionStateTest.kt`

- [ ] **Step 1: Write failing tmux naming tests**

Replace the existing tmux name tests in `SshTerminalStartupCommandTest` with:

```kotlin
@Test
fun `tmux session name includes repository path worktree path and numeric terminal id`() {
    val target = target(remotePath = "/srv/repo-feature")
    val first = SshTerminalStartupCommand.tmuxSessionName(
        target = target,
        startupContext = startupContext(terminalId = 1),
    )
    val second = SshTerminalStartupCommand.tmuxSessionName(
        target = target,
        startupContext = startupContext(terminalId = 2),
    )

    assertTrue(first.matches(Regex("goblin-[0-9a-f]{24}")))
    assertTrue(second.matches(Regex("goblin-[0-9a-f]{24}")))
    assertNotEquals(first, second)
}

@Test
fun `tmux session name ignores ssh alias`() {
    val first = SshTerminalStartupCommand.tmuxSessionName(
        target = target(alias = "Dev", remotePath = "/srv/repo-feature"),
        startupContext = startupContext(terminalId = 1),
    )
    val second = SshTerminalStartupCommand.tmuxSessionName(
        target = target(alias = "Renamed", remotePath = "/srv/repo-feature"),
        startupContext = startupContext(terminalId = 1),
    )

    assertEquals(first, second)
}

@Test
fun `temporary terminal startup does not enable tmux`() {
    val command = SshTerminalStartupCommand.initialInputForTarget(
        target = target(remotePath = "/srv/repo"),
        startupContext = null,
    )

    assertEquals("cd '/srv/repo' && pwd\r", command)
    assertFalse(command.orEmpty().contains("tmux"))
}
```

Add or replace helpers in the same test file:

```kotlin
private fun startupContext(terminalId: Int): TerminalStartupContext =
    TerminalStartupContext(
        repositoryRemotePath = "/srv/repo",
        worktreeRemotePath = "/srv/repo-feature",
        terminalId = terminalId,
    )

private fun target(
    alias: String? = "Dev",
    remotePath: String,
): RemoteTarget = RemoteTarget(
    id = "lee@example.com:22$remotePath",
    alias = alias,
    host = "example.com",
    user = "lee",
    port = 22,
    remotePath = remotePath,
    identityRefId = null,
)
```

- [ ] **Step 2: Update the startup command test for project tmux scripts**

Update the main startup script test in `SshTerminalStartupCommandTest`:

```kotlin
@Test
fun `project workspace shell starts tmux first and falls back to native shell`() {
    val target = target(remotePath = "/srv/repo-feature")
    val context = startupContext(terminalId = 2)
    val command = SshTerminalStartupCommand.initialInputForTarget(target, context)
    val sessionName = SshTerminalStartupCommand.tmuxSessionName(target, context)

    assertTrue(command.contains("goblin_remote_path='/srv/repo-feature'"))
    assertTrue(command.contains("goblin_tmux_session='$sessionName'"))
    assertTrue(command.contains("command -v tmux >/dev/null 2>&1"))
    assertTrue(command.contains("tmux new-session -A -s \"\$goblin_tmux_session\""))
    assertTrue(command.contains("tmux unavailable (exit %s); falling back to shell"))
    assertTrue(command.contains("exec \"\${SHELL:-sh}\""))
    assertTrue(command.endsWith("\r"))
}
```

- [ ] **Step 3: Run the focused startup tests and verify they fail**

Run from `android/`:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.SshTerminalStartupCommandTest"
```

Expected: FAIL because `TerminalStartupContext` and the new startup helper signatures do not exist.

- [ ] **Step 4: Create the startup context type**

Create `android/app/src/main/java/dev/goblin/android/terminals/TerminalStartupContext.kt`:

```kotlin
package dev.goblin.android.terminals

data class TerminalStartupContext(
    val repositoryRemotePath: String,
    val worktreeRemotePath: String,
    val terminalId: Int,
) {
    init {
        require(repositoryRemotePath.startsWith("/")) { "Repository path must be absolute" }
        require(worktreeRemotePath.startsWith("/")) { "Worktree path must be absolute" }
        require(terminalId >= 1) { "Terminal id must be positive" }
    }
}
```

- [ ] **Step 5: Update terminal factory and controller signatures**

In `android/app/src/main/java/dev/goblin/android/terminals/TerminalController.kt`, update `TerminalController.open(...)`:

```kotlin
fun open(
    target: RemoteTarget,
    secrets: SshConnectionSecrets = SshConnectionSecrets(),
    startupContext: TerminalStartupContext? = null,
) {
```

Pass the context into `terminalService.openShell(...)`:

```kotlin
terminalService.openShell(
    target = target,
    secrets = secrets,
    startupContext = startupContext,
    cols = cols,
    rows = rows,
    onOutput = ::appendOutput,
    onExit = { closeFromRemote() },
    onFailure = { fail(it, TerminalDisconnectedReason.SshDisconnected) },
)
```

Update the `TerminalSessionFactory` interface:

```kotlin
interface TerminalSessionFactory {
    fun openShell(
        target: RemoteTarget,
        secrets: SshConnectionSecrets,
        startupContext: TerminalStartupContext?,
        cols: Int,
        rows: Int,
        onOutput: (ByteArray) -> Unit,
        onExit: () -> Unit,
        onFailure: (Throwable) -> Unit,
    ): TerminalSession
}
```

- [ ] **Step 6: Update SSH startup command generation**

In `android/app/src/main/java/dev/goblin/android/terminals/SshTerminalService.kt`, update `openShell(...)` to accept the new parameter and pass it to startup input:

```kotlin
override fun openShell(
    target: RemoteTarget,
    secrets: SshConnectionSecrets,
    startupContext: TerminalStartupContext?,
    cols: Int,
    rows: Int,
    onOutput: (ByteArray) -> Unit,
    onExit: () -> Unit,
    onFailure: (Throwable) -> Unit,
): TerminalSession {
```

```kotlin
terminalSession.scheduleStartupInput(
    input = SshTerminalStartupCommand.initialInputForTarget(target, startupContext),
    onOutput = onOutput,
)
```

Replace the public helper functions inside `SshTerminalStartupCommand` with:

```kotlin
fun initialInputForTarget(
    target: RemoteTarget,
    startupContext: TerminalStartupContext?,
): String? {
    val normalizedPath = normalizeRemotePath(target.remotePath)
    if (startupContext == null) {
        if (normalizedPath == "/") return null
        return "cd ${shellQuote(normalizedPath)} && pwd\r"
    }

    val sessionName = tmuxSessionName(target, startupContext)
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

fun tmuxSessionName(
    target: RemoteTarget,
    startupContext: TerminalStartupContext,
): String {
    val identity = listOf(
        target.authority,
        normalizeRemotePath(startupContext.repositoryRemotePath),
        normalizeRemotePath(startupContext.worktreeRemotePath),
        startupContext.terminalId.toString(),
    ).joinToString("\u0000")
    return "goblin-${sha256HexPrefix(identity, TmuxHashHexChars)}"
}
```

Update the hash helper to accept a prefix length:

```kotlin
private fun sha256HexPrefix(value: String, hexChars: Int): String {
    val digest = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
    return digest
        .take((hexChars + 1) / 2)
        .joinToString("") { byte ->
            val intValue = byte.toInt() and 0xff
            "${HexChars[intValue ushr 4]}${HexChars[intValue and 0x0f]}"
        }
        .take(hexChars)
}
```

Add the tmux hash constant:

```kotlin
private const val TmuxHashHexChars = 24
```

Replace the private path normalizer in `SshTerminalStartupCommand` with:

```kotlin
private fun normalizeRemotePath(remotePath: String): String {
    val trimmed = remotePath.trim()
    if (trimmed.isEmpty() || trimmed == "/") return "/"
    return trimmed.trimEnd('/')
}
```

- [ ] **Step 7: Update fake terminal factories**

For every test fake implementing `TerminalSessionFactory`, insert `startupContext: TerminalStartupContext?` between `secrets` and `cols`.

Example for `TerminalControllerTest`:

```kotlin
override fun openShell(
    target: RemoteTarget,
    secrets: SshConnectionSecrets,
    startupContext: TerminalStartupContext?,
    cols: Int,
    rows: Int,
    onOutput: (ByteArray) -> Unit,
    onExit: () -> Unit,
    onFailure: (Throwable) -> Unit,
): TerminalSession {
```

- [ ] **Step 8: Run focused startup and controller tests**

Run from `android/`:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.SshTerminalStartupCommandTest" --tests "dev.goblin.android.terminals.TerminalControllerTest"
```

Expected: PASS.

## Task 3: Allocate Numeric Terminal IDs In Session Manager

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/terminals/TerminalSessionManager.kt`
- Test: `android/app/src/test/java/dev/goblin/android/terminals/TerminalSessionManagerTest.kt`

- [ ] **Step 1: Extend the fake service to record startup contexts**

In `TerminalSessionManagerTest.FakeTerminalSessionFactory`, update `OpenedTerminal`:

```kotlin
private data class OpenedTerminal(
    val startupContext: TerminalStartupContext?,
    val onOutput: (ByteArray) -> Unit,
    val onExit: () -> Unit,
    val onFailure: (Throwable) -> Unit,
)
```

In `openShell(...)`, store the context:

```kotlin
opened += OpenedTerminal(
    startupContext = startupContext,
    onOutput = onOutput,
    onExit = onExit,
    onFailure = onFailure,
)
```

Add this helper:

```kotlin
fun startupContext(index: Int = opened.lastIndex): TerminalStartupContext? =
    opened[index].startupContext
```

- [ ] **Step 2: Write failing allocation tests**

Add these tests to `TerminalSessionManagerTest`:

```kotlin
@Test
fun `project terminals allocate smallest available numeric terminal id`() {
    val service = FakeTerminalSessionFactory()
    val manager = terminalSessionManager(service, ids = terminalIds())

    val first = manager.createNew(
        target = target(remotePath = "/srv/repo-feature"),
        repositoryId = "repo-1",
        repositoryRemotePath = "/srv/repo",
        targetLabel = "App - /srv/repo-feature",
    )
    val second = manager.createNew(
        target = target(remotePath = "/srv/repo-feature"),
        repositoryId = "repo-1",
        repositoryRemotePath = "/srv/repo",
        targetLabel = "App - /srv/repo-feature",
    )
    manager.removeSession(first.id)
    val reused = manager.createNew(
        target = target(remotePath = "/srv/repo-feature"),
        repositoryId = "repo-1",
        repositoryRemotePath = "/srv/repo",
        targetLabel = "App - /srv/repo-feature",
    )

    assertEquals(1, first.terminalId)
    assertEquals(2, second.terminalId)
    assertEquals(1, reused.terminalId)
    assertEquals("terminal-1", reused.displayName)
    assertEquals(1, service.startupContext(index = 2)?.terminalId)
}

@Test
fun `terminal ids are scoped by repository root and worktree path`() {
    val service = FakeTerminalSessionFactory()
    val manager = terminalSessionManager(service, ids = terminalIds())

    val app = manager.createNew(
        target = target(remotePath = "/srv/repo-feature"),
        repositoryId = "repo-1",
        repositoryRemotePath = "/srv/repo",
        targetLabel = "App - /srv/repo-feature",
    )
    val otherRepo = manager.createNew(
        target = target(remotePath = "/srv/repo-feature"),
        repositoryId = "repo-2",
        repositoryRemotePath = "/srv/other-repo",
        targetLabel = "Other - /srv/repo-feature",
    )
    val otherWorktree = manager.createNew(
        target = target(remotePath = "/srv/repo-other"),
        repositoryId = "repo-1",
        repositoryRemotePath = "/srv/repo",
        targetLabel = "App - /srv/repo-other",
    )

    assertEquals(1, app.terminalId)
    assertEquals(1, otherRepo.terminalId)
    assertEquals(1, otherWorktree.terminalId)
}

@Test
fun `temporary terminal does not pass tmux startup context`() {
    val service = FakeTerminalSessionFactory()
    val manager = terminalSessionManager(service, ids = terminalIds())

    val record = manager.createNew(target(remotePath = "/"), repositoryId = null, targetLabel = "Dev - /")

    assertEquals(null, record.terminalId)
    assertEquals(null, record.repositoryRemotePath)
    assertEquals(null, service.startupContext())
}
```

- [ ] **Step 3: Write failing reconnect preservation test**

Add this test to `TerminalSessionManagerTest`:

```kotlin
@Test
fun `reconnect preserves project terminal id and startup context`() {
    val service = FakeTerminalSessionFactory()
    val manager = terminalSessionManager(service, ids = terminalIds())
    val record = manager.createNew(
        target = target(remotePath = "/srv/repo-feature"),
        repositoryId = "repo-1",
        repositoryRemotePath = "/srv/repo",
        targetLabel = "App - /srv/repo-feature",
    )
    service.fail(IOException("connection lost"))

    val reconnected = manager.reconnect(
        sessionId = record.id,
        target = target(remotePath = "/srv/repo-feature"),
        repositoryId = "repo-1",
        repositoryRemotePath = "/srv/repo",
        targetLabel = "App - /srv/repo-feature",
    )

    assertEquals(record.id, reconnected?.id)
    assertEquals(1, reconnected?.terminalId)
    assertEquals("/srv/repo", reconnected?.repositoryRemotePath)
    assertEquals(1, service.startupContext(index = 1)?.terminalId)
    assertEquals("/srv/repo", service.startupContext(index = 1)?.repositoryRemotePath)
    assertEquals("/srv/repo-feature", service.startupContext(index = 1)?.worktreeRemotePath)
}
```

- [ ] **Step 4: Run focused manager tests and verify they fail**

Run from `android/`:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.TerminalSessionManagerTest"
```

Expected: FAIL because `createNew(...)` and `reconnect(...)` do not accept `repositoryRemotePath` and do not allocate `terminalId`.

- [ ] **Step 5: Add project context parameters to manager entry points**

In `TerminalSessionManager.kt`, update signatures:

```kotlin
fun createOrAttach(
    target: RemoteTarget,
    repositoryId: String?,
    targetLabel: String,
    repositoryRemotePath: String? = null,
    secrets: SshConnectionSecrets = SshConnectionSecrets(),
): TerminalSessionRecord {
```

```kotlin
fun createNew(
    target: RemoteTarget,
    repositoryId: String?,
    targetLabel: String,
    repositoryRemotePath: String? = null,
    secrets: SshConnectionSecrets = SshConnectionSecrets(),
): TerminalSessionRecord {
```

```kotlin
fun reconnect(
    sessionId: String,
    target: RemoteTarget,
    repositoryId: String?,
    targetLabel: String,
    repositoryRemotePath: String? = null,
    secrets: SshConnectionSecrets = SshConnectionSecrets(),
): TerminalSessionRecord? {
```

When `createOrAttach(...)` calls `createNew(...)`, pass `repositoryRemotePath = repositoryRemotePath`.

- [ ] **Step 6: Create terminal id allocation helpers**

Add these helpers inside `TerminalSessionManager`:

```kotlin
private fun normalizeRepositoryRemotePath(path: String?): String? =
    path?.trim()?.takeIf { it.isNotBlank() }?.trimEnd('/')?.ifEmpty { "/" }

private fun nextProjectTerminalId(
    target: RemoteTarget,
    repositoryRemotePath: String,
    worktreeRemotePath: String,
    excludeSessionId: String? = null,
): Int {
    val normalizedRepositoryPath = normalizeRepositoryRemotePath(repositoryRemotePath) ?: repositoryRemotePath
    val normalizedWorktreePath = terminalSessionRemotePath(worktreeRemotePath)
    val used = sessions.values
        .asSequence()
        .filter { excludeSessionId == null || it.id != excludeSessionId }
        .filter {
            it.hostId == target.id &&
                it.repositoryRemotePath == normalizedRepositoryPath &&
                terminalSessionRemotePath(it.remotePath) == normalizedWorktreePath
        }
        .mapNotNull { it.terminalId }
        .toSet()
    var candidate = 1
    while (candidate in used) candidate += 1
    return candidate
}

private fun projectStartupContext(record: TerminalSessionRecord): TerminalStartupContext? {
    val terminalId = record.terminalId ?: return null
    val repositoryPath = record.repositoryRemotePath ?: return null
    return TerminalStartupContext(
        repositoryRemotePath = repositoryPath,
        worktreeRemotePath = record.remotePath,
        terminalId = terminalId,
    )
}
```

- [ ] **Step 7: Allocate terminal id in createNew**

Inside `createNew(...)`, replace display name calculation with:

```kotlin
val normalizedRepositoryPath = normalizeRepositoryRemotePath(repositoryRemotePath)
val terminalId = synchronized(lock) {
    normalizedRepositoryPath?.let {
        nextProjectTerminalId(
            target = target,
            repositoryRemotePath = it,
            worktreeRemotePath = target.remotePath,
        )
    }
}
val displayName = terminalId?.let(::terminalSessionDisplayNameFromIndex)
    ?: synchronized(lock) {
        nextWorkspaceTerminalDisplayName(hostId = target.id, remotePath = target.remotePath)
    }
```

Add the new fields to `starting`:

```kotlin
displayName = displayName,
terminalId = terminalId,
repositoryRemotePath = normalizedRepositoryPath,
```

Pass startup context when opening:

```kotlin
controller.open(
    target = target,
    secrets = secrets,
    startupContext = projectStartupContext(starting),
)
```

- [ ] **Step 8: Preserve terminal id in reconnect**

Before building `starting` in `reconnect(...)`, add:

```kotlin
val normalizedRepositoryPath = normalizeRepositoryRemotePath(repositoryRemotePath)
    ?: existing.repositoryRemotePath
val resolvedTerminalId = existing.terminalId
    ?: terminalDisplayNameIndex(existing.displayName)
        ?.takeIf { normalizedRepositoryPath != null }
    ?: synchronized(lock) {
        normalizedRepositoryPath?.let {
            nextProjectTerminalId(
                target = target,
                repositoryRemotePath = it,
                worktreeRemotePath = target.remotePath,
                excludeSessionId = sessionId,
            )
        }
    }
val resolvedDisplayName = resolvedTerminalId?.let(::terminalSessionDisplayNameFromIndex)
    ?: existing.displayName
```

Add these fields to `starting.copy(...)`:

```kotlin
displayName = resolvedDisplayName,
terminalId = resolvedTerminalId,
repositoryRemotePath = normalizedRepositoryPath,
```

Pass startup context when reopening:

```kotlin
controller.open(
    target = target,
    secrets = secrets,
    startupContext = projectStartupContext(starting),
)
```

- [ ] **Step 9: Run focused manager tests and verify they pass**

Run from `android/`:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.TerminalSessionManagerTest"
```

Expected: PASS.

## Task 4: Wire Repository Path Through Android UI Routes

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/GoblinAndroidApp.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`
- Test: existing terminal and repository state tests

- [ ] **Step 1: Update repository terminal creation**

In `GoblinAndroidApp.kt`, update the repository screen `onCreateTerminalAtPath` callback:

```kotlin
val session = terminalSessionManager.createNew(
    target = RemoteTarget.fromHostProfile(host, remotePath),
    repositoryId = repository.id,
    repositoryRemotePath = repository.remotePath,
    targetLabel = terminalTargetLabel(repository.title, remotePath),
)
```

- [ ] **Step 2: Pass repository path into TerminalScreen**

In `GoblinAndroidApp.kt`, when rendering `TerminalScreen(...)`, add:

```kotlin
repositoryRemotePath = repository?.remotePath,
```

- [ ] **Step 3: Add TerminalScreen parameter**

In `TerminalScreen.kt`, add the parameter near `repositoryId`:

```kotlin
repositoryRemotePath: String? = null,
```

- [ ] **Step 4: Forward repository path from TerminalScreen create and reconnect paths**

In `connect()`, update `reconnect(...)`:

```kotlin
terminalSessionManager.reconnect(
    sessionId = sessionId,
    target = target,
    repositoryId = repositoryId,
    repositoryRemotePath = repositoryRemotePath,
    targetLabel = targetLabel,
)
```

Update `createOrAttach(...)` in `connect()`:

```kotlin
terminalSessionManager.createOrAttach(
    target = target,
    repositoryId = repositoryId,
    repositoryRemotePath = repositoryRemotePath,
    targetLabel = targetLabel,
)
```

Update the initial `LaunchedEffect(...)` create/attach call:

```kotlin
?: terminalSessionManager.createOrAttach(
    target = target,
    repositoryId = repositoryId,
    repositoryRemotePath = repositoryRemotePath,
    targetLabel = targetLabel,
)
```

Include `repositoryRemotePath` in the `LaunchedEffect` key:

```kotlin
LaunchedEffect(target, repositoryId, repositoryRemotePath, targetLabel, terminalSessionId) {
```

- [ ] **Step 5: Run focused UI-related JVM tests**

Run from `android/`:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.ui.screens.terminals.TerminalInteractionStateTest" --tests "dev.goblin.android.ui.screens.repositories.RepositorySetupStateTest"
```

Expected: PASS.

## Task 5: Update Labels And Legacy Normalization

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/terminals/TerminalSessionManager.kt`
- Test: `android/app/src/test/java/dev/goblin/android/terminals/TerminalSessionManagerTest.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionStateTest.kt`

- [ ] **Step 1: Add a test for loaded legacy display names**

Update `old sessions without display name get normalized when loading session store` or add a sibling test:

```kotlin
@Test
fun `legacy project sessions preserve parseable terminal ids during load normalization`() {
    val manager = terminalSessionManager(
        service = FakeTerminalSessionFactory(),
        ids = terminalIds(),
        store = RecordingTerminalSessionStore(
            initial = listOf(
                legacyTerminalRecord(
                    id = "session-a",
                    remotePath = "/srv/app",
                    openedAt = 1L,
                    displayName = "terminal-2",
                ),
                legacyTerminalRecord(
                    id = "session-b",
                    remotePath = "/srv/app",
                    openedAt = 2L,
                    displayName = "",
                ),
            ),
        ),
    )

    val byId = manager.sessions().associateBy { it.id }

    assertEquals(2, byId["session-a"]?.terminalId)
    assertEquals(1, byId["session-b"]?.terminalId)
    assertEquals("terminal-2", byId["session-a"]?.displayName)
    assertEquals("terminal-1", byId["session-b"]?.displayName)
}
```

Update `legacyTerminalRecord(...)` helper to accept `displayName`:

```kotlin
private fun legacyTerminalRecord(
    id: String,
    remotePath: String,
    openedAt: Long,
    displayName: String = "",
): TerminalSessionRecord = TerminalSessionRecord(
    id = id,
    hostId = "lee@example.com:22/",
    repositoryId = "repo-1",
    remotePath = remotePath,
    targetLabel = "App - $remotePath",
    displayName = displayName,
    status = TerminalSessionStatus.Disconnected,
    openedAt = openedAt,
)
```

- [ ] **Step 2: Update normalization to fill project terminal ids**

Replace `normalizeTerminalSessionDisplayNames(...)` with a broader identity normalizer:

```kotlin
private fun normalizeTerminalSessionDisplayNames(sessions: List<TerminalSessionRecord>): List<TerminalSessionRecord> {
    if (sessions.isEmpty()) return sessions

    val updatedById = sessions.associateBy { it.id }.toMutableMap()
    val sessionsByWorkspace = sessions.groupBy {
        Triple(it.hostId, it.repositoryRemotePath ?: it.repositoryId.orEmpty(), terminalSessionRemotePath(it.remotePath))
    }
    sessionsByWorkspace.values.forEach { workspaceSessions ->
        val orderedSessions = workspaceSessions
            .sortedWith(compareBy<TerminalSessionRecord> { it.openedAt }.thenBy { it.id })
        val usedIndices = orderedSessions
            .mapNotNull { it.terminalId ?: terminalDisplayNameIndex(it.displayName) }
            .toMutableSet()
        var nextIndex = 1

        orderedSessions.forEach { session ->
            val parsedIndex = session.terminalId ?: terminalDisplayNameIndex(session.displayName)
            val assignedIndex = parsedIndex ?: run {
                while (usedIndices.contains(nextIndex)) nextIndex += 1
                nextIndex.also {
                    usedIndices.add(it)
                    nextIndex += 1
                }
            }
            updatedById[session.id] = session.copy(
                terminalId = if (session.repositoryId != null) assignedIndex else session.terminalId,
                displayName = terminalSessionDisplayNameFromIndex(assignedIndex),
            )
        }
    }
    return sessions.map { updatedById[it.id] ?: it }
}
```

- [ ] **Step 3: Run focused normalization tests**

Run from `android/`:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.TerminalSessionManagerTest" --tests "dev.goblin.android.ui.screens.terminals.TerminalInteractionStateTest"
```

Expected: PASS.

## Task 6: Full Verification

**Files:**
- Verify Android and repository-wide checks.

- [ ] **Step 1: Run focused terminal tests**

Run from `android/`:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.*"
```

Expected: PASS.

- [ ] **Step 2: Run Android unit tests**

Run from `android/`:

```bash
./gradlew test
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript typecheck**

Run from the repository root:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run repository tests**

Run from the repository root:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 5: Check architecture boundaries**

Run from the repository root:

```bash
bun run check:architecture
```

Expected: PASS.

## Self-Review Notes

- Spec coverage: project-only tmux, numeric terminal ids, smallest available allocation, alias-free hash input, local-only close/delete, reconnect preservation, temporary terminal exclusion, and cross-client attach limits are covered.
- Scope control: no tmux discovery UI, no remote kill service, no Termux changes, no SSH auth changes.
- Type consistency: `TerminalStartupContext`, `terminalId: Int?`, `repositoryRemotePath: String?`, and manager `repositoryRemotePath` parameters are used consistently across tasks.
