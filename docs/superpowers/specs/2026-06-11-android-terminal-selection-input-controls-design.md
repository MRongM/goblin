# Android Terminal Selection, Input, and Controls Design

## Summary

Goblin Android terminal should improve native terminal interaction without changing SSH transport or session ownership:

- Terminal long-press selection shows a floating menu with `Copy` and `Open in browser`.
- `Open in browser` opens selected `http://` or `https://` URLs directly, and searches selected non-URL text in the browser.
- The command input supports native Android text editing interactions such as paste, select, copy, cut, cursor movement, and ordinary text editing.
- The terminal view supports direct IME input: tapping the terminal focuses the terminal and opens the soft keyboard, then typed text is sent directly to the remote terminal.
- The command input row is hidden by default and can be shown or hidden from the terminal screen's top-right menu.
- The helper key rows sit above the command input.
- A helper key `Backspace` sends terminal backspace to the remote terminal, not to the command input.
- The bottom action row is horizontally scrollable and orders global switching before workspace switching.
- The global double arrows `⇈` and `⇊` should render at a similar practical size to the single arrows `↑` and `↓`.

This is an Android UI-layer change. It must not change SSHJ, PTY allocation, reconnect, terminal persistence, foreground service behavior, terminal session identity, or remote I/O semantics.

## Goals

- Make terminal text selection useful beyond copying by adding browser open/search.
- Keep terminal selection behavior local to `GoblinTerminalView`, where terminal cell mapping already exists.
- Use Android/Compose native text editing behavior for the command input instead of relying on a custom paste-only workflow.
- Prefer direct terminal input for normal typing, while keeping the command input as an optional explicit mode.
- Add an explicit terminal `Backspace` helper key for remote shell editing.
- Preserve dense terminal controls while avoiding squeezed or clipped bottom-row actions on narrow screens.
- Clarify terminal switching semantics:
  - `⇈` and `⇊` switch among global project terminal sessions.
  - `↑` and `↓` switch only among multiple terminal sessions in the same workspace and same remote path.

## Non-Goals

- Do not rewrite `GoblinTerminalView`.
- Do not replace the Android native terminal renderer with WebView or xterm.
- Do not change terminal session creation, reconnect, heartbeat, persistence, or foreground service behavior.
- Do not change SSH host trust, SSH authentication, PTY type, or shell startup commands.
- Do not add terminal mouse mode.
- Do not redesign every terminal control or introduce a new bottom toolbar architecture.
- Do not make the helper key rows horizontally reorderable or configurable.

## Current State

The Android terminal path already has most of the required boundaries:

- `TerminalScreen` owns route state, terminal actions, clipboard copy, URL opening, helper keys, command input, and bottom action rows.
- `GoblinTerminalView` already behaves as an Android text editor through `onCreateInputConnection(...)`, but taps should explicitly surface the IME when the user intends to type into the terminal.
- `AndroidTerminalViewport` wraps `GoblinTerminalView` in Compose and passes callbacks for URL opening and selected-text copy.
- `GoblinTerminalView` renders the active `RemoteTerminalEmulatorController`, maps touch coordinates to terminal cells, supports selection, uses floating `ActionMode`, and currently exposes `Copy`.
- `TerminalInteractionState.kt` already contains helpers for workspace terminal filtering, global project terminal filtering, and session cycling.
- The command input is currently implemented with `BasicTextField`, which may not provide the expected Android long-press edit menu consistently.
- Helper key rows are currently rendered below the command input.
- The bottom action row can become cramped on narrow screens.

## Selected Approach

Use an incremental native approach.

Extend the existing `GoblinTerminalView` selection `ActionMode` from `Copy` only to `Copy` plus `Open in browser`. The view should continue to read selected text from the emulator and delegate side effects to callbacks owned by `TerminalScreen`.

Update `TerminalScreen` to own browser behavior:

- copy selected text to the Android clipboard;
- open selected URLs directly;
- search selected non-URL text through Android's web search path;
- show short failure notices without affecting the terminal session.

Update the command input with a Compose/Android text input path that supports native selection and editing menus while preserving the current compact visual treatment.

