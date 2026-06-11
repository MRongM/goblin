# Android Terminal Selection Input Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Android terminal selected-text browser actions, native command-input editing, terminal Backspace helper key, and corrected bottom control ordering/layout.

**Architecture:** Keep the work in Android UI boundaries. `GoblinTerminalView` owns terminal selection and delegates selected text actions; `TerminalScreen` owns Android clipboard/browser intents and layout; `TerminalInteractionState.kt` owns small pure helpers and testable ordering/filtering behavior.

**Tech Stack:** Kotlin, Jetpack Compose Material3/Foundation, Android `Intent`, Termux terminal emulator/view, JUnit.

---

## Planning Notes

- Source spec: `docs/superpowers/specs/2026-06-11-android-terminal-selection-input-controls-design.md`.
- Per `AGENTS.md`, do not run `git commit` unless the user explicitly asks. This plan intentionally omits commit steps even though the generic planning skill often recommends them.
- Keep edits scoped to Android UI and tests. Do not change SSHJ, PTY, terminal session ownership, reconnect, persistence, or foreground service lifecycle.

## File Structure

- Modify `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionState.kt`
  - Add pure selected-text browser action helper.
  - Add Backspace label to helper key rows.
  - Add pure command input visibility defaults and menu labels.
  - Keep workspace/global terminal filtering semantics testable.

- Modify `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionStateTest.kt`
  - Cover selected-text browser action resolution.
  - Cover helper key row ordering with `⌫`.
  - Cover same-workspace same-path switching semantics.

- Modify `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`
  - Extend selection `ActionMode` with `Open in browser`.
  - Add callback for selected-text browser action.
  - Show the Android soft keyboard when the user taps terminal content for direct input.

- Modify `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/AndroidTerminalViewport.kt`
  - Pass selected-text browser callback into `GoblinTerminalView`.

- Modify `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`
  - Add Android browser/search dispatch.
  - Reorder helper key rows above command input.
  - Add terminal Backspace helper action.
  - Make bottom action row horizontally scrollable.
  - Order bottom action row as `⇈`, `⇊`, `↑`, `↓`, optional `Restore`, `Reconnect`, `Close`.
  - Increase switch arrow button practical size.
  - Improve command input selection/editing behavior.
  - Hide command input by default and add a top-right menu toggle.

## Task 7: Direct Terminal Input and Optional Command Input

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionState.kt`
- Modify: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionStateTest.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`

- [ ] **Step 1: Add command input visibility tests**

Add tests in `TerminalInteractionStateTest`:

```kotlin
    @Test
    fun `command input is hidden by default`() {
        assertFalse(TerminalCommandInputDefaultVisible)
    }

    @Test
    fun `command input visibility menu label reflects state`() {
        assertEquals("Show command input", terminalCommandInputVisibilityActionLabel(visible = false))
        assertEquals("Hide command input", terminalCommandInputVisibilityActionLabel(visible = true))
    }
```

- [ ] **Step 2: Implement command input visibility helpers**

Add in `TerminalInteractionState.kt` near command input helpers:

```kotlin
internal const val TerminalCommandInputDefaultVisible = false

internal fun terminalCommandInputVisibilityActionLabel(visible: Boolean): String =
    if (visible) "Hide command input" else "Show command input"
```

- [ ] **Step 3: Show keyboard on terminal tap**

In `GoblinTerminalView`, import `android.view.inputmethod.InputMethodManager`.

Add:

```kotlin
    private fun showSoftKeyboard() {
        requestFocus()
        post {
            context.getSystemService(InputMethodManager::class.java)
                ?.showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
        }
    }
```

In `TerminalGestureListener.onSingleTapConfirmed(...)`, if URL opening does not handle the tap, call `showSoftKeyboard()` and return `true`.

- [ ] **Step 4: Add screen-local command input visibility**

In `TerminalScreen`, add:

```kotlin
    var commandInputVisible by remember { mutableStateOf(TerminalCommandInputDefaultVisible) }
```

Add a top-right menu item:

```kotlin
                            DropdownMenuItem(
                                text = { Text(terminalCommandInputVisibilityActionLabel(commandInputVisible)) },
                                onClick = {
                                    commandInputVisible = !commandInputVisible
                                    terminalActionMenuExpanded = false
                                },
                            )
```

Wrap the command input row with:

```kotlin
                if (commandInputVisible) {
                    Row(...)
                }
```

- [ ] **Step 5: Verify**

