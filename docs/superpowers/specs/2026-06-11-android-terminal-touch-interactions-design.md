# Android Terminal Touch Interactions Design

## Summary

Goblin Android terminal should support phone-native terminal interactions in the existing native terminal view:

- inertial scrolling with acceleration-style deceleration;
- double-tap top half to jump to the top of scrollback;
- double-tap bottom half to jump to the bottom;
- long-press selection with drag adjustment and Copy;
- single-tap `http://` and `https://` URLs to open the Android default browser.

This is a view-layer interaction change. It must not change SSH transport, PTY allocation, terminal session ownership, reconnect, foreground service behavior, terminal persistence, or remote input/output semantics.

## Goals

- Make Android terminal scrollback feel native on touch devices.
- Keep single-finger dragging as the primary scroll gesture.
- Add inertia after drag release, stopping naturally at scrollback and horizontal bounds.
- Add fast top/bottom navigation through double-tap regions.
- Add long-press text selection and explicit Copy without sending anything to the remote terminal.
- Add safe URL opening for `http` and `https` links only.
- Keep the implementation local to Android terminal UI code.

## Non-Goals

- Do not replace `GoblinTerminalView`.
- Do not use WebView or xterm for Android.
- Do not directly embed Termux `TerminalView` session ownership.
- Do not change `TerminalSessionManager`, `TerminalController`, SSHJ, PTY, reconnect, or foreground service lifecycle.
- Do not support non-HTTP URL schemes such as `file:`, `ssh:`, or `mailto:`.
- Do not add Share, Search, Paste-from-selection, or context menu actions beyond Copy.
- Do not add terminal mouse mode.

## Current State

The Android terminal rendering path already uses a Goblin-owned native `View`:

- `AndroidTerminalViewport` wraps `GoblinTerminalView` from Compose with `AndroidView`.
- `GoblinTerminalView` renders a Termux `TerminalEmulator` through `TerminalRenderer`.
- `GoblinTerminalView` owns font metrics, grid resize, vertical scrollback offset, horizontal offset in original-width mode, touch drag handling, hardware key handling, IME input, and byte writes.
- `RemoteTerminalEmulatorController` owns the emulator and remote resize/input callbacks.
- `TerminalScreen` owns route state and existing clipboard paste helper behavior.

The current touch implementation handles direct dragging, but it has no inertial fling, no double-tap top/bottom jump, no terminal text selection, and no Android URL open behavior.

## Selected Approach

Implement the interaction layer inside `GoblinTerminalView`, with system side effects injected from Compose.

`GoblinTerminalView` is the right boundary because it already has all data needed to map touch coordinates to terminal cells:

- renderer font width and line spacing;
- fit-to-screen horizontal render scale;
- horizontal offset;
- scrollback offset;
- active emulator columns, rows, and transcript.

`AndroidTerminalViewport` should pass small callbacks into the view:

- `onOpenUrl(url: String)`;
- `onCopyText(text: String): Boolean`.

`TerminalScreen` should implement those callbacks with Android system APIs:

- `Intent.ACTION_VIEW` for safe `http` and `https` URLs;
- Android clipboard for Copy;
- a short notice when the browser or clipboard action fails.

This keeps the session and transport layers unchanged and keeps gesture logic close to the terminal coordinate system.

## Architecture

### `GoblinTerminalView`

Responsibilities retained:

- Render the active terminal emulator.
- Calculate grid dimensions.
- Resize the remote terminal.
- Translate key and IME input to terminal bytes.
- Manage vertical scrollback offset.
- Manage horizontal offset in original-width mode.

New responsibilities:

- Track terminal touch interaction state.
- Convert touch coordinates to visible terminal cells.
- Run inertial scrolling through `postOnAnimation`.
- Detect double-tap top/bottom jump when no URL or selection interaction wins.
- Detect long-press selection.
- Draw selection highlight over the terminal canvas.
- Read selected text from the emulator and invoke `onCopyText`.
- Detect visible `http` and `https` URLs and invoke `onOpenUrl`.

Non-responsibilities:

- It does not open Android activities directly.
- It does not access the system clipboard directly.
- It does not own SSH sessions or terminal records.
- It does not persist selection state.

### `TerminalTouchInteractionState`

A small pure Kotlin helper should hold gesture state and numeric transitions.

Responsibilities:

- Track down/move/up positions and timestamps.
- Track whether a movement exceeded touch slop.
- Track recent movement velocity.
- Track active selection start/end cells.
- Track inertial scroll velocity and decay.
- Decide whether a release is a click candidate, fling candidate, or ignored.

Non-responsibilities:

- It does not read emulator text.
- It does not render highlights.
- It does not call Android system APIs.

### `TerminalSelectionRange`

Represents terminal cell coordinates for selection.

Responsibilities:

- Store start and end cells.
- Normalize reversed drags.
- Clamp to current visible terminal bounds.
- Report whether the selection is empty.

### `TerminalUrlHitTester`

Pure helper for URL detection.

Responsibilities:

- Scan visible line text for `http://` and `https://` URLs.
- Return the URL under a given cell.
- Reject control characters.
- Reject URLs longer than 4096 characters.
- Ignore all non-HTTP schemes.

