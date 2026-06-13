# Explorer Status and File Navigation Design

## Goal

Move repository status out of the branch detail area and into the file explorer area. The explorer area becomes the owner of worktree browsing surfaces:

- Files
- Changes
- Status

The branch detail area becomes terminal-focused. Changed-file rows support locating the corresponding path in the file tree, and directory rows in the file tree expand or collapse when clicked anywhere on the row.

## Non-Goals

- No file editing, creation, deletion, rename, or move operations.
- No diff viewer in this phase.
- No direct editor launch when clicking a changed-file row.
- No server API changes beyond what the existing file tree implementation already requires.
- No broad keyboard shortcut redesign.

## Existing Context

`RepoExplorerPane` already composes the branch list with an explorer area and currently exposes `Files` and `Changes` tabs. `ProjectChangesPanel` renders changed files through `StatusList`. `BranchDetail` still owns the `Status` tab and the terminal tab group.

`ProjectFileTree` owns file-tree loading, expanded directory state, selection, context menu actions, and internal path drag payloads. A previous design already selected row-click expansion for directories, but the current component still only selects on row click and expands through the chevron button.

## Recommended Approach

Use one explorer tab system for file-related views:

```ts
type ExplorerTab = 'files' | 'changes' | 'status'
```

Keep terminal state and terminal tabs in `BranchDetail`. Treat existing `DetailTab` values as branch-detail navigation state and remove `status` / `changes` from the rendered branch-detail toolbar. Compatibility code should safely coerce legacy persisted `status` and `changes` values away from the terminal detail surface.

This keeps ownership simple:

- Explorer area owns files, changed file list, and branch status.
- Detail area owns terminal sessions and terminal focus/collapse behavior.
- Store and navigation helpers continue to centralize persisted tab normalization.

## Explorer Tabs

`RepoExplorerPane` should render three tabs:

- `Files` renders `ProjectFileTree`.
- `Changes` renders `ProjectChangesPanel`.
- `Status` renders the existing `BranchStatus` presentation for the selected branch.

The `Changes` badge continues to use the selected worktree's changed-entry count. The `Status` tab does not need a badge in this phase.

The explorer tab state can remain renderer-local component state. It does not need to be serialized into session state because the existing branch/file split is already a local browsing surface, and restoring it would add persistence complexity without improving the core workflow.

## Branch Detail Area

`BranchDetailToolbar` should stop rendering the status tab button. It should keep terminal tabs and terminal controls when the selected branch has a worktree.

`BranchDetailContent` should render terminal content only when a terminal tab is active and the selected branch has a worktree. If the selected branch has no worktree, it should not fall back to status content. The existing no-branch empty state remains valid for no selected branch.

Navigation helpers should preserve runtime safety:

- A request to show `terminal` remains valid only when the branch has a worktree.
- Legacy `status` or `changes` detail tab values should normalize to a safe detail value. Since the detail area has no non-terminal content after this change, the safest persisted value is the existing default path that leaves terminal inactive until a terminal action opens it.
- Existing commands that explicitly open terminal should continue to call the same navigation path.

## Changed-File Click Navigation

Clicking a row in the `Changes` tab should locate that path in the file tree:

1. Switch the explorer tab to `Files`.
2. Ask `ProjectFileTree` to reveal the clicked relative path.
3. Expand each parent directory in order.
4. Load missing parent directories through the existing lazy directory loader.
5. Select the final node and scroll it into view.

The click should target the worktree-relative path from the status entry. For rename or copy entries, the visible new path is the primary target. Deleted paths and rename originals may be virtual nodes if the file tree model has already inserted them; those nodes can still be selected and revealed, but cannot be opened through file actions.

The simplest component boundary is a small reveal signal owned by `RepoExplorerPane`:

```ts
interface FileTreeRevealRequest {
  id: number
  relativePath: string
}
```

`ProjectChangesPanel` receives `onRevealPath(relativePath)`. `ProjectFileTree` receives `revealRequest`. Incrementing `id` allows repeated clicks on the same path to retrigger the reveal effect without storing imperative refs across component boundaries.

## Directory Row Click Expansion

Directory rows in `ProjectFileTree` should select and toggle on a single row click:

1. Run the existing selection handler.
2. If the node is expandable, run the existing directory toggle handler.

The chevron button remains a direct toggle target and continues to stop propagation. This prevents double toggles and preserves the smaller explicit target for users who prefer it.

Plain file rows still only select. Multi-select modifiers keep their existing selection behavior; a modified click on an expandable row still toggles because the user request is to make the row itself the expansion target.

## Error Handling

Reveal failures should stay local and non-disruptive:

- If a parent directory fails to load, keep the `Files` tab active and show the existing inline directory error.
- If the final path cannot be found after all loadable parents are expanded, keep the nearest loaded parent expanded and leave selection unchanged.
- If there is no selected worktree, clicking a changed-file row should do nothing because the changes panel has no valid file tree target.

## Testing

Add or update focused renderer tests:

- `RepoExplorerPane` renders `Files`, `Changes`, and `Status` tabs.
- Selecting `Status` in the explorer renders the existing branch status content.
- Clicking a changed-file row switches to `Files`, expands parent directories, and selects the target file.
- Clicking a directory row selects and toggles it.
- Clicking the chevron still toggles exactly once.
- `BranchDetailToolbar` no longer renders a status tab.
- Terminal tab selection and terminal creation still open the terminal detail surface.

## Scope Check

This is a single UI ownership and interaction change. It is intentionally limited to the repository workspace renderer surface and store normalization needed to keep old detail-tab state safe. It does not require new Git operations, file mutation APIs, or Electron main-process changes.