Update the helper/control rows in `TerminalScreen` without introducing a new toolbar abstraction.

This keeps the change small, follows the existing Android UI boundaries, and avoids unnecessary transport or runtime changes.

## Architecture

### `GoblinTerminalView`

Responsibilities retained:

- Render terminal emulator output.
- Map touch coordinates to terminal cells.
- Maintain selection range and draw selection highlights.
- Read selected text through `emulator.getSelectedText(...)`.
- Own terminal selection `ActionMode` lifecycle.

New responsibilities:

- Add an `Open in browser` menu item beside `Copy`.
- Invoke a new selected-text browser callback when the user selects `Open in browser`.

Non-responsibilities:

- It must not open Android activities directly.
- It must not search the web directly.
- It must not access the clipboard directly.
- It must not know whether selected text is a URL or search query.

### `AndroidTerminalViewport`

Responsibilities:

- Continue binding `GoblinTerminalView`.
- Pass `onCopyText` and the new selected-text browser callback from `TerminalScreen`.

### `TerminalScreen`

Responsibilities:

- Copy selected text to Android clipboard.
- Resolve selected text browser behavior:
  - direct open for `http://` and `https://` URLs;
  - browser search for non-URL selected text.
- Send terminal helper key input, including `Backspace`.
- Track command input visibility as screen-local state, defaulting to hidden.
- Arrange the terminal bottom controls in the confirmed order.
- Keep all UI notices and failure handling local to the screen.

### `CompactCommandInput`

Responsibilities:

- Provide a single-line compact command input.
- Preserve current terminal input colors, height, border, placeholder, and send behavior.
- Support native Android editing interactions: paste, select, copy, cut, cursor movement, and ordinary editing.

### `TerminalInteractionState`

Responsibilities:

- Preserve and test session filtering semantics.
- Ensure workspace switching uses same workspace and same remote path.
- Ensure global project switching excludes temporary terminals and remains sorted by creation.

## Interaction Model

### Terminal Selection Menu

Long-press terminal text enters selection mode. Dragging adjusts the selection endpoint.

The floating selection menu always includes:

- `Copy`;
- `Open in browser`.

`Copy` behavior:

- Reads selected text from the terminal emulator.
- Rejects blank selections.
- Copies to Android clipboard via `TerminalScreen`.
- Clears selection only after a successful copy.

`Open in browser` behavior:

- Reads the same selected text.
- Rejects blank selections.
- If selected text is a valid `http://` or `https://` URL, opens it directly through Android.
- Otherwise trims the selected text and sends it to browser search.
- Clears selection after the open/search action is successfully dispatched.
- Keeps selection active if dispatch fails, so the user can retry or copy.

### Command Input

The command input is hidden by default. It sits below the two helper key rows only when the user enables it from the terminal screen's top-right menu.

The menu item label is stateful:

- hidden input: `Show command input`;
- visible input: `Hide command input`.

This visibility is not persisted. Re-entering the terminal screen starts with the command input hidden.

The input supports Android-native text editing:

- long-press paste;
- text selection;
- copy;
- cut;
- cursor movement;
- normal deletion and editing inside the input field.

Input editing is separate from terminal helper keys. Deleting text inside the command input edits only the input text. Pressing helper-key `Backspace` sends terminal backspace to the remote shell.

`Send` behavior remains unchanged:

- clicking `Send` sends the full command input plus terminal line ending;
- IME send action does the same;
- successful send clears the command input;
- unavailable terminal input shows the existing unavailable-state notice.

### Direct Terminal Input

Tapping ordinary terminal content should focus `GoblinTerminalView` and request the Android soft keyboard.

Typing through the IME continues through the existing terminal input connection:

- committed text is converted with `terminalTextBytes(...)`;
- newlines become carriage returns;
- keyboard deletion sends terminal backspace bytes to the remote terminal.

Direct terminal typing must not require the optional command input row to be visible.

### Helper Key Rows

The two helper key rows are above the command input.

Confirmed order:

1. First helper row:
   - `Enter`
   - `⌫`
   - `Ctrl-C`
   - `Ctrl-L`
   - `Tab`
   - `Esc`

