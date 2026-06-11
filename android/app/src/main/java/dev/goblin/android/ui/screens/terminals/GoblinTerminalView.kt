package dev.goblin.android.ui.screens.terminals

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.os.SystemClock
import android.text.InputType
import android.util.AttributeSet
import android.util.TypedValue
import android.view.ActionMode
import android.view.GestureDetector
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import com.termux.view.TerminalRenderer
import dev.goblin.android.terminals.emulator.RemoteTerminalEmulatorController
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.roundToInt

internal data class TerminalGridSize(val columns: Int, val rows: Int)

internal const val TerminalMinFontSizeSp = 12
internal const val TerminalDefaultFontSizeSp = 12
internal const val TerminalMaxFontSizeSp = 24
internal const val TerminalFontSizeStepSp = 2
internal const val TerminalCellWidthScale = 1.12f

internal fun terminalHorizontalOffset(
    currentOffsetPx: Int,
    deltaPx: Int,
    contentWidthPx: Int,
    viewportWidthPx: Int,
): Int {
    val maxOffsetPx = (contentWidthPx - viewportWidthPx).coerceAtLeast(0)
    return (currentOffsetPx + deltaPx).coerceIn(0, maxOffsetPx)
}

internal fun terminalAdjustedFontSize(currentFontSizeSp: Int, steps: Int): Int {
    val safeCurrent = currentFontSizeSp.takeIf { it in TerminalMinFontSizeSp..TerminalMaxFontSizeSp }
        ?: TerminalDefaultFontSizeSp
    return (safeCurrent + (steps * TerminalFontSizeStepSp))
        .coerceIn(TerminalMinFontSizeSp, TerminalMaxFontSizeSp)
}

internal fun terminalCellWidthPx(measuredFontWidthPx: Float): Int =
    ceil(measuredFontWidthPx * TerminalCellWidthScale)
        .toInt()
        .coerceAtLeast(1)

internal fun terminalRenderScaleX(
    widthPx: Int,
    gridColumns: Int,
    measuredFontWidthPx: Float,
    fitToScreen: Boolean,
): Float {
    if (!fitToScreen) return 1f
    val safeMeasuredWidth = measuredFontWidthPx.coerceAtLeast(1f)
    val safeColumns = gridColumns.coerceAtLeast(1)
    val renderedWidth = safeMeasuredWidth * safeColumns
    return (widthPx.toFloat() / renderedWidth).coerceAtLeast(1f)
}

internal fun terminalGridSize(
    widthPx: Int,
    heightPx: Int,
    cellWidthPx: Int,
    cellHeightPx: Int,
): TerminalGridSize {
    val safeCellWidth = cellWidthPx.coerceAtLeast(1)
    val safeCellHeight = cellHeightPx.coerceAtLeast(1)
    return TerminalGridSize(
        columns = (widthPx / safeCellWidth).coerceAtLeast(2),
        rows = (heightPx / safeCellHeight).coerceAtLeast(2),
    )
}

internal fun terminalScrollbackOffset(
    currentOffset: Int,
    deltaRows: Int,
    activeTranscriptRows: Int,
): Int = (currentOffset + deltaRows).coerceIn(0, activeTranscriptRows.coerceAtLeast(0))

internal fun terminalScrollbackOffsetForOutput(
    currentOffset: Int,
    activeTranscriptRows: Int,
): Int = if (currentOffset == 0) {
    0
} else {
    currentOffset.coerceIn(0, activeTranscriptRows.coerceAtLeast(0))
}

internal class GoblinTerminalView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {
    private var controller: RemoteTerminalEmulatorController? = null
    private var observer: AutoCloseable? = null
    private var currentFontSizeSp = TerminalDefaultFontSizeSp
    private var fitToScreen = true
    private val terminalTypeface = TerminalTypefaceProvider.terminalTypeface(context)
    private var renderer = TerminalRenderer(currentFontSizeSp.spToPx(), terminalTypeface)
    private val viewConfiguration = ViewConfiguration.get(context)
    private val gestureDetector = GestureDetector(context, TerminalGestureListener())
    private val selectionPaint = Paint().apply { color = 0x663B82F6 }
    private var lastGrid: TerminalGridSize? = null
    private var horizontalViewportWidthPx = 0
    private var horizontalOffsetPx = 0
    private var scrollbackOffsetRows = 0
    private var lastTouchX: Float? = null
    private var lastTouchY: Float? = null
    private var horizontalRemainderPx = 0f
    private var scrollRemainderPx = 0f
    private var touchScrolled = false
    private var onOpenUrl: (String) -> Unit = {}
    private var onCopyText: (String) -> Boolean = { false }
    private var onOpenSelectedText: (String) -> Boolean = { false }
    private var velocityTracker: VelocityTracker? = null
    private var inertiaVelocity = TerminalInertiaVelocity.Zero
    private var inertiaFramePosted = false
    private var lastInertiaFrameMs = 0L
    private var selectionRange: TerminalSelectionRange? = null
    private var selectionActionMode: ActionMode? = null