Non-responsibilities:

- It does not open URLs.
- It does not scan the whole scrollback.

### `AndroidTerminalViewport`

Responsibilities:

- Continue to own Compose layout and AndroidView binding.
- Pass `fitToScreen`, font size, controller, and viewport width into `GoblinTerminalView`.
- Pass `onOpenUrl` and `onCopyText` callbacks through to the view.

### `TerminalScreen`

Responsibilities:

- Open allowed URLs through Android default browser.
- Copy selected text to Android clipboard and return whether the copy succeeded.
- Show a short notice when an operation fails.

## Interaction Model

### Single-Finger Drag And Inertia

Single-finger drag remains the default terminal navigation gesture.

- Vertical drag updates scrollback offset in terminal rows.
- Original-width mode also updates horizontal offset in pixels.
- Fit-to-screen mode ignores horizontal inertial movement because there is no horizontal overflow.
- On release, the latest velocity starts inertial scrolling.
- Inertial scrolling updates offsets on each animation frame and decays velocity until it drops below a minimum threshold.
- Reaching top, bottom, or horizontal bounds stops the relevant axis.
- A new touch, long press, detach, or controller rebind cancels active inertia.

Existing output-follow behavior remains:

- If the view is already at bottom, new output stays at bottom.
- If the user is viewing scrollback, new output preserves the current scrollback offset as far as the transcript allows.

### Double-Tap Jump

Double-tap works only in ordinary terminal mode:

- no active selection;
- no URL hit;
- no movement beyond touch slop.

Behavior:

- Double-tap the upper half of the terminal viewport to jump to the top of available scrollback.
- Double-tap the lower half of the terminal viewport to jump to the bottom.
- Text and blank space both count as terminal area.

### URL Open

URL behavior:

- Single-tap an `http://` or `https://` URL to open it in Android's default browser.
- URL hit testing uses visible terminal text and terminal cell coordinates.
- Dragging beyond touch slop cancels URL opening.
- Long-pressing a URL enters selection instead of opening it.
- If the URL open fails, the terminal stays usable and `TerminalScreen` shows a short notice.

### Selection And Copy

Selection behavior:

- Long-press enters selection mode at the touched cell.
- Dragging adjusts the selection endpoint.
- The view draws a highlight over selected cells.
- A small floating Copy action appears near the selection.
- Tapping Copy reads selected text from the emulator and calls `onCopyText`.
- Copy exits selection after success.
- Copy failure keeps the selection active so the user can retry.
- Tapping outside the selection exits selection.

Selection mode suppresses:

- terminal input from touch;
- URL open;
- double-tap jump;
- inertial scrolling.

Selected text should be read from the emulator with `getSelectedText(...)`, not reconstructed from Canvas rendering.

## Coordinate Rules

Touch-to-cell conversion must account for:

- horizontal offset in original-width mode;
- fit-to-screen render scale;
- renderer font width;
- renderer line spacing;
- current scrollback offset;
- current emulator rows and columns.

All cell coordinates must be clamped to the current visible bounds before use.

## Error Handling

- URL validation rejects non-HTTP schemes, control characters, malformed values, and values longer than 4096 characters.
- URL open failures are caught in `TerminalScreen`; the app must not crash.
- Empty selections do not show an enabled Copy action.
- Selection coordinates are clamped after output changes.
- Controller rebind, detach, and session switch clear selection and cancel inertia.
- Clipboard failures are caught in `TerminalScreen`, returned as `false`, and shown as a short notice.

## Testing

Add focused JVM tests for pure helpers:

- inertial scroll velocity decays and stops;
- vertical inertia clamps at top and bottom;
- horizontal inertia is available only when original-width overflow exists;
- double-tap upper half maps to top jump;
- double-tap lower half maps to bottom jump;
- movement beyond touch slop cancels URL click;
- URL hit testing accepts `http` and `https`;
- URL hit testing rejects non-HTTP schemes, control characters, and overlong URLs;
- selection range normalizes reversed drags;
- selection range clamps to visible terminal bounds;
- empty selection is detected.

Extend existing Android terminal tests where appropriate:

- `GoblinTerminalViewLayoutTest`;
- `TerminalInteractionStateTest`;
- new `TerminalUrlHitTesterTest` if URL logic is split out.

Verification commands:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.*"
./gradlew ":app:compileDebugKotlin"
```

Manual verification on Android:

- Open a connected SSH terminal.
- Drag through long output and verify inertial scroll.
- Verify top and bottom boundaries stop naturally.
- In original-width mode, verify horizontal drag and inertia.
- Double-tap upper half and lower half.
- Long-press, drag selection, and Copy.
- Tap copied text into another app and confirm content.
- Print a visible `https://example.com/path` URL and verify it opens in the default browser.
- Verify `file://`, `ssh://`, and `mailto:` text does not open.

## Engineering Principles

- KISS: keep the feature in the existing Android terminal view and use small helper functions for testable state.
- YAGNI: support only the confirmed gestures and `http`/`https` URLs.
- DRY: share coordinate conversion and range normalization rather than duplicating math across gestures.
- SOLID: keep terminal rendering, gesture state, URL detection, and Android system side effects separated by clear boundaries.
