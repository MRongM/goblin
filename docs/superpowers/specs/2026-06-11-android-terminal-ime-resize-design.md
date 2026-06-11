# Android Terminal IME Resize Design

## Goal

When the Android soft keyboard appears from the terminal screen, the terminal experience should behave like Termux: the usable terminal area shrinks, and the terminal control rows remain above the keyboard instead of being covered by it.

## Scope

- Applies directly to `TerminalScreen`.
- Keeps the terminal viewport, helper keys, optional command input, and bottom action row in one vertical layout.
- Lets the terminal viewport absorb the height reduction through its existing weighted layout.
- Uses global Android window resize behavior so the IME changes the Activity's usable height.
- Does not redesign ordinary form pages in this change.

Other Android form pages may improve naturally because of global resize behavior. They are not part of the feature's acceptance criteria.

## Current State

- `TerminalScreen` already places `AndroidTerminalViewport`, helper keys, optional command input, and bottom actions in a single `Column`.
- `AndroidTerminalViewport` uses `Modifier.weight(1f)`, so it is the right element to shrink when available height changes.
- The terminal screen already applies `imePadding()`.
- `MainActivity` does not currently declare an explicit `windowSoftInputMode`, so soft keyboard behavior can fall back to pan/overlay behavior on some devices.

## Design

Set the main Android Activity to resize for soft keyboard input. Keep the terminal page's existing vertical composition so the resized window height naturally compresses the terminal viewport while preserving fixed-height controls below it.

The intended vertical order remains:

1. Terminal viewport.
2. Helper key rows.
3. Optional command input row when enabled.
4. Bottom action row.
5. Android soft keyboard.

The command input remains hidden by default. When users tap the terminal viewport, the IME can appear for direct terminal input, and the same resize behavior applies.

## Form Pages

The Android codebase currently has text input on:

- Add/edit host fields and temporary SSH password prompts.
- Repository setup alias/path fields.
- Repository branch and worktree creation fields.
- Terminal settings numeric fields.
- Diagnostics temporary password prompt.
- Terminal direct input and optional command input.

This change intentionally does not add per-form `imePadding()` or per-page layout rewrites. If a future page still has a covered focused field after global resize, it should be handled as a separate page-specific scrolling/focus issue.

## Error Handling

If no keyboard is shown, layout stays unchanged. If a device or IME ignores resize hints, the terminal screen's local inset padding remains a secondary guard, but the primary behavior is Activity resize.

## Testing

- Unit tests should continue passing.
- Build/type checks should continue passing.
- Manual Android verification should confirm:
  - Tapping the terminal viewport opens the IME.
  - The terminal viewport height shrinks.
  - Helper keys and bottom action row remain visible above the IME.
  - Showing the optional command input preserves the same behavior.
