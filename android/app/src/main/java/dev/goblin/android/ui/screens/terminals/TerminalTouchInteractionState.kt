package dev.goblin.android.ui.screens.terminals

import kotlin.math.abs
import kotlin.math.sqrt

internal data class TerminalCell(
    val column: Int,
    val row: Int,
)

internal data class TerminalSelectionRange(
    val start: TerminalCell,
    val end: TerminalCell,
) {
    val hasExtent: Boolean
        get() = start != end

    fun normalized(): TerminalSelectionRange =
        if (start.row < end.row || (start.row == end.row && start.column <= end.column)) {
            this
        } else {
            TerminalSelectionRange(start = end, end = start)
        }

    fun clamped(columns: Int, rows: Int, activeTranscriptRows: Int): TerminalSelectionRange {
        val maxColumn = (columns - 1).coerceAtLeast(0)
        val minRow = -activeTranscriptRows.coerceAtLeast(0)
        val maxRow = (rows - 1).coerceAtLeast(0)
        return TerminalSelectionRange(
            start = start.clamped(maxColumn, minRow, maxRow),
            end = end.clamped(maxColumn, minRow, maxRow),
        ).normalized()
    }
}

internal enum class TerminalDoubleTapAction {
    JumpTop,
    JumpBottom,
}

internal data class TerminalInertiaVelocity(
    val verticalPxPerSecond: Float,
    val horizontalPxPerSecond: Float,
) {
    companion object {
        val Zero = TerminalInertiaVelocity(verticalPxPerSecond = 0f, horizontalPxPerSecond = 0f)
    }
}

internal fun terminalCellAt(
    xPx: Float,
    yPx: Float,
    horizontalOffsetPx: Int,
    scrollbackOffsetRows: Int,
    fontWidthPx: Float,
    lineHeightPx: Int,
    renderScaleX: Float,
    columns: Int,
    rows: Int,
    activeTranscriptRows: Int,
): TerminalCell {
    val safeFontWidth = fontWidthPx.coerceAtLeast(1f)
    val safeLineHeight = lineHeightPx.coerceAtLeast(1)
    val safeScale = renderScaleX.coerceAtLeast(1f)
    val maxColumn = (columns - 1).coerceAtLeast(0)
    val visibleRow = (yPx / safeLineHeight).toInt().coerceIn(0, (rows - 1).coerceAtLeast(0))
    val bufferRow = (visibleRow - scrollbackOffsetRows).coerceIn(
        -activeTranscriptRows.coerceAtLeast(0),
        (rows - 1).coerceAtLeast(0),
    )
    val unscaledX = ((xPx + horizontalOffsetPx.toFloat()) / safeScale).coerceAtLeast(0f)
    return TerminalCell(
        column = (unscaledX / safeFontWidth).toInt().coerceIn(0, maxColumn),
        row = bufferRow,
    )
}

internal fun terminalWithinTouchSlop(
    downX: Float,
    downY: Float,
    currentX: Float,
    currentY: Float,
    touchSlopPx: Int,
): Boolean {
    val dx = currentX - downX
    val dy = currentY - downY
    return sqrt((dx * dx) + (dy * dy)) <= touchSlopPx.toFloat()
}

internal fun terminalDoubleTapAction(yPx: Float, heightPx: Int): TerminalDoubleTapAction =
    if (yPx < heightPx / 2f) TerminalDoubleTapAction.JumpTop else TerminalDoubleTapAction.JumpBottom

internal fun terminalDecayInertiaVelocity(
    velocity: TerminalInertiaVelocity,
    decay: Float,
    minVelocityPxPerSecond: Float,
): TerminalInertiaVelocity {
    fun decayAxis(value: Float): Float {
        val next = value * decay
        return if (abs(next) < minVelocityPxPerSecond) 0f else next
    }
    val next = TerminalInertiaVelocity(
        verticalPxPerSecond = decayAxis(velocity.verticalPxPerSecond),
        horizontalPxPerSecond = decayAxis(velocity.horizontalPxPerSecond),
    )
    return if (next.verticalPxPerSecond == 0f && next.horizontalPxPerSecond == 0f) {
        TerminalInertiaVelocity.Zero
    } else {
        next
    }
}

private fun TerminalCell.clamped(maxColumn: Int, minRow: Int, maxRow: Int): TerminalCell =
    TerminalCell(
        column = column.coerceIn(0, maxColumn),
        row = row.coerceIn(minRow, maxRow),
    )