    init {
        isFocusable = true
        isFocusableInTouchMode = true
        isVerticalScrollBarEnabled = true
    }

    fun bind(nextController: RemoteTerminalEmulatorController?) {
        if (controller === nextController && observer != null) return
        observer?.close()
        observer = null
        clearSelection()
        cancelInertia()
        velocityTracker?.recycle()
        velocityTracker = null
        controller = nextController
        lastGrid = null
        horizontalOffsetPx = 0
        scrollbackOffsetRows = 0
        lastTouchX = null
        lastTouchY = null
        horizontalRemainderPx = 0f
        scrollRemainderPx = 0f
        touchScrolled = false
        if (nextController != null) {
            observer = nextController.observe { onTerminalScreenUpdated() }
            updateGrid(width, height)
        }
        invalidate()
    }

    fun setHorizontalViewportWidthPx(nextWidthPx: Int) {
        val safeWidthPx = nextWidthPx.coerceAtLeast(0)
        if (horizontalViewportWidthPx == safeWidthPx) return
        horizontalViewportWidthPx = safeWidthPx
        setHorizontalOffset(horizontalOffset(deltaPx = 0))
    }

    fun setFitToScreen(nextFitToScreen: Boolean) {
        if (fitToScreen == nextFitToScreen) return
        cancelInertia()
        fitToScreen = nextFitToScreen
        lastGrid = null
        setHorizontalOffset(horizontalOffset(deltaPx = 0))
        updateGrid(width, height)
        invalidate()
    }

    fun setFontSizeSp(nextFontSizeSp: Int) {
        val safeFontSizeSp = terminalAdjustedFontSize(nextFontSizeSp, steps = 0)
        if (currentFontSizeSp == safeFontSizeSp) return
        currentFontSizeSp = safeFontSizeSp
        renderer = TerminalRenderer(currentFontSizeSp.spToPx(), terminalTypeface)
        lastGrid = null
        updateGrid(width, height)
        invalidate()
    }

    fun setExternalInteractions(
        onOpenUrl: (String) -> Unit,
        onCopyText: (String) -> Boolean,
        onOpenSelectedText: (String) -> Boolean,
    ) {
        this.onOpenUrl = onOpenUrl
        this.onCopyText = onCopyText
        this.onOpenSelectedText = onOpenSelectedText
    }

    override fun onDetachedFromWindow() {
        observer?.close()
        observer = null
        clearSelection()
        cancelInertia()
        velocityTracker?.recycle()
        velocityTracker = null
        controller = null
        lastGrid = null
        horizontalOffsetPx = 0
        scrollbackOffsetRows = 0
        lastTouchX = null
        lastTouchY = null
        horizontalRemainderPx = 0f
        scrollRemainderPx = 0f
        touchScrolled = false
        super.onDetachedFromWindow()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        setHorizontalOffset(horizontalOffset(deltaPx = 0))
        updateGrid(w, h)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val activeController = controller ?: return
        val grid = lastGrid
        val horizontalScale = terminalRenderScaleX(
            widthPx = width,
            gridColumns = grid?.columns ?: activeController.emulator.mColumns,
            measuredFontWidthPx = renderer.fontWidth,
            fitToScreen = fitToScreen,
        )
        val checkpoint = canvas.save()
        canvas.translate(-horizontalOffsetPx.toFloat(), 0f)
        if (fitToScreen && horizontalScale != 1f) {
            canvas.scale(horizontalScale, 1f)
        }
        renderer.render(activeController.emulator, canvas, -scrollbackOffsetRows, -1, -1, -1, -1)
        drawSelection(canvas)
        canvas.restoreToCount(checkpoint)
    }

