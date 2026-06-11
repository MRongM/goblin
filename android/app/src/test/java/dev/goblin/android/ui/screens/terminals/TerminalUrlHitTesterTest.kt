package dev.goblin.android.ui.screens.terminals

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TerminalUrlHitTesterTest {
    @Test
    fun `url hit tester returns http url under touched column`() {
        val line = "open https://example.com/path now"

        assertEquals("https://example.com/path", terminalUrlAtColumn(line, column = 8))
        assertEquals("https://example.com/path", terminalUrlAtColumn(line, column = 28))
    }

    @Test
    fun `url hit tester ignores columns outside url`() {
        val line = "open https://example.com/path now"

        assertNull(terminalUrlAtColumn(line, column = 1))
        assertNull(terminalUrlAtColumn(line, column = 31))
    }

    @Test
    fun `url hit tester accepts http and https only`() {
        assertEquals("http://example.com", terminalUrlAtColumn("http://example.com", column = 4))
        assertNull(terminalUrlAtColumn("ssh://example.com", column = 4))
        assertNull(terminalUrlAtColumn("mailto:dev@example.com", column = 4))
        assertNull(terminalUrlAtColumn("file:///tmp/a", column = 4))
    }

    @Test
    fun `url validation rejects controls and overlong values`() {
        assertNull(terminalSafeExternalUrl("https://example.com/\u0000bad"))
        assertNull(terminalSafeExternalUrl("https://example.com/" + "a".repeat(4096)))
    }

    @Test
    fun `url hit tester trims common trailing punctuation`() {
        val line = "see https://example.com/path."

        assertEquals("https://example.com/path", terminalUrlAtColumn(line, column = 8))
    }
}
