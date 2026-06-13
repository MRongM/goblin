# File Tree Copy, Paste, and Upload Design

## Goal

Add file-manager-style copy, paste, and upload behavior to the project file tree.

Users can:

- Select files or directories in the Goblin file tree and copy them with the platform primary shortcut.
- Paste copied entries into any local or remote worktree directory.
- Paste files, images, or text copied from external applications into the file tree.
- Drag files or directories from the operating system into a file tree target directory.

The feature supports local and remote repositories. It uses a server-side transfer engine so file writes, path containment, remote SSH behavior, conflict handling, and size limits are enforced in one place.

## Non-Goals

- No delete, move, user-initiated rename, overwrite, or edit operations.
- No conflict-resolution dialog in this phase.
- No long-running unrestricted transfer mode.
- No resumable upload or background transfer queue.
- No broad refactor of the existing file tree read model.

## Existing Context

The project file tree currently supports browsing a selected branch worktree, selecting multiple nodes, copying path text through the context menu, and dragging internal file paths into terminals. It is intentionally read-only in the current design.

The current repository boundaries are:

- Web client: `src/web/repo-client.ts`
- Server route: `src/server/routes/repo.ts`
- Server read/write modules: `src/server/modules/repo-read-paths.ts` and `src/server/modules/repo-write-paths.ts`
- File tree read module: `src/server/modules/repo-file-tree.ts`
- Local file tree system helper: `src/system/file-tree/local.ts`
- Remote SSH commands: `src/system/ssh/commands.ts` and `src/system/ssh/git.ts`

This feature extends the file tree from read-only browsing into controlled copy/upload writes. The renderer must not perform direct filesystem writes or construct remote shell commands.

## Recommended Approach

Use a server-side transfer engine.

`ProjectFileTree` owns interaction state and event wiring only:

- Selection and focused target.
- Internal Goblin clipboard source.
- Paste and drop event handling.
- Pending, success, and error presentation.

The server owns all transfer behavior:

- Target containment checks.
- Source containment checks for internal file tree copies.
- Local and remote source reads.
- Local and remote target writes.
- Directory recursion.
- Size accounting.
- Automatic destination renaming.
- Repo invalidation after successful writes.

This follows the existing repo/client/route/server/system layering and keeps the only write boundary on the server side.

## Shared Types

Extend `src/shared/file-tree.ts` with request and response types for transfers.

Source inputs should distinguish three kinds of data:

```ts
type RepoFileTransferSource =
  | {
      kind: 'fileTreePaths'
      repoId: string
      worktreePath: string
      paths: string[]
    }
  | {
      kind: 'localPaths'
      paths: string[]
    }
  | {
      kind: 'uploadedItems'
      items: RepoFileTransferUploadItem[]
    }
```

Uploaded items represent browser clipboard or drag/drop payloads whose bytes are already available to the renderer:

```ts
interface RepoFileTransferUploadItem {
  name: string
  mimeType?: string
  bytes: ArrayBuffer
}
```

Transfer requests target a specific worktree directory:

```ts
interface RepoFileTransferRequest {
  repoId: string
  worktreePath: string
  targetDirPath: string
  source: RepoFileTransferSource
}
```

Transfer results should report both aggregate status and per-entry outcomes:

```ts
type RepoFileTransferResult =
  | {
      ok: true
      copied: RepoFileTransferCopiedEntry[]
      renamed: RepoFileTransferRenamedEntry[]
      failed: RepoFileTransferFailedEntry[]
    }
  | {
      ok: false
      message: string
    }
```

The exact transport shape may use `FormData`, streamed multipart data, or JSON-safe byte encoding if that better fits the server route. Raw `ArrayBuffer` values should not be sent through plain JSON. The semantic boundary remains the same.

## Keyboard Semantics

Use the platform primary modifier:

- macOS: `Cmd+C` and `Cmd+V`
- Windows/Linux: `Ctrl+C` and `Ctrl+V`

When the file tree has focus:

- Copy stores the current file tree selection in the Goblin internal clipboard.
- Paste first uses the Goblin internal clipboard if it has file tree paths.
- If the internal clipboard is empty, paste attempts to use the system clipboard/paste event.

Target directory resolution:

1. If a directory is selected or context-targeted, paste into that directory.
2. If a file or virtual node is selected or context-targeted, paste into its parent directory.
3. If there is no valid selected target, paste into the active worktree root.

Internal copy supports every local/remote combination:

- Local to local.
- Local to remote.
- Remote to local.
- Remote to remote.

## External Clipboard Semantics

Support both external file clipboard and content clipboard.

External file clipboard:

- Files or directories copied from Finder, Explorer, or the platform file manager are pasted into the target directory.
- In Electron, file paths should be retrieved through the existing safe bridge pattern rather than guessed from renderer-only data.
- Directory paste depends on native path extraction. If the runtime cannot expose copied directory paths, the paste operation should fail clearly instead of silently flattening or ignoring the directory.