Run:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.ui.screens.terminals.TerminalInteractionStateTest"
./gradlew :app:testDebugUnitTest
bun run typecheck
bun run test
```

Expected: all commands pass.

## Task 1: Pure Browser Action and Helper Key Tests

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionState.kt`
- Modify: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalInteractionStateTest.kt`

- [ ] **Step 1: Write failing selected-text browser action tests**

Append these tests inside `TerminalInteractionStateTest` before the private `terminalRecord(...)` helper:

```kotlin
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
```

- [ ] **Step 2: Update failing helper key row tests**

Replace the existing `helper key labels hide quick yes and no inputs` test body with:

```kotlin
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
```

Replace the existing `helper key labels render in two rows` test body with:

```kotlin
    @Test
    fun `helper key labels render in two rows`() {
        val rows = terminalHelperKeyRows(ctrlModifierActive = false)

        assertEquals(2, rows.size)
        assertEquals(listOf("ENTER", "⌫", "CTRL+C", "CTRL+L", "Tab", "Esc"), rows[0])
        assertEquals(listOf("Ctrl", "Up", "Down", "Left", "Right", "Paste"), rows[1])
    }
```

- [ ] **Step 3: Add same-workspace same-path switching test**

Append this test near the existing global/session cycle tests:

```kotlin
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
```

- [ ] **Step 4: Run the narrow failing tests**

Run:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.ui.screens.terminals.TerminalInteractionStateTest"
```

Expected before implementation:

- Fails because `TerminalSelectedTextBrowserAction`, `TerminalSelectedTextMaxLength`, and `terminalSelectedTextBrowserAction(...)` do not exist.
- Fails because helper key rows do not include `⌫`.

- [ ] **Step 5: Implement pure helpers and helper key labels**

In `TerminalInteractionState.kt`, add `java.net.URI` import:

```kotlin
import java.net.URI
```

Replace `terminalHelperKeyLabels(...)` with:

```kotlin
internal fun terminalHelperKeyLabels(ctrlModifierActive: Boolean): List<String> =
    listOf(
        "ENTER",
        "⌫",
        "CTRL+C",
        "CTRL+L",
        "Tab",
        "Esc",
        if (ctrlModifierActive) "Ctrl on" else "Ctrl",
        "Up",
        "Down",
        "Left",
        "Right",
        "Paste",
    )
```

Add this pure browser action model near `terminalLineInput(...)`:

```kotlin
internal const val TerminalSelectedTextMaxLength = 4096

internal sealed interface TerminalSelectedTextBrowserAction {
    data class OpenUrl(val url: String) : TerminalSelectedTextBrowserAction
    data class Search(val query: String) : TerminalSelectedTextBrowserAction
}

internal fun terminalSelectedTextBrowserAction(
    selectedText: String,
    maxLength: Int = TerminalSelectedTextMaxLength,
): TerminalSelectedTextBrowserAction? {
    val normalized = selectedText
        .trim()
        .replace(Regex("\\s+"), " ")
        .take(maxLength.coerceAtLeast(1))
    if (normalized.isBlank()) return null

    return terminalDirectBrowserUrl(normalized)
        ?.let(TerminalSelectedTextBrowserAction::OpenUrl)
        ?: TerminalSelectedTextBrowserAction.Search(normalized)
}

private fun terminalDirectBrowserUrl(value: String): String? {
    if (value.any { it.isWhitespace() || it.isISOControl() }) return null
    val uri = runCatching { URI(value) }.getOrNull() ?: return null
    val scheme = uri.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") return null
    if (uri.host.isNullOrBlank()) return null
    return value
}
```

- [ ] **Step 6: Re-run the narrow tests**

Run:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.ui.screens.terminals.TerminalInteractionStateTest"
```

Expected:

- `TerminalInteractionStateTest` passes.

## Task 2: Terminal Selection Menu Browser Action

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/AndroidTerminalViewport.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`

- [ ] **Step 1: Add selected-text browser callback to `GoblinTerminalView`**

In `GoblinTerminalView`, add a property beside `onCopyText`:

```kotlin
    private var onOpenSelectedText: (String) -> Boolean = { false }
```

Replace `setExternalInteractions(...)` with:

```kotlin
    fun setExternalInteractions(
        onOpenUrl: (String) -> Unit,
        onCopyText: (String) -> Boolean,
        onOpenSelectedText: (String) -> Boolean,
    ) {
        this.onOpenUrl = onOpenUrl
        this.onCopyText = onCopyText
        this.onOpenSelectedText = onOpenSelectedText
    }
```

- [ ] **Step 2: Add selected-text open action**

Add this method below `copySelection()`:

