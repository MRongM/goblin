# File Tree Row Click Expand Design

## Goal

Make directory rows in the project file tree expandable by clicking anywhere on the row, not only by clicking the chevron control.

The selected interaction is: a single click on a directory row selects that row and toggles its expanded state.

## Non-Goals

- No server, route, or file tree read model changes.
- No changes to file selection semantics for regular files.
- No changes to drag-and-drop, context menu actions, status coloring, or virtual node behavior.
- No broad keyboard-navigation rewrite in this change.

## Existing Behavior

`ProjectFileTree` renders each node through `FileTreeRow`.

The row currently handles click selection through `onSelect(node, event)`. The chevron button handles expansion through `onToggle(node)`, stops propagation, and is disabled for non-expandable nodes.

This makes directory expansion depend on hitting the small chevron target, which is slower than typical file-tree interaction.

## Considered Approaches

### Recommended: select and toggle on directory row click

On row click, keep the existing selection logic and additionally call `onToggle(node)` when the node is expandable.

This is the smallest change and matches the requested behavior. It keeps selection, lazy loading, and expansion state owned by their current handlers.

### Alternative: only toggle on unmodified clicks

Only plain clicks would toggle directories, while `Cmd`/`Ctrl`/`Shift` clicks would only adjust selection.

This makes multi-select more conservative, but introduces a hidden interaction rule that is not required for the current request.

### Alternative: create a separate row-click controller

Move selection and expansion decisions into a dedicated helper.

This could be useful if keyboard and pointer interactions grow more complex later, but it is unnecessary for a narrow row-click behavior change.

## Design

Update `FileTreeRow` so the row `onClick` performs two actions:

1. Call `onSelect(node, event)` exactly as it does today.
2. If the node is expandable, call `onToggle(node)`.

Keep the chevron button behavior unchanged:

- It still calls `event.stopPropagation()`.
- It still toggles expandable nodes directly.
- It still avoids selecting the row when clicked.

This preserves the current component boundaries:

- `FileTreeRow` decides which pointer gesture occurred.
- `handleSelect` owns selection state.
- `toggleDirectory` owns expansion state and lazy child loading.

## Edge Cases

- Clicking a file row still only selects the file.
- Clicking a directory row that has not loaded children yet still uses the existing lazy-load path.
- Clicking the chevron still toggles exactly once because propagation remains stopped.
- Clicking a virtual node does not toggle unless it is considered expandable by the existing `isExpandableNode` rule.

## Testing

Add or extend a `ProjectFileTree` component test to cover:

- Clicking a directory row selects it.
- Clicking that same row expands it and triggers the existing child-directory read.
- The chevron continues to be the direct toggle target without double-toggling.

No server tests are needed because this is a renderer-only interaction change.

## Scope Check

This is a focused renderer interaction update. It does not need decomposition into separate implementation phases.
