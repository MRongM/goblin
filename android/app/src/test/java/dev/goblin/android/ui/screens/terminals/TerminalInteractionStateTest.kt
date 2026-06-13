package dev.goblin.android.ui.screens.terminals

import android.view.KeyEvent
import dev.goblin.android.terminals.TerminalSessionRecord
import dev.goblin.android.terminals.TerminalSessionState
import dev.goblin.android.terminals.TerminalSessionStatus
import dev.goblin.android.terminals.TerminalDisconnectedReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalInteractionStateTest {
    @Test
    fun `input is unavailable until terminal is connected`() {
        assertFalse(terminalInputAvailable(TerminalSessionState.Idle))
        assertFalse(terminalInputAvailable(TerminalSessionState.Connecting))
        assertFalse(
            terminalInputAvailable(
                TerminalSessionState.Disconnected(
                    sessionId = "session-1",
                    reason = TerminalDisconnectedReason.AndroidServiceStopped,
                ),
            ),
        )
        assertTrue(terminalInputAvailable(TerminalSessionState.Connected("session-1", "", 80, 24)))
    }

    @Test
    fun `reconnect is available only after terminal is inactive`() {
        assertTrue(terminalReconnectAvailable(TerminalSessionState.Idle))
        assertTrue(terminalReconnectAvailable(TerminalSessionState.Exited("session-1")))
        assertTrue(terminalReconnectAvailable(TerminalSessionState.Failed("lost")))
        assertFalse(terminalReconnectAvailable(TerminalSessionState.Connecting))
        assertFalse(terminalReconnectAvailable(TerminalSessionState.Connected("session-1", "", 80, 24)))
    }

    @Test
    fun `terminal detail inline actions keep close visible and enable reconnect only when available`() {
        assertEquals(
            TerminalDetailInlineActions(reconnectEnabled = true, closeEnabled = true),
            terminalDetailInlineActions(TerminalSessionState.Exited("session-1")),
        )
        assertEquals(
            TerminalDetailInlineActions(reconnectEnabled = false, closeEnabled = true),
            terminalDetailInlineActions(TerminalSessionState.Connected("session-1", "", 80, 24)),
        )
    }

    @Test
    fun `terminal close confirmation explains that the session will stop`() {
        val text = terminalCloseConfirmationText("App - /srv/app")

        assertTrue(text.contains("App - /srv/app"))
        assertTrue(text.contains("stop"))
        assertTrue(text.contains("return"))
    }

    @Test
    fun `unavailable input state explains why send is disabled`() {
        assertEquals("Connecting to terminal...", terminalInputUnavailableMessage(TerminalSessionState.Connecting))
        assertEquals(
            "Terminal disconnected. Reconnect or return to diagnostics.",
            terminalInputUnavailableMessage(TerminalSessionState.Exited("session-1")),
        )
        assertEquals(
            "Terminal disconnected: Android service stopped. Reconnect or return to diagnostics.",
            terminalInputUnavailableMessage(
                TerminalSessionState.Disconnected(
                    sessionId = "session-1",
                    reason = TerminalDisconnectedReason.AndroidServiceStopped,
                ),
            ),
        )
        assertEquals(
            "Terminal disconnected: SSH disconnected - connection lost. Reconnect or return to diagnostics.",
            terminalInputUnavailableMessage(
                TerminalSessionState.Disconnected(
                    sessionId = "session-1",
                    reason = TerminalDisconnectedReason.SshDisconnected,
                    message = "connection lost",
                ),
            ),
        )
        assertNull(terminalInputUnavailableMessage(TerminalSessionState.Connected("session-1", "", 80, 24)))
    }

    @Test
    fun `viewport keeps output while banner carries disconnect reason`() {
        val disconnected = TerminalSessionState.Disconnected(
            sessionId = "session-1",
            reason = TerminalDisconnectedReason.AndroidServiceStopped,
            output = "last output",
        )

        assertEquals("last output", terminalViewportText(disconnected))
        assertEquals(
            "Terminal disconnected: Android service stopped. Reconnect or return to diagnostics.",
            terminalSessionBannerMessage(disconnected),
        )
    }

    @Test
    fun `connecting shows banner without replacing viewport buffer`() {
        assertEquals("", terminalViewportText(TerminalSessionState.Connecting))
        assertEquals("Connecting...", terminalSessionBannerMessage(TerminalSessionState.Connecting))
    }

    @Test
    fun `display text combines viewport and banner for compatibility`() {
        val text = terminalDisplayText(
            TerminalSessionState.Disconnected(
                sessionId = "session-1",
                reason = TerminalDisconnectedReason.AndroidServiceStopped,
                output = "last output",
            ),
        )

        assertTrue(text.contains("last output"))
        assertTrue(text.contains("disconnected", ignoreCase = true))
        assertTrue(text.contains("Android service stopped"))
    }

    @Test
    fun `viewport banner shows transient notices inside terminal viewport`() {
        assertEquals(
            "Copied.",
            terminalViewportBannerMessage(
                state = TerminalSessionState.Connected("session-1", "", 80, 24),
                notice = "Copied.",
            ),
        )
    }

    @Test
    fun `viewport banner keeps session state visible when transient notice exists`() {
        val disconnected = TerminalSessionState.Disconnected(
            sessionId = "session-1",
            reason = TerminalDisconnectedReason.AndroidServiceStopped,
        )

        assertEquals(
            "Copy failed.\nTerminal disconnected: Android service stopped. Reconnect or return to diagnostics.",
            terminalViewportBannerMessage(
                state = disconnected,
                notice = "Copy failed.",
            ),
        )
    }

    @Test
    fun `viewport banner does not duplicate matching transient and session messages`() {
        val disconnected = TerminalSessionState.Disconnected(
            sessionId = "session-1",
            reason = TerminalDisconnectedReason.AndroidServiceStopped,
        )
        val message = terminalSessionBannerMessage(disconnected)

        assertEquals(
            message,
            terminalViewportBannerMessage(
                state = disconnected,
                notice = message,
            ),
        )
    }

    @Test
    fun `terminal status label includes disconnected reason`() {
        assertEquals(
            "disconnected: Android service stopped",
            terminalSessionStatusLabel(
                TerminalSessionState.Disconnected(
                    sessionId = "session-1",
                    reason = TerminalDisconnectedReason.AndroidServiceStopped,
                ),
            ),
        )
        assertEquals(
            "disconnected: SSH disconnected - connection lost",
            terminalSessionStatusLabel(
                TerminalSessionState.Disconnected(
                    sessionId = "session-1",
                    reason = TerminalDisconnectedReason.SshDisconnected,
                    message = "connection lost",
                ),
            ),
        )
        assertEquals("connected", terminalSessionStatusLabel(TerminalSessionState.Connected("session-1", "", 80, 24)))
    }

    @Test
    fun `command input is enabled only while terminal is connected`() {
        assertTrue(terminalCommandInputEnabled(TerminalSessionState.Connected("session-1", "", 80, 24)))
        assertFalse(
            terminalCommandInputEnabled(
                TerminalSessionState.Disconnected(
                    sessionId = "session-1",
                    reason = TerminalDisconnectedReason.SshDisconnected,
                ),
            ),
        )
    }

    @Test
    fun `command input placeholder explains disabled state`() {
        assertEquals(
            "Type a command",
            terminalCommandInputPlaceholder(TerminalSessionState.Connected("session-1", "", 80, 24)),
        )
        assertEquals(
            "Terminal disconnected: SSH disconnected. Reconnect or return to diagnostics.",
            terminalCommandInputPlaceholder(
                TerminalSessionState.Disconnected(
                    sessionId = "session-1",
                    reason = TerminalDisconnectedReason.SshDisconnected,
                ),
            ),
        )
    }

    @Test
    fun `command input is hidden by default`() {
        assertFalse(TerminalCommandInputDefaultVisible)
    }

    @Test
    fun `command input visibility menu label reflects state`() {
        assertEquals("Show command input", terminalCommandInputVisibilityActionLabel(visible = false))
        assertEquals("Hide command input", terminalCommandInputVisibilityActionLabel(visible = true))
    }

    @Test
    fun `terminal command controls stay compact`() {
        assertTrue(TerminalCommandInputHeight.value <= 40f)
        assertTrue(TerminalActionButtonHeight.value <= 36f)
    }

    @Test
    fun `native terminal fallback is visible only without emulator controller`() {
        assertTrue(terminalFallbackVisible(hasEmulatorController = false))
        assertFalse(terminalFallbackVisible(hasEmulatorController = true))
    }

    @Test
    fun `line input uses carriage return for PTY enter`() {
        assertEquals("pwd\r", terminalLineInput("pwd"))
    }

    @Test
    fun `quick confirm and cancel append carriage return by default`() {
        assertEquals("YES\r", terminalQuickInput(TerminalQuickConfirmInput))
        assertEquals("NO\r", terminalQuickInput(TerminalQuickCancelInput))
    }

    @Test
    fun `control character maps letters to terminal bytes`() {
        assertEquals("\u0001", terminalControlCharacter('a'))
        assertEquals("\u0003", terminalControlCharacter('C'))
        assertNull(terminalControlCharacter('1'))
    }

    @Test
    fun `control input maps ctrl+c and other ctrl letters from key codes`() {
        assertEquals("\u0003", terminalControlInput(KeyEvent.KEYCODE_C, ctrlPressed = true))
        assertEquals("\u000C", terminalControlInput(KeyEvent.KEYCODE_L, ctrlPressed = true))
        assertEquals("\u0004", terminalControlInput(KeyEvent.KEYCODE_D, ctrlPressed = true))
        assertNull(terminalControlInput(KeyEvent.KEYCODE_C, ctrlPressed = false))
        assertNull(terminalControlInput(KeyEvent.KEYCODE_ENTER, ctrlPressed = true))
    }

    @Test
    fun `helper key labels hide quick yes and no inputs`() {
        val labels = terminalHelperKeyLabels(ctrlModifierActive = false)

        assertFalse(labels.contains("YES"))
        assertFalse(labels.contains("NO"))
        assertEquals("ENTER", labels[0])
        assertEquals("⌫", labels[1])
        assertEquals("CTRL+C", labels[2])
        assertEquals("CTRL+L", labels[3])
        assertEquals("Tab", labels[4])
        assertEquals("Esc", labels[5])
    }

    @Test
    fun `helper key labels render in two rows`() {
        val rows = terminalHelperKeyRows(ctrlModifierActive = false)

        assertEquals(2, rows.size)
        assertEquals(listOf("ENTER", "⌫", "CTRL+C", "CTRL+L", "Tab", "Esc"), rows[0])
        assertEquals(listOf("Ctrl", "Up", "Down", "Left", "Right", "Paste"), rows[1])
    }

    @Test
    fun `selected text browser action opens http and https urls directly`() {
        assertEquals(
            TerminalSelectedTextBrowserAction.OpenUrl("https://example.test/repo"),
            terminalSelectedTextBrowserAction(" https://example.test/repo "),
        )
        assertEquals(
            TerminalSelectedTextBrowserAction.OpenUrl("http://example.test"),
            terminalSelectedTextBrowserAction("http://example.test"),
        )
    }

    @Test
    fun `selected text browser action searches non http text`() {
        assertEquals(
            TerminalSelectedTextBrowserAction.Search("git status modified file"),
            terminalSelectedTextBrowserAction(" git status\nmodified file "),
        )
        assertEquals(
            TerminalSelectedTextBrowserAction.Search("ssh://example.test/repo"),
            terminalSelectedTextBrowserAction("ssh://example.test/repo"),
        )
    }

    @Test
    fun `selected text browser action rejects blank selected text`() {
        assertNull(terminalSelectedTextBrowserAction(""))
        assertNull(terminalSelectedTextBrowserAction(" \n\t "))
    }

    @Test
    fun `selected text browser action caps search text length`() {
        val longText = "x".repeat(TerminalSelectedTextMaxLength + 8)

        assertEquals(
            TerminalSelectedTextBrowserAction.Search("x".repeat(TerminalSelectedTextMaxLength)),
            terminalSelectedTextBrowserAction(longText),
        )
    }

    @Test
    fun `top bar is hidden while terminal is maximized`() {
        assertTrue(TerminalDefaultMaximized)
        assertTrue(terminalTopBarVisible(terminalMaximized = false))
        assertFalse(terminalTopBarVisible(terminalMaximized = true))
        assertEquals("Maximize", terminalMaximizeActionLabel(terminalMaximized = false))
        assertEquals("Restore", terminalMaximizeActionLabel(terminalMaximized = true))
        assertTrue(terminalRestoreInlineActionVisible(terminalMaximized = true))
        assertFalse(terminalRestoreInlineActionVisible(terminalMaximized = false))
    }

    @Test
    fun `stick to bottom follows scroll position`() {
        assertTrue(terminalStickToBottom(scrollValue = 0, maxValue = 0))
        assertTrue(terminalStickToBottom(scrollValue = 952, maxValue = 1000))
        assertTrue(terminalStickToBottom(scrollValue = 952, maxValue = 1000, thresholdPx = 48))
        assertFalse(terminalStickToBottom(scrollValue = 900, maxValue = 1000, thresholdPx = 48))
    }

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

    @Test
    fun `workspace created sessions include only same workspace and same normalized path`() {
        val sessions = listOf(
            terminalRecord(id = "same-a", hostId = "host-1", repositoryId = "repo-1", remotePath = "/srv/app", openedAt = 100L),
            terminalRecord(id = "same-b", hostId = "host-1-alias", repositoryId = "repo-1", remotePath = "/srv/app/", openedAt = 200L),
            terminalRecord(id = "other-path", hostId = "host-1", repositoryId = "repo-1", remotePath = "/srv/other", openedAt = 300L),
            terminalRecord(id = "other-host", hostId = "host-2", repositoryId = "repo-1", remotePath = "/srv/app", openedAt = 400L),
        )

        assertEquals(
            listOf("same-a", "same-b"),
            terminalWorkspaceCreatedSessions(
                sessions = sessions,
                hostIds = setOf("host-1", "host-1-alias"),
                remotePath = "/srv/app",
            ).map { it.id },
        )
    }

    @Test
    fun `terminal target label includes repository and worktree path`() {
        assertEquals(
            "App - /srv/app-feature",
            terminalTargetLabel(repositoryTitle = "App", remotePath = "/srv/app-feature"),
        )
    }

    @Test
    fun `terminal title uses workspace session number and directory`() {
        val sessions = listOf(
            terminalRecord(id = "session-a", repositoryId = "repo-1", remotePath = "/srv/app", openedAt = 100L),
            terminalRecord(id = "session-b", repositoryId = "repo-1", remotePath = "/srv/app", openedAt = 200L),
            terminalRecord(id = "session-c", repositoryId = "repo-1", remotePath = "/srv/other", openedAt = 50L),
        )

        assertEquals(
            "terminal-2 /srv/app",
            terminalScreenTitle(
                sessionId = "session-b",
                sessions = sessions,
                hostId = "host-1",
                remotePath = "/srv/app",
            ),
        )
    }

    @Test
    fun `terminal title excludes sessions from other hosts`() {
        val sessions = listOf(
            terminalRecord(id = "session-a", hostId = "host-2", repositoryId = null, remotePath = "/", openedAt = 100L),
            terminalRecord(id = "session-b", hostId = "host-1", repositoryId = null, remotePath = "/", openedAt = 200L),
        )

        assertEquals(
            "terminal-1 /",
            terminalScreenTitle(
                sessionId = "session-b",
                sessions = sessions,
                hostId = "host-1",
                remotePath = "/",
            ),
        )
    }

    private fun terminalRecord(
        id: String,
        hostId: String = "host-1",
        repositoryId: String?,
        remotePath: String,
        openedAt: Long,
    ): TerminalSessionRecord = TerminalSessionRecord(
        id = id,
        hostId = hostId,
        repositoryId = repositoryId,
        remotePath = remotePath,
        targetLabel = "App - $remotePath",
        status = TerminalSessionStatus.Running,
        openedAt = openedAt,
    )
}