```kotlin
    private fun openSelectedText(): Boolean {
        val text = selectedText()
        if (text.isBlank()) return false
        val opened = onOpenSelectedText(text)
        if (opened) clearSelection()
        return opened
    }
```

Replace `TerminalSelectionActionMode` with:

```kotlin
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
```

Add the new constant:

```kotlin
        private const val OpenBrowserMenuItemId = 2
```

- [ ] **Step 3: Thread callback through `AndroidTerminalViewport`**

In `AndroidTerminalViewport(...)`, add a parameter:

```kotlin
    onOpenSelectedText: (String) -> Boolean,
```

Update both `setExternalInteractions(...)` calls:

```kotlin
                            setExternalInteractions(
                                onOpenUrl = onOpenUrl,
                                onCopyText = onCopyText,
                                onOpenSelectedText = onOpenSelectedText,
                            )
```

```kotlin
                        view.setExternalInteractions(
                            onOpenUrl = onOpenUrl,
                            onCopyText = onCopyText,
                            onOpenSelectedText = onOpenSelectedText,
                        )
```

- [ ] **Step 4: Add browser/search dispatch to `TerminalScreen`**

Add imports:

```kotlin
import android.app.SearchManager
```

Add this function below `copyTerminalSelection(...)`:

```kotlin
    fun openSelectedTerminalText(text: String): Boolean {
        val action = terminalSelectedTextBrowserAction(text)
        if (action == null) {
            inputNotice = "Selection is empty."
            return false
        }
        return when (action) {
            is TerminalSelectedTextBrowserAction.OpenUrl -> openTerminalUrl(action.url)
            is TerminalSelectedTextBrowserAction.Search -> searchTerminalText(action.query)
        }
    }
```

Change `openTerminalUrl(...)` from `Unit` to `Boolean`:

```kotlin
    fun openTerminalUrl(url: String): Boolean {
        val safeUrl = terminalSafeExternalUrl(url)
        if (safeUrl == null) {
            inputNotice = "URL is not supported."
            return false
        }
        return try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(safeUrl)))
            inputNotice = null
            true
        } catch (_: ActivityNotFoundException) {
            inputNotice = "No browser available."
            false
        } catch (_: Exception) {
            inputNotice = "Could not open browser."
            false
        }
    }
```

Add search function below `openTerminalUrl(...)`:

```kotlin
    fun searchTerminalText(query: String): Boolean {
        if (query.isBlank()) {
            inputNotice = "Selection is empty."
            return false
        }
        return try {
            context.startActivity(
                Intent(Intent.ACTION_WEB_SEARCH)
                    .putExtra(SearchManager.QUERY, query),
            )
            inputNotice = null
            true
        } catch (_: ActivityNotFoundException) {
            inputNotice = "No browser available."
            false
        } catch (_: Exception) {
            inputNotice = "Could not open browser."
            false
        }
    }
```

Update `AndroidTerminalViewport(...)` call:

```kotlin
                    onOpenUrl = { openTerminalUrl(it) },
                    onCopyText = ::copyTerminalSelection,
                    onOpenSelectedText = ::openSelectedTerminalText,
```

- [ ] **Step 5: Run Android terminal tests**

Run:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.ui.screens.terminals.*"
```

Expected:

- Tests compile and pass.

## Task 3: Command Input Native Editing State

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`

- [ ] **Step 1: Update imports**

Remove unused `BasicTextField` import only if the compiler says it is unused after the edit. Add:

```kotlin
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
```

- [ ] **Step 2: Replace `CompactCommandInput(...)` with TextFieldValue-backed implementation**

Replace the entire `CompactCommandInput(...)` composable with:

```kotlin
@Composable
private fun CompactCommandInput(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    placeholder: String,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val textColor = if (enabled) {
        GoblinColors.TerminalInputForeground
    } else {
        GoblinColors.TerminalDisabledForeground
    }
    var fieldValue by remember {
        mutableStateOf(TextFieldValue(text = value, selection = TextRange(value.length)))
    }

    LaunchedEffect(value) {
        if (value != fieldValue.text) {
            fieldValue = TextFieldValue(text = value, selection = TextRange(value.length))
        }
    }

    BasicTextField(
        value = fieldValue,
        onValueChange = { next ->
            fieldValue = next
            if (next.text != value) onValueChange(next.text)
        },
        enabled = enabled,
        singleLine = true,
        textStyle = MaterialTheme.typography.bodySmall.copy(color = textColor),
        cursorBrush = SolidColor(GoblinColors.TerminalActionForeground),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
        keyboardActions = KeyboardActions(onSend = { onSend() }),
        modifier = modifier
            .height(TerminalCommandInputHeight)
            .background(GoblinColors.TerminalInputBackground, TerminalCommandInputShape)
            .border(1.dp, GoblinColors.TerminalInputBorder, TerminalCommandInputShape),
        decorationBox = { innerTextField ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 10.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (fieldValue.text.isEmpty()) {
                    Text(
                        text = placeholder,
                        color = GoblinColors.TerminalInputPlaceholder,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                innerTextField()
            }
        },
    )
}
```

