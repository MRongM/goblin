# File Tree Rename And Delete Design

## Goal

Add controlled write actions to the project file tree so users can rename and permanently delete files or directories from the selected branch worktree. The feature supports both local and remote repositories and reuses the existing file tree context menu and repository write boundaries.

## Scope

Included:

- Rename a real file, directory, or symlink within its current parent directory.
- Permanently delete one or more selected real file tree entries.
- Support local and remote repository file trees.
- Trigger rename from the row context menu or from `Enter` on the current selection.
- Trigger delete from the row context menu with a required confirmation dialog.
- Refresh affected directories and repository status after successful mutations.

Excluded:

- Double-click rename.
- File or directory creation.
- Cross-directory move.
- Drag-to-move.
- Trash or recycle-bin behavior.
- Batch rename.
- Editing file contents.
- Write actions for virtual deleted nodes.

## Interaction Model

The file tree context menu adds `Rename` and `Delete` below the existing copy and open actions. Rename applies to the context-clicked real node, or to the only selected real node when invoked by keyboard. Delete applies to all selected real nodes when the context-clicked node is already selected; otherwise it applies only to the context-clicked node.

`Enter` starts inline rename for the only selected real node. `Esc` cancels rename. Rename submit uses `Enter`; blur cancels the edit to avoid accidental writes. While rename is submitting, the input and conflicting menu actions are disabled. On failure, the row remains in edit mode and displays a compact error message.

Delete is permanent. Before execution, the UI shows a confirmation dialog. The dialog names the single target or shows the number of selected entries. Directory deletion is allowed, and the confirmation copy must state that directory contents will also be deleted.

Virtual nodes and missing/deleted status-only nodes keep copy and drag behavior, but their rename and delete actions are disabled.

## Architecture

Use the existing repository write path:

```text
ProjectFileTree.tsx
  -> repo-client.ts
  -> /api/repo/...
  -> repo-write-paths.ts
  -> local filesystem or remote SSH helper
```

Add client and route functions for:

```ts
renameRepositoryFileTreeEntry(repoId: string, worktreePath: string, oldPath: string, newName: string): Promise<ExecResult>

deleteRepositoryFileTreeEntries(repoId: string, worktreePath: string, paths: string[]): Promise<ExecResult>
```

`ProjectFileTree` remains responsible for presentation state: active inline edit row, pending operation state, confirmation dialog state, and local directory cache refresh. The server remains responsible for validation, path containment, filesystem mutation, remote command construction, and invalidation.

Successful rename or delete publishes repository snapshot invalidation for `repoId`. This keeps Git status, branch metadata, and file tree coloring aligned with the rest of the app.

## Local Behavior

Local mutations use Node filesystem APIs on the server side:

- Rename uses `fs.rename(oldPath, siblingPathWithNewName)`.
- Delete uses `fs.rm(path, { recursive: true, force: false })`.

The local helper validates before mutating:

- `worktreePath`, `oldPath`, and delete targets must be absolute, non-empty, and free of NUL bytes.
- Every target must normalize to `worktreePath` or a descendant before operation-specific checks.
- Delete must reject deleting the worktree root itself.
- Rename must reject renaming the worktree root itself.
- `newName` must be a single path segment, not `.`, `..`, empty, or containing `/`, `\`, or NUL.
- Rename must reject an existing destination instead of overwriting.

Expected local error keys include `error.invalid-arguments`, `error.invalid-path`, `error.path-not-found`, `error.path-permission-denied`, `error.file-exists`, `error.delete-root-forbidden`, and `error.failed-read-repo`.

## Remote Behavior

Remote mutations use fixed SSH command templates. The renderer never provides shell fragments.

Rename performs the remote equivalent of:

```sh
mv -- "$old_path" "$parent_dir/$new_name"
```

Delete performs the remote equivalent of:

```sh
rm -rf -- "$path_1" "$path_2"
```

Remote safety mirrors local safety with POSIX path rules:

- Normalize `worktreePath` and each target as POSIX absolute paths.
- Require each target to be inside the worktree.
- Reject deleting or renaming the worktree root itself.
- Reject empty paths, NUL bytes, and path traversal outside the worktree.
- Treat `newName` as a basename only.
- Check destination existence before rename and return `error.file-exists` if present.

Remote command construction must quote all paths safely and must not concatenate untrusted input into executable shell syntax. SSH config changes and connection failures continue to map to existing remote error keys where possible.

## Frontend State And Refresh

After a successful rename:

- Close the edit state.
- Refresh the parent directory.
- Remove cached children and expanded state for the old path.
- Select the renamed node when it appears in the refreshed directory.

After a successful delete:

- Close the confirmation dialog and context menu.
- Remove deleted ids from selection and anchor state.
- Remove cached children and expanded state for deleted directories.
- Refresh every affected parent directory.

If an operation fails, the existing tree remains visible. Errors are local to the operation and shown near the edited row or in the confirmation dialog.

## Security

All write operations are denied by default unless validation passes. Renderer-provided paths are treated as untrusted. The server enforces containment and operation-specific constraints before touching the filesystem or building a remote command.

Permanent delete is intentionally high risk, so the UI confirmation is required. Server safeguards still reject root deletion and path escape even if a request bypasses the UI.

## Testing

Add focused tests for:

- Local rename success, basename validation, path escape rejection, destination-exists rejection, and root rename rejection.
- Local delete success, multi-target delete, path escape rejection, and worktree-root delete rejection.
- Remote command generation, POSIX containment, basename validation, destination-exists mapping, and path-not-found mapping.
- Server write functions dispatching local vs remote behavior and publishing invalidation on success.
- Route and web client request payloads.
- `ProjectFileTree` context menu write actions, `Enter` rename start, `Esc` cancel, submit behavior, delete confirmation, and multi-select delete payloads.

Verification should include `bun run typecheck` and relevant Vitest suites. Run `bun run test` if the touched surface crosses shared repo write behavior, SSH helpers, and frontend file tree state.