Content clipboard:

- Images are pasted as files.
- Text is pasted as a file.
- Clipboard items with a filename keep that filename.
- Items without filenames use generated names:
  - `pasted-image-YYYYMMDD-HHMMSS.png`
  - `pasted-image-YYYYMMDD-HHMMSS.jpg`
  - `pasted-image-YYYYMMDD-HHMMSS.webp`
  - `pasted-text-YYYYMMDD-HHMMSS.txt`

Generated filenames still go through the server-side automatic renaming strategy if they collide.

## Drag and Drop Semantics

Support operating system file and directory drops into the file tree.

Drop target resolution matches paste:

- Drop on a directory row copies into that directory.
- Drop on a file row copies into the file parent directory.
- Drop on the file tree empty area copies into the active worktree root.

The file tree handles eligible file drops with `preventDefault`, so the outer repository drop handler does not treat those files as repositories to open.

The UI should show a compact drop-target highlight only for the directory that will receive the files. Avoid global overlays inside the file tree.

Directory drops should use native path extraction when available. Renderer-only `File` objects can be used for file bytes, but they are not sufficient for reliable recursive directory upload.

## Conflict Handling

Conflicts are never overwritten in this phase.

The server automatically renames destination entries:

- `file.txt`
- `file copy.txt`
- `file copy 2.txt`
- `file copy 3.txt`

For directories:

- `src`
- `src copy`
- `src copy 2`
- `src copy 3`

Automatic renaming happens on the server against current destination state, not in the renderer against possibly stale tree data.

## Directory and Symlink Semantics

Directories are copied recursively with their nested contents.

Symlinks are copied as symlinks when the source and destination backend can support that safely. If a backend cannot create a symlink or the source symlink cannot be read, that entry is reported as failed without blocking unrelated entries.

Virtual deleted/renamed nodes can be copied only when their source path still resolves to an existing source entry. Otherwise they fail with a path-not-found-style error.

## Size Limits

Use conservative app-level limits:

- Maximum single file: 100 MB.
- Maximum total transfer: 500 MB.

Directory recursion must calculate actual file sizes before starting writes. If any single file or total transfer exceeds the limits, the operation is rejected before writing starts.

Clipboard content items and drag/drop files use the same limits.

The first implementation should not include a progress UI beyond pending state because oversized and long-running operations are intentionally rejected.

## Security

Every request must validate arguments before reading or writing:

- `targetDirPath` must be equal to `worktreePath` or contained below it.
- Internal file tree source paths must be equal to their source `worktreePath` or contained below it.
- Empty paths, NUL bytes, and traversal outside the worktree are rejected.
- Remote paths use POSIX normalization and containment.
- Local paths use platform path normalization and containment where they refer to repo worktrees.

Remote writes must use fixed command templates with strict quoting. Renderer strings must not become arbitrary shell code.

The feature does not introduce delete, move, user-initiated rename, overwrite, or arbitrary command execution.

## Data Flow

Internal file tree copy:

1. User selects file tree nodes.
2. `Copy` stores `{ repoId, worktreePath, paths }` in the internal Goblin clipboard.
3. User focuses or targets a destination directory.
4. `Paste` sends a transfer request to the server.
5. Server validates source and destination containment.
6. Server computes size totals and destination names.
7. Server copies through local and/or remote helpers.
8. Server publishes repo invalidation after successful writes.
9. Renderer refreshes the target directory if loaded and shows a result summary.

External file paste or drop:

1. Renderer extracts file paths through the native bridge when available.
2. Renderer sends `localPaths` to the server.
3. Server validates destination and copies from local source paths into local or remote target.

Content paste:

1. Renderer reads clipboard items into bounded uploaded items.
2. Renderer generates fallback filenames for nameless image/text items.
3. Renderer sends `uploadedItems` to the server.
4. Server enforces size limits and writes bytes to the target backend.

## Server Design

Add `src/server/modules/repo-file-transfer.ts`.

Responsibilities:

- Normalize and validate request inputs.
- Resolve whether source and target are local or remote.
- Validate source containment for internal file tree copies.
- Validate target containment.
- Build an inventory of transfer entries.
- Enforce size limits before writes.
- Resolve conflict-free destination names.
- Dispatch copy/write operations to backend-specific helpers.
- Return per-entry results.
- Publish repo invalidation for the target repo on successful writes.

The server route should be added under `/api/repo`, for example:

- `POST /api/repo/file-transfer`

The web client should expose one focused method in `src/web/repo-client.ts`.

## Local System Design

Extend `src/system/file-tree/local.ts` or add a focused sibling module if the file grows too broad.

Local helpers should provide:

