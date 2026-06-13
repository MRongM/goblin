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
