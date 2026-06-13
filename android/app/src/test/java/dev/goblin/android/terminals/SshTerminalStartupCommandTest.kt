package dev.goblin.android.terminals

import dev.goblin.android.domain.ssh.RemoteTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SshTerminalStartupCommandTest {
    @Test
    fun `project workspace shell starts tmux first and falls back to native shell`() {
        val target = target(remotePath = "/srv/repo-feature")
        val context = startupContext(terminalId = 2)
        val command = SshTerminalStartupCommand.initialInputForTarget(target, context)
        val output = command.orEmpty()
        val sessionName = SshTerminalStartupCommand.tmuxSessionName(target, context)

        assertTrue(output.contains("goblin_remote_path='/srv/repo-feature'"))
        assertTrue(output.contains("goblin_tmux_session='$sessionName'"))
        assertTrue(output.contains("command -v tmux >/dev/null 2>&1"))
        assertTrue(output.contains("tmux new-session -A -s \"\$goblin_tmux_session\""))
        assertTrue(output.contains("tmux unavailable (exit %s); falling back to shell"))
        assertTrue(output.contains("exec \"\${SHELL:-sh}\""))
        assertTrue(output.endsWith("\r"))
    }

    @Test
    fun `workspace shell quotes paths with spaces and single quotes`() {
        val command = SshTerminalStartupCommand.initialInputForTarget(
            target(remotePath = "/srv/app's worktree"),
            startupContext(terminalId = 1, worktreeRemotePath = "/srv/app's worktree"),
        )
        val output = command.orEmpty()

        assertTrue(output.contains("goblin_remote_path='/srv/app'\"'\"'s worktree'"))
        assertTrue(output.contains("cd \"\$goblin_remote_path\""))
        assertFalse(output.contains("goblin_remote_path=/srv/app's worktree"))
    }

    @Test
    fun `root project path still starts tmux first`() {
        val command = SshTerminalStartupCommand.initialInputForTarget(
            target(remotePath = "/"),
            startupContext(terminalId = 1, worktreeRemotePath = "/"),
        )
        val output = command.orEmpty()

        assertTrue(output.contains("goblin_remote_path='/'"))
        assertTrue(output.contains("command -v tmux >/dev/null 2>&1"))
        assertTrue(output.contains("tmux new-session -A -s \"\$goblin_tmux_session\""))
        assertTrue(output.contains("exec \"\${SHELL:-sh}\""))
    }

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
        assertTrue(first.length <= 32)
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

    @Test
    fun `startup input failure output includes exception class when message is blank`() {
        val output = SshTerminalStartupCommand.startupInputFailureOutput(BlankMessageException())

        assertTrue(output.contains("Startup cd failed"))
        assertTrue(output.contains("BlankMessageException"))
    }

    private fun startupContext(
        terminalId: Int,
        repositoryRemotePath: String = "/srv/repo",
        worktreeRemotePath: String = "/srv/repo-feature",
    ): TerminalStartupContext =
        TerminalStartupContext(
            repositoryRemotePath = repositoryRemotePath,
            worktreeRemotePath = worktreeRemotePath,
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

    private class BlankMessageException : RuntimeException()
}