2. Second helper row:
   - `Ctrl`
   - `↑`
   - `↓`
   - `←`
   - `→`
   - `Paste`

`⌫` is the Backspace helper key. It sends remote terminal backspace, equivalent to pressing Backspace inside the terminal. It does not edit the command input.

The helper rows can keep their existing horizontal scroll behavior if the row exceeds screen width.

### Command Input Row

The command input row appears below the helper key rows:

- compact command input;
- `Send` button.

### Bottom Action Row

The bottom action row appears below the command input row and is horizontally scrollable.

Confirmed order:

1. `⇈`
2. `⇊`
3. `↑`
4. `↓`
5. `Restore`, only when restore is visible for maximized terminal state.
6. `Reconnect`
7. `Close`

Switching semantics:

- `⇈` and `⇊` switch among global project terminal sessions from `terminalGlobalProjectCreatedSessions(...)`.
- `↑` and `↓` switch only among sessions from `terminalWorkspaceCreatedSessions(...)` filtered by the current workspace host ids and current normalized remote path.
- `↑` and `↓` must not switch across remote paths, repositories, or temporary host terminals.
- Switching controls should only appear or be enabled when their target set has more than one session.

Visual sizing:

- `⇈` and `⇊` should use the same minimum button width and a similar visible glyph size as `↑` and `↓`.
- The bottom row must preserve usable button sizes on narrow screens by scrolling horizontally rather than squeezing text.

## Browser Behavior

Selected text browser behavior should use a small pure helper where practical:

- trim surrounding whitespace;
- reject blank text;
- detect allowed direct URLs with `http://` and `https://`;
- reject direct opening for other schemes;
- apply a conservative length cap before building a search request.

For direct URLs:

- use `Intent.ACTION_VIEW` with the selected URL.

For non-URL text:

- use Android web search behavior with the selected text as the query.

Failure handling:

- catch `ActivityNotFoundException`;
- catch generic exceptions around intent dispatch;
- show a short notice such as `No browser available.` or `Could not open browser.`;
- do not crash and do not change terminal connection state.

## Error Handling

- Blank selected text does not copy, open, or search; the UI shows `Selection is empty.`.
- Unsupported URL schemes are treated as search text, not directly opened.
- Very long selected text is trimmed or rejected before search dispatch to avoid oversized intents.
- Clipboard failures return `false` and keep selection active.
- Browser dispatch failures keep selection active and show a short notice.
- Terminal input unavailable disables helper keys, including `Backspace`.
- Command input disabled state should prevent editing and sending.
- Session switch buttons should not attempt to switch when their filtered session set has fewer than two sessions.

## Testing

Add focused JVM tests for pure behavior:

- Selected text browser resolution:
  - `https://example.test` opens directly;
  - `http://example.test` opens directly;
  - `ssh://example.test` becomes a search query;
  - ordinary text becomes a search query;
  - blank text is rejected.
- Workspace terminal switching:
  - `↑` and `↓` candidate set includes only same workspace and same remote path sessions;
  - sessions from another remote path are excluded;
  - temporary host terminals are excluded when switching project workspace terminals.
- Global terminal switching:
  - `⇈` and `⇊` continue using project terminal sessions only.
- Helper key mapping:
  - `Backspace` action sends terminal backspace input to the terminal manager path;
  - `Backspace` does not mutate command input state.
- Layout model where practical:
  - helper rows are ordered before the command input row;
  - bottom action row order is `⇈`, `⇊`, `↑`, `↓`, optional `Restore`, `Reconnect`, `Close`.

Run Android JVM tests with the Gradle test task. If unrelated environment constraints prevent Gradle execution, document the failure and run the narrowest available test command.

## Implementation Notes

- Keep edits scoped to Android UI files and related tests.
- Prefer small pure helpers for URL/search decision logic and button model ordering.
- Avoid adding a general toolbar framework.
- Preserve existing English UI copy style.
- Preserve existing terminal colors and compact control density.
- Use comments sparingly; prefer clear function names and tests for behavior.
