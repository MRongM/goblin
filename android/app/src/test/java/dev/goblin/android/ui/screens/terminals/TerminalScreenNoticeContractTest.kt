package dev.goblin.android.ui.screens.terminals

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Test

class TerminalScreenNoticeContractTest {
    @Test
    fun `terminal screen does not render a bottom notice row`() {
        val source = terminalScreenSource()

        assertFalse(
            "TerminalScreen should keep notices inside the terminal viewport instead of rendering a bottom notice row.",
            source.contains("inputNotice?.let"),
        )
    }

    @Test
    fun `terminal state does not mirror unavailable input into a bottom notice`() {
        val source = terminalScreenSource()

        assertFalse(
            "TerminalScreen should rely on the terminal viewport banner for session-state notices.",
            source.contains("LaunchedEffect(terminalState)"),
        )
    }

    private fun terminalScreenSource(): String {
        val candidates = listOf(
            File("src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt"),
            File("app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt"),
            File("android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt"),
        )
        val source = candidates.firstOrNull { it.isFile }
            ?: error("TerminalScreen.kt not found from ${File(".").absolutePath}")
        return source.readText()
    }
}