    override fun computeVerticalScrollRange(): Int =
        controller?.emulator?.screen?.activeRows ?: 1

    override fun computeVerticalScrollExtent(): Int =
        controller?.emulator?.mRows ?: 1

    override fun computeVerticalScrollOffset(): Int {
        val emulator = controller?.emulator ?: return 1
        return emulator.screen.activeRows - scrollbackOffsetRows - emulator.mRows
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (controller == null) return true
        gestureDetector.onTouchEvent(event)
        requestFocus()
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                if (selectionRange != null) {
                    clearSelection()
                    return true
                }
                cancelInertia()
                velocityTracker?.recycle()
                velocityTracker = VelocityTracker.obtain().also { it.addMovement(event) }
                parent?.requestDisallowInterceptTouchEvent(true)
                lastTouchX = event.x
                lastTouchY = event.y
                horizontalRemainderPx = 0f
                scrollRemainderPx = 0f
                touchScrolled = false
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (selectionRange != null) {
                    updateSelection(event)
                    return true
                }
                val previousX = lastTouchX ?: event.x
                val previousY = lastTouchY ?: event.y
                lastTouchX = event.x
                lastTouchY = event.y
                velocityTracker?.addMovement(event)
                val horizontalDeltaPx = previousX - event.x + horizontalRemainderPx
                val horizontalStepPx = horizontalDeltaPx.toInt()
                if (horizontalStepPx != 0) {
                    horizontalRemainderPx = horizontalDeltaPx - horizontalStepPx
                    val previousOffsetPx = horizontalOffsetPx
                    setHorizontalOffset(horizontalOffset(horizontalStepPx))
                    if (horizontalOffsetPx != previousOffsetPx) touchScrolled = true
                } else {
                    horizontalRemainderPx = horizontalDeltaPx
                }
                val deltaPx = event.y - previousY + scrollRemainderPx
                val deltaRows = (deltaPx / renderer.fontLineSpacing.coerceAtLeast(1)).toInt()
                if (deltaRows != 0) {
                    scrollRemainderPx = deltaPx - (deltaRows * renderer.fontLineSpacing)
                    setScrollbackOffset(scrollbackOffset(deltaRows))
                    touchScrolled = true
                } else {
                    scrollRemainderPx = deltaPx
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                if (selectionRange != null) {
                    parent?.requestDisallowInterceptTouchEvent(false)
                    lastTouchX = null
                    lastTouchY = null
                    horizontalRemainderPx = 0f
                    scrollRemainderPx = 0f
                    touchScrolled = false
                    velocityTracker?.recycle()
                    velocityTracker = null
                    return true
                }
                velocityTracker?.apply {
                    addMovement(event)
                    computeCurrentVelocity(1000)
                    startInertia(
                        verticalPxPerSecond = yVelocity,
                        horizontalPxPerSecond = -xVelocity,
                    )
                    recycle()
                }
                velocityTracker = null
                parent?.requestDisallowInterceptTouchEvent(false)
                lastTouchX = null
                lastTouchY = null
                horizontalRemainderPx = 0f
                scrollRemainderPx = 0f
                if (!touchScrolled) performClick()
                touchScrolled = false
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                velocityTracker?.recycle()
                velocityTracker = null
                cancelInertia()
                clearSelection()
                parent?.requestDisallowInterceptTouchEvent(false)
                lastTouchX = null
                lastTouchY = null
                horizontalRemainderPx = 0f
                scrollRemainderPx = 0f
                touchScrolled = false
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onGenericMotionEvent(event: MotionEvent): Boolean {
        if (event.action != MotionEvent.ACTION_SCROLL || controller == null) {
            return super.onGenericMotionEvent(event)
        }
        val verticalScroll = event.getAxisValue(MotionEvent.AXIS_VSCROLL)
        if (verticalScroll == 0f) return super.onGenericMotionEvent(event)
        val rows = if (verticalScroll > 0f) MouseWheelRows else -MouseWheelRows
        setScrollbackOffset(scrollbackOffset(rows))
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    override fun onCheckIsTextEditor(): Boolean = true

    private fun showSoftKeyboard() {
        requestFocus()
        post {
            context.getSystemService(InputMethodManager::class.java)
                ?.showSoftInput(this, 0)
        }
    }

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
        outAttrs.inputType = InputType.TYPE_CLASS_TEXT or
            InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
            InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
        outAttrs.imeOptions = EditorInfo.IME_FLAG_NO_FULLSCREEN
        return object : BaseInputConnection(this, true) {
            override fun commitText(text: CharSequence, newCursorPosition: Int): Boolean {
                sendBytes(terminalTextBytes(text))
                getEditable()?.clear()
                return true
            }

            override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
                repeat(beforeLength.coerceAtLeast(1)) {
                    sendBytes(byteArrayOf(0x7F.toByte()))
                }
                return true
            }
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val activeController = controller ?: return false
        val bytes = terminalKeyBytes(
            keyCode = keyCode,
            action = event.action,
            ctrlPressed = event.isCtrlPressed,
            altPressed = event.isAltPressed,
            shiftPressed = event.isShiftPressed,
            cursorKeysApplicationMode = activeController.emulator.isCursorKeysApplicationMode,
            keypadApplicationMode = activeController.emulator.isKeypadApplicationMode,
        )
        if (bytes != null) {
            sendBytes(bytes)
            return true
        }

        val unicodeChar = event.unicodeChar
        if (unicodeChar > 0) {
            sendBytes(String(Character.toChars(unicodeChar)).toByteArray(Charsets.UTF_8))
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun updateGrid(widthPx: Int, heightPx: Int) {
        val activeController = controller ?: return
        if (widthPx <= 0 || heightPx <= 0) return
        val cellWidthPx = terminalCellWidthPx(renderer.fontWidth)
        val cellHeightPx = renderer.fontLineSpacing.coerceAtLeast(1)
        val nextGrid = terminalGridSize(widthPx, heightPx, cellWidthPx, cellHeightPx)
        if (nextGrid == lastGrid) return
        lastGrid = nextGrid
        activeController.resize(nextGrid.columns, nextGrid.rows)
    }

    private fun onTerminalScreenUpdated() {
        val activeRows = activeTranscriptRows()
        scrollbackOffsetRows = terminalScrollbackOffsetForOutput(scrollbackOffsetRows, activeRows)
        invalidate()
    }

    private fun scrollbackOffset(deltaRows: Int): Int =
        terminalScrollbackOffset(
            currentOffset = scrollbackOffsetRows,
            deltaRows = deltaRows,
            activeTranscriptRows = activeTranscriptRows(),
        )

    private fun horizontalOffset(deltaPx: Int): Int =
        terminalHorizontalOffset(
            currentOffsetPx = horizontalOffsetPx,
            deltaPx = deltaPx,
            contentWidthPx = width,
            viewportWidthPx = horizontalViewportWidthPx.takeIf { it > 0 } ?: width,
        )

    private fun setHorizontalOffset(nextOffsetPx: Int) {
        if (nextOffsetPx == horizontalOffsetPx) return
        horizontalOffsetPx = nextOffsetPx
        invalidate()
    }

    private fun setScrollbackOffset(nextOffset: Int) {
        if (nextOffset == scrollbackOffsetRows) return
        scrollbackOffsetRows = nextOffset
        if (!awakenScrollBars()) invalidate()
    }

    private fun cancelInertia() {
        inertiaVelocity = TerminalInertiaVelocity.Zero
        inertiaFramePosted = false
        lastInertiaFrameMs = 0L
    }

    private fun startInertia(verticalPxPerSecond: Float, horizontalPxPerSecond: Float) {
        val vertical = if (abs(verticalPxPerSecond) >= viewConfiguration.scaledMinimumFlingVelocity) {
            verticalPxPerSecond
        } else {
            0f
        }
        val horizontal = if (!fitToScreen && abs(horizontalPxPerSecond) >= viewConfiguration.scaledMinimumFlingVelocity) {
            horizontalPxPerSecond
        } else {
            0f
        }
        inertiaVelocity = TerminalInertiaVelocity(
            verticalPxPerSecond = vertical,
            horizontalPxPerSecond = horizontal,
        )
        if (inertiaVelocity != TerminalInertiaVelocity.Zero) scheduleInertiaFrame()
    }

    private fun scheduleInertiaFrame() {
        if (inertiaFramePosted) return
        inertiaFramePosted = true
        postOnAnimation(::runInertiaFrame)
    }

    private fun runInertiaFrame() {
        inertiaFramePosted = false
        if (inertiaVelocity == TerminalInertiaVelocity.Zero || controller == null) return
        val now = SystemClock.uptimeMillis()
        val elapsedMs = if (lastInertiaFrameMs == 0L) {
            16L
        } else {
            (now - lastInertiaFrameMs).coerceIn(1L, InertiaMaxFrameMs)
        }
        lastInertiaFrameMs = now
        val elapsedSeconds = elapsedMs / 1000f

        val verticalRows = ((inertiaVelocity.verticalPxPerSecond * elapsedSeconds) / renderer.fontLineSpacing.coerceAtLeast(1)).toInt()
        if (verticalRows != 0) {
            val previous = scrollbackOffsetRows
            setScrollbackOffset(scrollbackOffset(verticalRows))
            if (previous == scrollbackOffsetRows) {
                inertiaVelocity = inertiaVelocity.copy(verticalPxPerSecond = 0f)
            }
        }

        val horizontalPixels = (inertiaVelocity.horizontalPxPerSecond * elapsedSeconds).toInt()
        if (horizontalPixels != 0) {
            val previous = horizontalOffsetPx
            setHorizontalOffset(horizontalOffset(horizontalPixels))
            if (previous == horizontalOffsetPx) {
                inertiaVelocity = inertiaVelocity.copy(horizontalPxPerSecond = 0f)
            }
        }

        inertiaVelocity = terminalDecayInertiaVelocity(
            velocity = inertiaVelocity,
            decay = InertiaDecay,
            minVelocityPxPerSecond = InertiaMinVelocityPxPerSecond,
        )
        if (inertiaVelocity != TerminalInertiaVelocity.Zero) scheduleInertiaFrame()
    }

    private fun clearSelection() {
        selectionRange = null
        selectionActionMode?.finish()
        selectionActionMode = null
        invalidate()
    }

    private fun beginSelection(event: MotionEvent) {
        val cell = terminalCellForEvent(event) ?: return
        cancelInertia()
        selectionRange = TerminalSelectionRange(start = cell, end = cell)
        selectionActionMode = startActionMode(TerminalSelectionActionMode(), ActionMode.TYPE_FLOATING)
        invalidate()
    }

    private fun updateSelection(event: MotionEvent) {
        val current = selectionRange ?: return
        val activeController = controller ?: return
        val cell = terminalCellForEvent(event) ?: return
        selectionRange = current.copy(end = cell)
            .normalized()
            .clamped(
                columns = activeController.emulator.mColumns,
                rows = activeController.emulator.mRows,
                activeTranscriptRows = activeTranscriptRows(),
            )
        invalidate()
    }

    private fun selectedText(): String {
        val activeController = controller ?: return ""
        val range = selectionRange
            ?.normalized()
            ?.clamped(
                columns = activeController.emulator.mColumns,
                rows = activeController.emulator.mRows,
                activeTranscriptRows = activeTranscriptRows(),
            )
            ?: return ""
        if (!range.hasExtent) return ""
        return activeController.emulator.getSelectedText(
            range.start.column,
            range.start.row,
            range.end.column,
            range.end.row,
        ).trimEnd()
    }

    private fun copySelection(): Boolean {
        val text = selectedText()
        if (text.isBlank()) return false
        val copied = onCopyText(text)
        if (copied) clearSelection()
        return copied
    }

    private fun openSelectedText(): Boolean {
        val text = selectedText()
        if (text.isBlank()) return false
        val opened = onOpenSelectedText(text)
        if (opened) clearSelection()
        return opened
    }

    private fun drawSelection(canvas: Canvas) {
        val activeController = controller ?: return
        val range = selectionRange
            ?.normalized()
            ?.clamped(
                columns = activeController.emulator.mColumns,
                rows = activeController.emulator.mRows,
                activeTranscriptRows = activeTranscriptRows(),
            )
            ?: return
        if (!range.hasExtent) return

        val lineHeight = renderer.fontLineSpacing.coerceAtLeast(1).toFloat()
        val cellWidth = renderer.fontWidth.coerceAtLeast(1f)
        for (row in range.start.row..range.end.row) {
            val visibleRow = row + scrollbackOffsetRows
            if (visibleRow !in 0 until activeController.emulator.mRows) continue
            val startColumn = if (row == range.start.row) range.start.column else 0
            val endColumn = if (row == range.end.row) range.end.column else activeController.emulator.mColumns - 1
            canvas.drawRect(
                startColumn * cellWidth,
                visibleRow * lineHeight,
                (endColumn + 1) * cellWidth,
                (visibleRow + 1) * lineHeight,
                selectionPaint,
            )
        }
    }

    private fun activeTranscriptRows(): Int =
        controller?.emulator?.screen?.activeTranscriptRows ?: 0

    private fun terminalCellForEvent(event: MotionEvent): TerminalCell? {
        val activeController = controller ?: return null
        val grid = lastGrid ?: return null
        val scale = terminalRenderScaleX(
            widthPx = width,
            gridColumns = grid.columns,
            measuredFontWidthPx = renderer.fontWidth,
            fitToScreen = fitToScreen,
        )
        return terminalCellAt(
            xPx = event.x,
            yPx = event.y,
            horizontalOffsetPx = horizontalOffsetPx,
            scrollbackOffsetRows = scrollbackOffsetRows,
            fontWidthPx = renderer.fontWidth,
            lineHeightPx = renderer.fontLineSpacing.coerceAtLeast(1),
            renderScaleX = scale,
            columns = activeController.emulator.mColumns,
            rows = activeController.emulator.mRows,
            activeTranscriptRows = activeTranscriptRows(),
        )
    }

    private fun terminalLineText(row: Int): String {
        val activeController = controller ?: return ""
        val emulator = activeController.emulator
        return emulator.getSelectedText(
            0,
            row,
            emulator.mColumns - 1,
            row,
        ).trimEnd()
    }

    private fun openUrlAtEvent(event: MotionEvent): Boolean {
        val cell = terminalCellForEvent(event) ?: return false
        val url = terminalUrlAtColumn(terminalLineText(cell.row), cell.column) ?: return false
        onOpenUrl(url)
        return true
    }

    private fun sendBytes(bytes: ByteArray) {
        controller?.output?.write(bytes, 0, bytes.size)
    }

    private fun Int.spToPx(): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, toFloat(), resources.displayMetrics)
            .roundToInt()
            .coerceAtLeast(1)

    private inner class TerminalGestureListener : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent): Boolean = true

        override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
            if (controller == null || touchScrolled || selectionRange != null) return false
            if (openUrlAtEvent(e)) return true
            showSoftKeyboard()
            return true
        }

        override fun onDoubleTap(e: MotionEvent): Boolean {
            if (controller == null || touchScrolled || selectionRange != null) return false
            val cell = terminalCellForEvent(e)
            if (cell != null && terminalUrlAtColumn(terminalLineText(cell.row), cell.column) != null) return false
            when (terminalDoubleTapAction(yPx = e.y, heightPx = height)) {
                TerminalDoubleTapAction.JumpTop -> setScrollbackOffset(activeTranscriptRows())
                TerminalDoubleTapAction.JumpBottom -> setScrollbackOffset(0)
            }
            cancelInertia()
            return true
        }

        override fun onLongPress(e: MotionEvent) {
            beginSelection(e)
        }
    }

    private inner class TerminalSelectionActionMode : ActionMode.Callback {
        override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
            menu.add(0, CopyMenuItemId, 0, "Copy").setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
            menu.add(0, OpenBrowserMenuItemId, 1, "Open in browser").setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
            return true
        }

        override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean = false

        override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
            return when (item.itemId) {
                CopyMenuItemId -> {
                    copySelection()
                    true
                }
                OpenBrowserMenuItemId -> {
                    openSelectedText()
                    true
                }
                else -> false
            }
        }

        override fun onDestroyActionMode(mode: ActionMode) {
            if (selectionActionMode === mode) selectionActionMode = null
        }
    }

    private companion object {
        private const val MouseWheelRows = 3
        private const val InertiaDecay = 0.92f
        private const val InertiaMinVelocityPxPerSecond = 50f
        private const val InertiaMaxFrameMs = 32L
        private const val CopyMenuItemId = 1
        private const val OpenBrowserMenuItemId = 2
    }
}