- [ ] **Step 3: Compile terminal screen**

Run:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.ui.screens.terminals.TerminalInteractionStateTest"
```

Expected:

- Kotlin compile succeeds.
- `TerminalInteractionStateTest` passes.

## Task 4: Helper Keys, Backspace, and Layout Order

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`

- [ ] **Step 1: Add Backspace to `HelperKeyRow` contract**

Change the `HelperKeyRow(...)` signature:

```kotlin
private fun HelperKeyRow(
    enabled: Boolean,
    ctrlModifierActive: Boolean,
    onCtrlToggle: () -> Unit,
    onCtrlC: () -> Unit,
    onCtrlL: () -> Unit,
    onEnter: () -> Unit,
    onBackspace: () -> Unit,
    onEsc: () -> Unit,
    onTab: () -> Unit,
    onArrow: (String) -> Unit,
    onPaste: () -> Unit,
)
```

Replace the `actions` list with:

```kotlin
    val actions = listOf<() -> Unit>(
        onEnter,
        onBackspace,
        onCtrlC,
        onCtrlL,
        onTab,
        onEsc,
        onCtrlToggle,
        { onArrow("\u001b[A") },
        { onArrow("\u001b[B") },
        { onArrow("\u001b[D") },
        { onArrow("\u001b[C") },
        onPaste,
    )
```

- [ ] **Step 2: Move `HelperKeyRow` above command input**

Inside the main terminal `Column`, place `HelperKeyRow(...)` immediately after `AndroidTerminalViewport(...)` and before the `Row` that contains `CompactCommandInput(...)` and `Send`.

Use this call:

```kotlin
                HelperKeyRow(
                    enabled = inputAvailable,
                    ctrlModifierActive = ctrlModifierActive,
                    onCtrlToggle = { ctrlModifierActive = !ctrlModifierActive },
                    onCtrlC = { sendControlInput("\u0003") },
                    onCtrlL = { sendControlInput(terminalControlCharacter('L') ?: "\u000C") },
                    onEnter = { sendTerminalInputLocked("\r", false, { _ -> }) },
                    onBackspace = { sendTerminalInputLocked("\u007F", false, { _ -> }) },
                    onEsc = { sendTerminalInputLocked("\u001b", false, { _ -> }) },
                    onTab = { sendTerminalInputLocked("\t", false, { _ -> }) },
                    onArrow = { code -> sendTerminalInputLocked(code, false, { _ -> }) },
                    onPaste = {
                        val unavailable = terminalInputUnavailableMessage(terminalState)
                        if (unavailable != null) {
                            inputNotice = unavailable
                            return@HelperKeyRow
                        }
                        scope.launch {
                            val text = clipboard.getClipEntry()
                                ?.clipData
                                ?.getItemAt(0)
                                ?.coerceToText(context)
                                ?.toString()
                                .orEmpty()
                            val pasted = withContext(Dispatchers.IO) {
                                activeSessionId?.let { terminalSessionManager.paste(it, text) } ?: false
                            }
                            syncTerminalForeground()
                            inputNotice = if (pasted) null else "Terminal is not connected."
                        }
                    },
                )
```

Remove the old `HelperKeyRow(...)` call below the input row.

- [ ] **Step 3: Run focused tests**

Run:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.ui.screens.terminals.TerminalInteractionStateTest"
```

Expected:

- Helper key row tests pass.
- Kotlin compile succeeds with the updated `HelperKeyRow` signature.

## Task 5: Bottom Action Row Order and Scroll

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`

- [ ] **Step 1: Add arrow sizing imports and constants**

Add imports:

```kotlin
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp
```

Add constants near `TerminalActionButtonHeight`:

```kotlin
private val TerminalSwitchArrowButtonMinWidth = 38.dp
private val TerminalSwitchArrowFontSize = 18.sp
```

- [ ] **Step 2: Allow `TerminalTextButton` custom text style**

Replace `TerminalTextButton(...)` with:

```kotlin
@Composable
private fun TerminalTextButton(
    text: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    textStyle: TextStyle = MaterialTheme.typography.labelMedium,
) {
    TextButton(
        modifier = modifier.height(TerminalActionButtonHeight),
        enabled = enabled,
        onClick = onClick,
        colors = ButtonDefaults.textButtonColors(
            contentColor = GoblinColors.TerminalActionForeground,
            disabledContentColor = GoblinColors.TerminalDisabledForeground,
        ),
    ) {
        Text(
            text = text,
            style = textStyle,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
```

Add a small wrapper below it:

```kotlin
@Composable
private fun TerminalSwitchArrowButton(
    text: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    TerminalTextButton(
        text = text,
        enabled = enabled,
        onClick = onClick,
        modifier = Modifier.widthIn(min = TerminalSwitchArrowButtonMinWidth),
        textStyle = MaterialTheme.typography.labelLarge.copy(fontSize = TerminalSwitchArrowFontSize),
    )
}
```

- [ ] **Step 3: Make bottom row horizontally scrollable and reorder buttons**

Replace the bottom action `Row(...)` with:

```kotlin
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
                ) {
                    if (hasGlobalSwitchTargets) {
                        TerminalSwitchArrowButton(text = "⇈", onClick = { cycleGlobalProjectTerminal(-1) })
                        TerminalSwitchArrowButton(text = "⇊", onClick = { cycleGlobalProjectTerminal(1) })
                    }
                    if (hasWorkspaceSwitchTargets) {
                        TerminalSwitchArrowButton(text = "↑", onClick = { cycleWorkspaceTerminal(-1) })
                        TerminalSwitchArrowButton(text = "↓", onClick = { cycleWorkspaceTerminal(1) })
                    }
                    if (terminalRestoreInlineActionVisible(terminalMaximized)) {
                        TerminalTextButton(
                            text = "Restore",
                            onClick = { terminalMaximized = false },
                        )
                    }
                    TerminalTextButton(
                        text = "Reconnect",
                        enabled = inlineActions.reconnectEnabled,
                        onClick = { connect() },
                    )
                    TerminalTextButton(
                        text = "Close",
                        enabled = inlineActions.closeEnabled,
                        onClick = { requestCloseTerminal() },
                    )
                }
```

- [ ] **Step 4: Verify switching semantics still use the right collections**

Confirm `cycleWorkspaceTerminal(...)` still uses:

```kotlin
        val availableSessions = terminalWorkspaceCreatedSessions(
            sessions = terminalSessions,
            hostIds = workspaceHostIds,
            remotePath = activeTerminalPath,
        )
```

Confirm `cycleGlobalProjectTerminal(...)` still uses:

```kotlin
        val availableSessions = terminalGlobalProjectCreatedSessions(terminalSessions)
```

Do not change those semantics.

- [ ] **Step 5: Run focused tests**

Run:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.ui.screens.terminals.TerminalInteractionStateTest"
```

Expected:

- Tests pass.
- Kotlin compile succeeds with new imports and button wrappers.

## Task 6: Final Verification

**Files:**
- All modified Android UI and test files.

- [ ] **Step 1: Run Android unit tests**

Run:

```bash
./gradlew :app:testDebugUnitTest
```

Expected:

- All Android unit tests pass.

- [ ] **Step 2: Run TypeScript typecheck**

Run:

```bash
bun run typecheck
```

Expected:

- Typecheck passes. This is mostly for the TypeScript/Electron side and should be unaffected by Android-only edits.

- [ ] **Step 3: Manual Android behavior checklist**

Install/run the Android app through the existing local workflow, then verify:

- Long-press terminal output selects text.
- Selection menu shows `Copy` and `Open in browser`.
- `Copy` copies selected terminal text and dismisses selection on success.
- `Open in browser` opens selected `http://` and `https://` URLs directly.
- `Open in browser` searches ordinary selected text.
- Long-press command input shows native edit operations such as paste/select/copy/cut.
- `⌫` helper key sends remote terminal backspace and does not mutate command input text.
- Helper key rows appear above the command input.
- Bottom action row order is `⇈`, `⇊`, `↑`, `↓`, optional `Restore`, `Reconnect`, `Close`.
- Bottom action row scrolls horizontally on narrow width instead of squeezing controls.
- `↑` and `↓` only switch among same-workspace same-path terminal sessions.
- `⇈` and `⇊` switch among global project terminal sessions.

- [ ] **Step 4: Report verification**

In the final implementation response, report:

- files changed;
- tests run and results;
- any verification that could not be performed;
- no commit was created unless the user explicitly requested one.
