# Project File Tree Design

## Goal

Add a project file tree area to the repository workspace. Users can browse the selected branch worktree, select multiple files or directories, drag their absolute paths into the Goblin terminal, and quickly see changed files through Git status coloring.

The feature supports both local and remote repositories and follows the existing repository workspace layouts:

- In `top-bottom` layout, the branch area is split vertically: branch list above, file tree below.
- In `left-right` layout, the branch area is split horizontally: branch list left, file tree right.
- The detail area remains responsible for status, changes, and terminal tabs.

## Non-Goals

- No file create, delete, move, rename, or edit operations.
- No new Git status polling loop for the file tree.
- No default filtering of `.git`, `node_modules`, `dist`, `build`, or other directories.
- No whole-tree eager loading.
- No global keyboard shortcuts for the file tree in this phase.

## Existing Context

`RepoView` currently renders a toolbar plus a `RepoWorkspace` split between `BranchList` and `BranchDetail`. `BranchDetail` owns the existing `status`, `changes`, and `terminal` detail tabs. `TerminalSlot` already accepts OS file drops and writes shell-escaped absolute paths to the active terminal session.

Repository Git status already lives in `repo.data.status` as `WorktreeStatus[]`. It is refreshed by existing repo read workflows and Git mutation invalidation. The file tree should reuse this state for coloring and summaries instead of running a separate status command.

Local and remote repository behavior is already separated behind repo read/write boundaries. File tree reading should follow that pattern:

- Web boundary: `src/web/repo-client.ts`
- Server route: `src/server/routes/repo.ts`
- Server read layer: `src/server/modules/repo-read-paths.ts`
- Backend/source logic: `src/server/modules/repo-backend.ts`, local filesystem helpers, and SSH command helpers

## Workspace Layout

Introduce a file tree pane inside the current branch pane, not as a new detail tab.

`RepoView` should render a branch-area composition component that receives `repoId` and `workspaceLayout`. That component renders `BranchList` and the new file tree using an internal `SplitPane`:

- For `top-bottom`, orientation is vertical with branch list before file tree.
- For `left-right`, orientation is horizontal with branch list before file tree.

The branch/detail split remains unchanged. The file tree does not alter terminal, changes, or status tab ownership.

The internal branch/file split size should be renderer UI state. It may be restorable per workspace layout, but directory contents should not be persisted.

## File Tree Root

The file tree root is the worktree path for the currently selected branch:

1. Resolve `repo.ui.selectedBranch`.
2. Find the matching `RepoBranchState`.
3. Use `branch.worktree.path`.
4. If no selected branch or no worktree exists, show an empty state and do not read files.

Switching to another selected branch switches the file tree to that branch worktree. Expanded directories and selection are scoped by `repoId + worktreePath`, so two worktrees do not share tree UI state accidentally.

## Directory Read Model

Directory reads are one-level, on demand.

The server route accepts:

```ts
interface RepoFileTreeRequest {
  repoId: string
  worktreePath: string
  dirPath: string
}
```

`dirPath` is an absolute path. The server validates that it is inside `worktreePath` before reading. The response is either a failure or a one-level listing:

```ts
type RepoFileTreeEntryKind = 'file' | 'directory' | 'symlink'

interface RepoFileTreeEntry {
  name: string
  absolutePath: string
  relativePath: string
  kind: RepoFileTreeEntryKind
  targetKind?: 'file' | 'directory' | 'other' | 'missing'
}

interface RepoFileTreeResult {
  ok: true
  worktreePath: string
  dirPath: string
  entries: RepoFileTreeEntry[]
} | {
  ok: false
  message: string
}
```

Sorting is deterministic: directories first, then files and symlinks, with natural locale compare by `name`.

No directory names are filtered by default. To protect the app from pathological single-directory payloads, each read has an explicit child-entry cap of 5000. If a directory exceeds the cap, the server returns an error for that directory. This is a safety boundary, not a hidden filter.

## Local Reads

Local reads use Node filesystem APIs on the server side:

- `fs.readdir(dirPath, { withFileTypes: true })`
- `lstat` or `stat` only when symlink target information is needed
- path containment check with normalized absolute paths

The renderer never reads local files directly.

## Remote Reads

Remote reads use the existing SSH command runner. Add a read-only remote command for one-level directory listing. The command must quote paths safely and emit a parseable format that preserves spaces and non-ASCII names.

The remote path containment check should normalize POSIX paths and require the requested directory to equal the worktree path or be below it. SSH config changes, permission errors, and missing paths should map to existing error message keys where possible.

Remote file tree entries use remote absolute paths. Dragging into a remote terminal writes those remote paths, not local proxy paths.

## Status Mapping

The file tree uses `repo.data.status` as the source of changed-file state.

For the active worktree:

- Build a map from status relative path to status metadata.
- Extend status parsing to preserve rename/copy original paths as optional metadata. Current porcelain `-z` output includes the new path followed by the original path for rename and copy entries; the file tree needs the original path to render the old side as a virtual node.
- Derive node tone from Git status:
  - Modified, renamed, or type changed: attention.
  - Added or untracked: success or brand tone.
  - Deleted or conflict: danger.
  - Ignored: muted.