- Inventory local path recursively.
- Copy local file to local target.
- Copy local directory recursively.
- Write uploaded bytes.
- Create symlink when safe.
- Probe destination existence.
- Generate conflict-free destination paths.

Implementation should use Node filesystem APIs rather than shelling out to `cp`.

## Remote System Design

Extend `src/system/ssh/commands.ts` and `src/system/ssh/git.ts` with fixed remote transfer operations.

Remote helpers should provide:

- Inventory remote path recursively and return JSON with file sizes and entry kinds.
- Read remote file content for remote-to-local or remote-to-remote transfer.
- Write uploaded bytes to a remote destination.
- Create directories recursively.
- Create symlinks when supported.
- Check destination existence and produce conflict-free names.

For remote-to-remote on the same target, the implementation may use a remote-side copy command behind the fixed command template. Cross-remote copies should stream through the server.

All remote command output must be parseable and privacy-safe in tests.

## Renderer Design

Keep `ProjectFileTree.tsx` as the orchestration component and move new logic into focused modules:

- `src/web/components/file-tree/clipboard.ts`
  - Platform primary shortcut detection.
  - Internal Goblin clipboard state.
  - Clipboard item extraction.
  - Fallback filename generation.
- `src/web/components/file-tree/drop-target.ts`
  - Resolve target directory from node, selection, or blank area.
  - Track hover target for drag/drop highlight.
- `src/web/components/file-tree/model.ts`
  - Pure helpers for target resolution, path selection, and generated names.

`ProjectFileTree.tsx` should:

- Attach copy/paste handlers only while the file tree is focused.
- Attach drag/drop handlers inside the file tree pane.
- Call the repo-client transfer method.
- Refresh the target directory after success when it is loaded.
- Show concise result feedback through existing toast or inline status patterns.

## Error Handling

Expected error keys include:

- `error.invalid-arguments`
- `error.invalid-path`
- `error.path-not-found`
- `error.path-not-directory`
- `error.path-permission-denied`
- `error.failed-read-repo`
- `error.file-transfer-file-too-large`
- `error.file-transfer-total-too-large`
- `error.file-transfer-source-outside-worktree`
- `error.file-transfer-target-outside-worktree`
- `error.ssh-config-changed`

Partially successful operations return `ok: true` with `failed` entries. The renderer summarizes the result, for example:

- `Copied 8 items`
- `Copied 8 items, 2 failed`

Full request rejection returns `ok: false` and no writes should have started.

## Performance

The first implementation intentionally rejects large transfers instead of implementing a background transfer manager.

Directory inventory should short-circuit as soon as a size limit is exceeded.

Loaded file tree directories should refresh only where needed:

- Refresh the target directory if it is currently loaded.
- Do not force-expand collapsed target directories.
- Let existing repo invalidation update Git status coloring.

## Testing

Pure model tests:

- Target directory resolution for directory, file, virtual node, and empty area.
- Platform primary shortcut detection.
- Generated filename formats.
- Internal clipboard priority over system clipboard.
- Automatic destination naming candidates.

Component tests:

- `Cmd/Ctrl+C` stores selected file tree paths.
- `Cmd/Ctrl+V` calls the transfer client with the expected target directory.
- Paste falls back to system clipboard when internal clipboard is empty.
- Drop on directory, file, and empty area chooses the correct target.
- File tree drop prevents the outer repository drop handler from opening dropped files as repositories.

Server and system tests:

- Local recursive directory copy.
- Local uploaded bytes write.
- Local automatic renaming for files and directories.
- Local size limit rejection before writes.
- Local containment rejection for target and internal source.
- Remote command generation and quoting.
- Remote inventory JSON parsing.
- Remote permission, missing path, and invalid path mapping.
- Route validation for malformed bodies.
- Repo invalidation after successful target writes.

Verification commands:

- `bun run typecheck`
- `bun run test`
- `bun run check:architecture`

## Acceptance Criteria

- Selecting multiple files/directories in the file tree and pressing the platform copy shortcut stores them for paste.
- Pasting copied file tree entries works across local and remote repositories.
- Files copied from the operating system can be pasted into a file tree directory.
- Images or text copied from another app can be pasted as generated files.
- Files or directories dragged from the operating system into the file tree are copied to the intended target directory.
- Existing destination names are never overwritten; copies receive automatic `copy` suffixes.
- Transfers above 100 MB per file or 500 MB total are rejected with a clear error.
- Successful writes refresh the affected file tree directory and repo status through existing invalidation.
- Architecture boundaries remain green.

## Scope Check

This is a single coherent file tree write capability, but it is larger than a narrow renderer interaction change. It should be implemented in focused phases under one plan:

1. Shared transfer contract and server/local copy engine.
2. Renderer copy/paste and local-target flow.
3. Remote transfer support.
4. External clipboard content and OS drag/drop polish.

Each phase should keep the same transfer contract so behavior remains consistent across local and remote repositories.
