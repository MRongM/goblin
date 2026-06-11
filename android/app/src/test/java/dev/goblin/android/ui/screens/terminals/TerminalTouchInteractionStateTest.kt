package dev.goblin.android.ui.screens.terminals

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalTouchInteractionStateTest {
    @Test
    fun `touch point maps to emulator cell with scrollback and horizontal offset`() {
        val cell = terminalCellAt(
            xPx = 32f,
            yPx = 37f,
            horizontalOffsetPx = 16,
            scrollbackOffsetRows = 5,
            fontWidthPx = 8f,
            lineHeightPx = 18,
            renderScaleX = 1f,
            columns = 80,
            rows = 24,
            activeTranscriptRows = 20,
        )

        assertEquals(TerminalCell(column = 6, row = -3), cell)
    }

    @Test
    fun `touch point accounts for fit mode horizontal render scale`() {
        val cell = terminalCellAt(
            xPx = 36f,
            yPx = 18f,
            horizontalOffsetPx = 0,
            scrollbackOffsetRows = 0,
            fontWidthPx = 8f,
            lineHeightPx = 18,
            renderScaleX = 1.5f,
            columns = 80,
            rows = 24,
            activeTranscriptRows = 0,
        )

        assertEquals(TerminalCell(column = 3, row = 1), cell)
    }

    @Test
    fun `selection range normalizes reversed drag and clamps to emulator bounds`() {
        val range = TerminalSelectionRange(
            start = TerminalCell(column = 20, row = 8),
            end = TerminalCell(column = 3, row = -12),
        ).normalized().clamped(columns = 10, rows = 6, activeTranscriptRows = 4)

        assertEquals(TerminalSelectionRange(TerminalCell(3, -4), TerminalCell(9, 5)), range)
        assertTrue(range.hasExtent)
    }

    @Test
    fun `selection without movement has no extent`() {
        val range = TerminalSelectionRange(
            start = TerminalCell(column = 2, row = 3),
            end = TerminalCell(column = 2, row = 3),
        )

        assertFalse(range.hasExtent)
    }

    @Test
    fun `tap movement threshold distinguishes click from drag`() {
        assertTrue(terminalWithinTouchSlop(downX = 10f, downY = 10f, currentX = 13f, currentY = 14f, touchSlopPx = 6))
        assertFalse(terminalWithinTouchSlop(downX = 10f, downY = 10f, currentX = 18f, currentY = 14f, touchSlopPx = 6))
    }

    @Test
    fun `double tap action uses top and bottom halves`() {
        assertEquals(TerminalDoubleTapAction.JumpTop, terminalDoubleTapAction(yPx = 99f, heightPx = 200))
        assertEquals(TerminalDoubleTapAction.JumpBottom, terminalDoubleTapAction(yPx = 100f, heightPx = 200))
    }

    @Test
    fun `inertia velocity decays to zero below threshold`() {
        val initial = TerminalInertiaVelocity(verticalPxPerSecond = 1000f, horizontalPxPerSecond = 400f)
        val decayed = terminalDecayInertiaVelocity(initial, decay = 0.5f, minVelocityPxPerSecond = 60f)
        val stopped = terminalDecayInertiaVelocity(decayed, decay = 0.05f, minVelocityPxPerSecond = 60f)

        assertEquals(TerminalInertiaVelocity(verticalPxPerSecond = 500f, horizontalPxPerSecond = 200f), decayed)
        assertEquals(TerminalInertiaVelocity.Zero, stopped)
    }
}