- Derive directory summary counts by prefix matching status paths against directory relative paths.

Directory coloring is based on descendants. A directory with any changed descendant is tinted and shows a count badge.

Virtual nodes are inserted for status entries whose relevant path is not present in a loaded real directory. Deleted paths and rename/copy original paths are represented this way. Virtual nodes:

- Have `kind: 'virtual'` in the frontend tree model. Server directory entries remain limited to real filesystem kinds.
- Are shown in the directory where the path belongs.
- Can be selected, copied, and dragged as path text.
- Cannot be opened in an editor or terminal because the filesystem object may not exist.

If a real entry and a status entry share the same relative path, render one real node with status metadata attached.

## Selection

Selection follows file manager behavior:

- Click selects one node.
- `Cmd`/`Ctrl` click toggles a node in the selection.
- `Shift` click selects a visible-range interval from the anchor node.
- `Space` toggles the focused node.
- `ArrowUp` and `ArrowDown` move focus.
- `ArrowRight` expands a directory.
- `ArrowLeft` collapses a directory.
- `Enter` expands a directory or selects a file.

Files and directories are both selectable. Selection is scoped to the active `repoId + worktreePath`. Switching worktrees clears or isolates the visible selection.

## Drag to Terminal

Dragging from the file tree writes an internal drag payload:

```ts
interface GoblinFilePathDragPayload {
  paths: string[]
}
```

The MIME type should be app-specific, for example:

```text
application/x-goblin-file-paths+json
```

If the drag starts from a selected node, all selected node absolute paths are included. If it starts from an unselected node, only that node path is included.

`TerminalSlot` should keep the existing OS file drop path. It should additionally accept the internal MIME type. Internal paths take precedence over `Files` if both are present. Terminal input formatting remains centralized in `TerminalSlot`: paths are shell escaped and joined by spaces before being written to the terminal.

## Context Menu

The file tree context menu exposes read-only path and open actions:

- Copy path: copies absolute paths. Multiple selection copies one path per line.
- Copy relative path: copies paths relative to the worktree root. Multiple selection copies one path per line.
- Open in editor: opens the context-clicked real file or directory through the existing editor opener.
- Open in terminal: opens a terminal at the context-clicked directory, or at a file's parent directory.

For multiple selection, copy actions support all selected nodes. Open actions should apply to the context-clicked node only in the first implementation to avoid surprising multi-window or multi-terminal fan-out.

For virtual deleted nodes, open actions are disabled. Copy and drag remain enabled.

## Error Handling

Directory failures are local to the directory node:

- A failed child read displays a compact inline error and retry control under that directory.
- Root read failure displays the file tree empty/error state.
- Already loaded sibling directories remain visible.

Expected error keys include:

- `error.invalid-arguments`
- `error.invalid-path`
- `error.path-not-found`
- `error.path-not-directory`
- `error.path-permission-denied`
- `error.failed-read-repo`
- `error.ssh-config-changed`

Unknown errors should be logged server-side and returned as `error.failed-read-repo`.

## Security

The server must enforce containment before every directory read:

- Local `dirPath` must be equal to `worktreePath` or contained below it after normalization.
- Remote `dirPath` must be equal to `worktreePath` or contained below it after POSIX normalization.
- Requests with empty paths, NUL bytes, or traversal outside the worktree return `error.invalid-arguments` or `error.invalid-path`.

The file tree does not execute shell commands from renderer-provided file paths. Remote directory listing uses a fixed command template with quoted arguments.

## Performance

The feature avoids whole-tree work:

- Root request loads one directory level.
- Directory expansion loads one directory level.
- Collapsed directories keep their cached children for the current session.
- Git status coloring is derived from the existing status array.
- Directory summary counts are computed from status path prefixes, not from filesystem scans.

Virtual scrolling is not part of this design. If rendering large loaded directories becomes a measured problem, it can be added later behind the file tree component boundary.

## Testing

Server and system tests:

- Local directory listing for files, directories, and symlinks.
- Local deterministic sorting.
- Local missing path, non-directory path, permission failure, and containment rejection.
- Remote SSH command construction and quoting.
- Remote listing parse behavior.
- Remote containment rejection and error mapping.
- Repo route/client validation and fallback behavior.

Frontend model tests:

- Status entry to file node tone mapping.
- Directory descendant change count aggregation.
- Virtual deleted and renamed-old node insertion.
- Real node plus status entry deduplication.
- Selection toggle and range selection.
- Drag payload construction.

Component tests:

- `top-bottom` renders branch list above file tree.
- `left-right` renders branch list left of file tree.
- Expanding a directory triggers one read and renders loading, success, error, and retry states.
- Files and directories show status tones and directory count badges.
- Context menu enables copy/open actions for real nodes and disables open actions for virtual deleted nodes.
- `TerminalSlot` accepts internal file path drag payloads and preserves existing OS file drop behavior.

Verification commands:

```sh
bun run typecheck
bun run test
bun run check:architecture
```
