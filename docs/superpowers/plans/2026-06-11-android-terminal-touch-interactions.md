# Android Terminal Touch Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Android terminal inertial scrolling, double-tap top/bottom navigation, long-press selection/copy, and safe HTTP(S) URL opening.

**Architecture:** Keep the change in the Android terminal view path. Pure helpers own gesture math, URL hit testing, and selection range normalization; `GoblinTerminalView` owns touch/render integration; `TerminalScreen` owns Android browser and clipboard side effects.

**Tech Stack:** Kotlin, Android View, Jetpack Compose `AndroidView`, Termux `TerminalEmulator`/`TerminalRenderer`, JUnit 4, Android system `Intent` and `ClipboardManager`.

---

## Scope Notes

This plan intentionally omits version-control write steps. The repository instructions say not to plan or execute version-control writes unless the user explicitly asks.

This plan does not change SSH, PTY, session manager, foreground service, reconnect, remote resize semantics, or Android terminal font/layout policy.

## File Structure

- Create: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalTouchInteractionState.kt`
  - Pure helper types and functions for terminal cells, selection ranges, touch slop decisions, double-tap action, and inertial velocity decay.
- Create: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalUrlHitTester.kt`
  - Pure HTTP(S) URL validation and line hit testing.
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`
  - Integrate gesture detector, velocity tracker, inertia animation, selection highlight, floating Copy action, URL single-tap, and callbacks.
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/AndroidTerminalViewport.kt`
  - Pass URL/copy callbacks into `GoblinTerminalView`.
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`
  - Implement Android default-browser open and system clipboard copy.
- Create: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalTouchInteractionStateTest.kt`
  - Unit tests for coordinate conversion, selection range, double-tap action, and inertia helpers.
- Create: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalUrlHitTesterTest.kt`
  - Unit tests for HTTP(S) URL validation and hit testing.

## Task 1: Pure Touch State Helpers

**Files:**
- Create: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalTouchInteractionState.kt`
- Create: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalTouchInteractionStateTest.kt`

- [ ] **Step 1: Write failing tests for terminal cell mapping, selection ranges, double-tap actions, and inertia decay**

Create `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalTouchInteractionStateTest.kt`:

```kotlin
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
```

- [ ] **Step 2: Run the focused test to confirm it fails**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.TerminalTouchInteractionStateTest"
```

Expected: fails to compile because `TerminalCell`, `TerminalSelectionRange`, `terminalCellAt`, `terminalWithinTouchSlop`, `TerminalDoubleTapAction`, and `terminalDecayInertiaVelocity` are not defined.

- [ ] **Step 3: Implement pure touch helpers**

Create `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalTouchInteractionState.kt`:

```kotlin
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
```

- [ ] **Step 4: Run the focused test to confirm it passes**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.TerminalTouchInteractionStateTest"
```

Expected: `BUILD SUCCESSFUL`.

## Task 2: HTTP(S) URL Hit Testing

**Files:**
- Create: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalUrlHitTester.kt`
- Create: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalUrlHitTesterTest.kt`

- [ ] **Step 1: Write failing URL hit-testing tests**

Create `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalUrlHitTesterTest.kt`:

```kotlin
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
```

- [ ] **Step 2: Run the URL tests to confirm they fail**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.TerminalUrlHitTesterTest"
```

Expected: fails to compile because `terminalUrlAtColumn` and `terminalSafeExternalUrl` are not defined.

- [ ] **Step 3: Implement URL validation and hit testing**

Create `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalUrlHitTester.kt`:

```kotlin
package dev.goblin.android.ui.screens.terminals

private const val TerminalMaxExternalUrlLength = 4096

private val TerminalHttpUrlRegex = Regex("""https?://[^\s<>"'`()\[\]{}]+""")
private val TerminalTrailingPunctuation = setOf('.', ',', ';', ':', '!', '?')

internal fun terminalUrlAtColumn(line: String, column: Int): String? {
    if (column < 0) return null
    for (match in TerminalHttpUrlRegex.findAll(line)) {
        if (column !in match.range) continue
        return terminalSafeExternalUrl(match.value.trimTerminalUrlTrailingPunctuation())
    }
    return null
}

internal fun terminalSafeExternalUrl(value: String): String? {
    if (value.isBlank() || value.length > TerminalMaxExternalUrlLength) return null
    if (value.any { it.code < 0x20 || it.code == 0x7f }) return null
    return try {
        val parsed = java.net.URI(value)
        when (parsed.scheme?.lowercase()) {
            "http",
            "https",
            -> value
            else -> null
        }
    } catch (_: Exception) {
        null
    }
}

private fun String.trimTerminalUrlTrailingPunctuation(): String {
    var end = length
    while (end > 0 && this[end - 1] in TerminalTrailingPunctuation) end -= 1
    return substring(0, end)
}
```

- [ ] **Step 4: Run the URL tests to confirm they pass**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.TerminalUrlHitTesterTest"
```

Expected: `BUILD SUCCESSFUL`.

## Task 3: Android System Callbacks

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/AndroidTerminalViewport.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`

- [ ] **Step 1: Add callback parameters through the Compose viewport**

Modify `AndroidTerminalViewport` signature:

```kotlin
internal fun AndroidTerminalViewport(
    modifier: Modifier = Modifier,
    state: TerminalSessionState,
    emulatorController: RemoteTerminalEmulatorController?,
    fitToScreen: Boolean,
    fontSizeSp: Int,
    onOpenUrl: (String) -> Unit,
    onCopyText: (String) -> Boolean,
)
```

In both `factory` and `update` blocks, call a new view method:

```kotlin
setExternalInteractions(
    onOpenUrl = onOpenUrl,
    onCopyText = onCopyText,
)
```

- [ ] **Step 2: Add callback storage to `GoblinTerminalView`**

Modify `GoblinTerminalView.kt` near existing fields:

```kotlin
private var onOpenUrl: (String) -> Unit = {}
private var onCopyText: (String) -> Boolean = { false }
```

Add this public method inside `GoblinTerminalView`:

```kotlin
fun setExternalInteractions(
    onOpenUrl: (String) -> Unit,
    onCopyText: (String) -> Boolean,
) {
    this.onOpenUrl = onOpenUrl
    this.onCopyText = onCopyText
}
```

- [ ] **Step 3: Implement URL open and selection copy callbacks in `TerminalScreen`**

Add imports to `TerminalScreen.kt`:

```kotlin
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
```

Inside `TerminalScreen`, after `val activeTerminalPath = remotePath.ifBlank { "/" }`, add:

```kotlin
fun openTerminalUrl(url: String) {
    val safeUrl = terminalSafeExternalUrl(url)
    if (safeUrl == null) {
        inputNotice = "URL is not supported."
        return
    }
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(safeUrl)))
        inputNotice = null
    } catch (_: ActivityNotFoundException) {
        inputNotice = "No browser available."
    } catch (_: Exception) {
        inputNotice = "Could not open URL."
    }
}

fun copyTerminalSelection(text: String): Boolean {
    if (text.isBlank()) {
        inputNotice = "Selection is empty."
        return false
    }
    return try {
        val manager = ContextCompat.getSystemService(context, ClipboardManager::class.java)
        if (manager == null) {
            inputNotice = "Copy failed."
            false
        } else {
            manager.setPrimaryClip(ClipData.newPlainText("Goblin terminal selection", text))
            inputNotice = "Copied."
            true
        }
    } catch (_: Exception) {
        inputNotice = "Copy failed."
        false
    }
}
```

Update the `AndroidTerminalViewport` call:

```kotlin
AndroidTerminalViewport(
    modifier = Modifier.weight(1f),
    state = terminalState,
    emulatorController = emulatorController,
    fitToScreen = fitToScreen,
    fontSizeSp = terminalFontSizeSp,
    onOpenUrl = ::openTerminalUrl,
    onCopyText = ::copyTerminalSelection,
)
```

- [ ] **Step 4: Compile Android Kotlin**

Run:

```bash
cd "android"
./gradlew ":app:compileDebugKotlin"
```

Expected: `BUILD SUCCESSFUL`.

## Task 4: Inertial Scroll And Double-Tap Navigation

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`

- [ ] **Step 1: Add Android gesture and velocity imports**

Add imports:

```kotlin
import android.view.GestureDetector
import android.view.VelocityTracker
import android.view.ViewConfiguration
import kotlin.math.abs
```

- [ ] **Step 2: Add gesture fields**

Add fields inside `GoblinTerminalView`:

```kotlin
private val viewConfiguration = ViewConfiguration.get(context)
private val gestureDetector = GestureDetector(context, TerminalGestureListener())
private var velocityTracker: VelocityTracker? = null
private var inertiaVelocity = TerminalInertiaVelocity.Zero
private var inertiaFramePosted = false
private var lastInertiaFrameMs = 0L
```

Add constants in the companion object:

```kotlin
private const val InertiaDecay = 0.92f
private const val InertiaMinVelocityPxPerSecond = 50f
private const val InertiaMaxFrameMs = 32L
```

- [ ] **Step 3: Add inertia control methods**

Add methods inside `GoblinTerminalView`:

```kotlin
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
    val now = android.os.SystemClock.uptimeMillis()
    val elapsedMs = if (lastInertiaFrameMs == 0L) 16L else (now - lastInertiaFrameMs).coerceIn(1L, InertiaMaxFrameMs)
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
```

- [ ] **Step 4: Wire velocity tracking into `onTouchEvent`**

At the start of `onTouchEvent`, after the controller null check:

```kotlin
gestureDetector.onTouchEvent(event)
```

In `ACTION_DOWN`, add:

```kotlin
cancelInertia()
velocityTracker?.recycle()
velocityTracker = VelocityTracker.obtain().also { it.addMovement(event) }
```

In `ACTION_MOVE`, add before returning:

```kotlin
velocityTracker?.addMovement(event)
```

In `ACTION_UP`, before clearing touch fields:

```kotlin
velocityTracker?.apply {
    addMovement(event)
    computeCurrentVelocity(1000)
    startInertia(
        verticalPxPerSecond = yVelocity,
        horizontalPxPerSecond = xVelocity,
    )
    recycle()
}
velocityTracker = null
```

In `ACTION_CANCEL`, add:

```kotlin
velocityTracker?.recycle()
velocityTracker = null
cancelInertia()
```

- [ ] **Step 5: Add double-tap gesture listener**

Add inner class inside `GoblinTerminalView`:

```kotlin
private inner class TerminalGestureListener : GestureDetector.SimpleOnGestureListener() {
    override fun onDown(e: MotionEvent): Boolean = true

    override fun onDoubleTap(e: MotionEvent): Boolean {
        if (controller == null || touchScrolled) return false
        when (terminalDoubleTapAction(yPx = e.y, heightPx = height)) {
            TerminalDoubleTapAction.JumpTop -> setScrollbackOffset(activeTranscriptRows())
            TerminalDoubleTapAction.JumpBottom -> setScrollbackOffset(0)
        }
        cancelInertia()
        return true
    }
}
```

- [ ] **Step 6: Run terminal UI tests and compile**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.*"
./gradlew ":app:compileDebugKotlin"
```

Expected: both commands finish with `BUILD SUCCESSFUL`.

## Task 5: URL Single-Tap Integration

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`

- [ ] **Step 1: Add visible line lookup helpers**

Add methods inside `GoblinTerminalView`:

```kotlin
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
```

- [ ] **Step 2: Extend the gesture listener for single-tap URL opening**

Add to `TerminalGestureListener`:

```kotlin
override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
    if (controller == null || touchScrolled) return false
    if (openUrlAtEvent(e)) return true
    return false
}
```

- [ ] **Step 3: Guard double-tap against URL hits**

Update `onDoubleTap`:

```kotlin
override fun onDoubleTap(e: MotionEvent): Boolean {
    if (controller == null || touchScrolled) return false
    val cell = terminalCellForEvent(e)
    if (cell != null && terminalUrlAtColumn(terminalLineText(cell.row), cell.column) != null) return false
    when (terminalDoubleTapAction(yPx = e.y, heightPx = height)) {
        TerminalDoubleTapAction.JumpTop -> setScrollbackOffset(activeTranscriptRows())
        TerminalDoubleTapAction.JumpBottom -> setScrollbackOffset(0)
    }
    cancelInertia()
    return true
}
```

- [ ] **Step 4: Run URL tests and compile**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.TerminalUrlHitTesterTest"
./gradlew ":app:compileDebugKotlin"
```

Expected: both commands finish with `BUILD SUCCESSFUL`.

## Task 6: Long-Press Selection And Copy

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`

- [ ] **Step 1: Add selection imports and fields**

Add imports:

```kotlin
import android.graphics.Paint
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
```

Add fields:

```kotlin
private val selectionPaint = Paint().apply { color = 0x663B82F6 }
private var selectionRange: TerminalSelectionRange? = null
private var selectionActionMode: ActionMode? = null
```

Add companion constants:

```kotlin
private const val CopyMenuItemId = 1
```

- [ ] **Step 2: Add selection lifecycle helpers**

Add methods:

```kotlin
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
    val cell = terminalCellForEvent(event) ?: return
    selectionRange = current.copy(end = cell)
        .normalized()
        .clamped(
            columns = controller?.emulator?.mColumns ?: 0,
            rows = controller?.emulator?.mRows ?: 0,
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
```

- [ ] **Step 3: Draw selection highlight**

In `onDraw`, after `renderer.render(...)` and before `canvas.restoreToCount(checkpoint)`, add:

```kotlin
drawSelection(canvas)
```

Add the drawing method:

```kotlin
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
```

- [ ] **Step 4: Add floating Copy action mode**

Add inner class:

```kotlin
private inner class TerminalSelectionActionMode : ActionMode.Callback {
    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
        menu.add(0, CopyMenuItemId, 0, "Copy").setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
        return true
    }

    override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean = false

    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
        if (item.itemId != CopyMenuItemId) return false
        copySelection()
        return true
    }

    override fun onDestroyActionMode(mode: ActionMode) {
        if (selectionActionMode === mode) selectionActionMode = null
    }
}
```

- [ ] **Step 5: Wire long press and drag adjustment**

Add to `TerminalGestureListener`:

```kotlin
override fun onLongPress(e: MotionEvent) {
    beginSelection(e)
}
```

In `ACTION_MOVE`, before normal scroll handling:

```kotlin
if (selectionRange != null) {
    updateSelection(event)
    return true
}
```

In `ACTION_UP`, before `performClick()`:

```kotlin
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
```

In `ACTION_DOWN`, before initializing drag:

```kotlin
if (selectionRange != null) {
    clearSelection()
    return true
}
```

- [ ] **Step 6: Clear selection on bind, detach, size/controller changes**

Call `clearSelection()` from:

- `bind(...)` before resetting offsets when the controller changes;
- `onDetachedFromWindow()`;
- `ACTION_CANCEL`.

Do not call `clearSelection()` from `onTerminalScreenUpdated()`. Instead clamp during draw/copy so selection survives output refresh.

- [ ] **Step 7: Run terminal helper tests and compile**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.TerminalTouchInteractionStateTest"
./gradlew ":app:compileDebugKotlin"
```

Expected: both commands finish with `BUILD SUCCESSFUL`.

## Task 7: Full Verification

**Files:**
- No new production files.
- Validate all changed terminal UI files.

- [ ] **Step 1: Run all terminal screen JVM tests**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.*"
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 2: Run Android Kotlin compilation**

Run:

```bash
cd "android"
./gradlew ":app:compileDebugKotlin"
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Run broader Android unit tests**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest"
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Manual Android verification**

On an Android device or emulator:

1. Open a connected SSH terminal.
2. Produce long output with `seq 1 300`.
3. Drag upward and release; verify inertial scroll continues and stops at the top.
4. Drag downward and release; verify inertial scroll returns toward bottom and stops naturally.
5. Double-tap upper half; verify the view jumps to the top of scrollback.
6. Double-tap lower half; verify the view jumps to the bottom.
7. Run `printf 'https://example.com/path\n'`; single-tap the URL and verify the default browser opens.
8. Run `printf 'file:///tmp/a ssh://example.com mailto:dev@example.com\n'`; verify tapping does not open a browser.
9. Long-press terminal text, drag selection, tap Copy, and paste into another app; verify copied content.
10. Switch sessions or leave/re-enter the terminal; verify stale selection and inertia do not persist.

## Self-Review Checklist

- Spec coverage:
  - Inertial vertical scroll: Task 1 and Task 4.
  - Original-width horizontal inertia: Task 4.
  - Double-tap top/bottom: Task 1 and Task 4.
  - Long-press selection and Copy: Task 1, Task 3, and Task 6.
  - HTTP(S) URL open only: Task 2, Task 3, and Task 5.
  - No SSH/session/runtime changes: all tasks stay in Android terminal UI files.
- Placeholder scan: no undefined requirements are left for the implementer.
- Type consistency:
  - `TerminalCell`, `TerminalSelectionRange`, `TerminalInertiaVelocity`, `TerminalDoubleTapAction`, `terminalCellAt`, `terminalUrlAtColumn`, and `terminalSafeExternalUrl` are introduced before use.
  - `onOpenUrl: (String) -> Unit` and `onCopyText: (String) -> Boolean` match the design document and every call site.

