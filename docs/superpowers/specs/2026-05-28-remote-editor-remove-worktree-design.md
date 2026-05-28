# Remote Editor And Worktree Removal Design

## Goal

Add editor opening and worktree removal support for SSH remote repositories, matching the local repository interaction model where it is safe and applicable.

Remote repositories remain on the SSH host. Goblin must not treat remote worktree paths as local filesystem paths, clone the repository locally, or build SSH shell commands in the renderer.

## Confirmed Decisions

- Reuse the local branch action system instead of creating a separate remote-only action surface.
- Remote branch action areas appear in the same places as local repositories: branch row menu and branch detail toolbar.
- Remote repositories expose only the supported action subset: open editor and remove worktree.
- Remote worktree removal mirrors the local flow, including the optional "also delete branch" checkbox and force confirmation when branch deletion is not safely allowed.
- Remote editor opening uses the user's configured editor preference: VS Code, Cursor, or Windsurf.
- Editor opening uses Remote SSH support in the selected editor. It does not modify the user's SSH config.
- Prefer the SSH config alias as the editor remote authority. Fall back to `user@host` when no alias is available.
- Do not add git commits as part of this design workflow unless explicitly requested.

## Scope

In scope:

- Show remote branch actions for branches with a remote worktree path.
- Add remote editor opening from the existing `editor` action.
- Add remote worktree removal from the existing `removeWorktree` action.
- Support optional branch deletion after remote worktree removal.
- Preserve protected-branch, dirty-worktree, locked-worktree, main-worktree, and stale-state safeguards.
- Refresh remote snapshot and status after successful removal.
- Close or prune embedded remote terminal sessions for removed worktrees.
- Add focused tests across main SSH/backend, shared RPC contracts, renderer store/actions, and UI action visibility.

Out of scope:

- Remote checkout, pull, push, standalone branch deletion, GitHub/PR actions, copy patch, or external terminal opening.
- Local materialization of remote repositories.
- Automatic writes to `~/.ssh/config`.
- Password/passphrase collection inside Goblin.
- Custom parsing for every editor-specific Remote SSH failure.

## Architecture

Remote repositories continue to use `RepoState.kind === 'remote'` with `remoteTarget`.

The renderer keeps one branch action pipeline:

- `BranchActionBar`
- `BranchActionsMenu`
- `useBranchActionItems`
- `useBranchActions`
- `runBranchAction`

Capabilities branch by repository kind:

- Local repositories keep the current behavior.
- Remote repositories render branch actions, but only when a branch has a worktree path and only for supported actions.

Main process remains the privileged boundary:

- Renderer passes a validated `RemoteRepoTarget` and remote absolute path.
- Main validates target/path/branch inputs.
- Main builds editor invocations and SSH git commands.
- Renderer never constructs shell commands.

Execution state stays in the existing repo runtime/resource system. Remote removal uses `resources.branchAction`; no runtime-only state is added to `RepoState`.

## Remote Action Availability

Remote branch actions are available when:

- `repo.kind === 'remote'`
- `repo.remoteTarget` is present
- the selected branch has `worktreePath`
- the branch action resource is not busy

Remote actions shown:

- `editor` when the selected branch has a worktree path and an editor backend is available.
- `removeWorktree` when the selected branch has a worktree path and the worktree is not the primary worktree.

Remote actions hidden:

- `copyPatch`
- `checkout`
- `pull`
- `push`
- `github`
- `terminal` external app action
- `deleteBranch`

The embedded Terminal tab remains available through the existing remote terminal support.

## Remote Editor Opening

Add a remote-capable editor backend contract:

```ts
interface EditorBackend {
  isInstalled: () => boolean
  open: (path: string) => Promise<ExecResult>
  openRemote?: (target: RemoteRepoTarget, path: string) => Promise<ExecResult>
}
```

Add `rpc.remote.openEditor({ target, path })`.

Behavior:

1. Normalize and validate the remote target.
2. Validate `path` as a remote absolute path.
3. Resolve the selected editor from `EditorPref`.
4. If the resolved backend has no `openRemote`, return `error.remote-editor-unavailable`.
5. Invoke the editor's CLI with a Remote SSH authority and the remote path.

Authority selection:

- If `target.alias` exists, use it.
- Otherwise use `target.user@target.host`.

The fallback cannot encode non-default port, identity file, ProxyJump, or other SSH config details. In those cases the user should connect remote repositories through an SSH config alias. Goblin should surface the editor CLI failure instead of silently changing SSH config.

VS Code uses the documented CLI remote form:

```sh
code --remote ssh-remote+<authority> <remotePath>
```

Cursor and Windsurf use the same VS Code-compatible CLI shape through their existing CLI binaries. If the installed version does not support it, return the CLI error.

## Remote Worktree Removal

Add `rpc.remote.removeWorktree({ target, branch, worktreePath, alsoDeleteBranch, forceDeleteBranch })`.

The renderer reuses the existing confirmation flow:

- First confirmation asks whether to remove the worktree.
- The "also delete branch" checkbox defaults to enabled unless the branch is protected.
- Protected branches disable the checkbox and show the existing protected hint.
- If branch deletion is requested but not safely allowed, show the existing force confirmation.

Main-process flow:

1. Normalize and validate the remote target.
2. Validate `branch` with the shared safe branch rules.
3. Validate `worktreePath` as a remote absolute path.
4. Fetch remote worktrees with `git -C <repo> worktree list --porcelain`.
5. Resolve the target by matching both branch and worktree path.
6. Reject the primary worktree.
7. Reject locked worktrees.
8. Run remote `git status --porcelain -z` for the target worktree.
9. Reject when the worktree is dirty or when status cannot prove it is clean.
10. If `alsoDeleteBranch` is true, reject protected branches.
11. If `alsoDeleteBranch` is true and `forceDeleteBranch` is false, verify the branch is safely deletable.
12. Run remote `git -C <repo> worktree remove -- <worktreePath>`.
13. If requested, run remote `git -C <repo> branch -d <branch>` or `-D` when forced.
14. Return `ExecResult`.

Safety rules intentionally match local behavior:

- Stale renderer state cannot remove a worktree because main re-resolves branch and path.
- Dirty status must be explicitly clean; unknown status is not enough.
- Protected branches cannot be deleted.
- The primary worktree cannot be removed.
- Locked worktrees cannot be removed.

## Remote Git Commands

Extend `src/main/ssh/commands.ts` with focused command kinds:

- `gitWorktreeRemove`
- `gitBranchDelete`
- `gitUpstream`
- `gitIsAncestor`

Commands are built from structured inputs and shell-quoted in main. Renderer never supplies shell fragments.

Example shapes:

```ts
type RemoteCommandKind =
  | { type: 'gitWorktreeRemove'; path: string; worktreePath: string }
  | { type: 'gitBranchDelete'; path: string; branch: string; force?: boolean }
```

Remote worktree removal should use the same long timeout budget as remote worktree creation.

Remote branch deletion safety mirrors the local helper:

1. Read the branch upstream from `branch.<name>.remote` and `branch.<name>.merge`.
2. If an upstream exists, verify the branch is an ancestor of that upstream.
3. If no upstream exists, verify the branch is an ancestor of `HEAD`.
4. If the check fails and force was not confirmed, return `error.cannot-remove-unpushed-worktree`.

## UI

Branch list:

- Remote branch rows can show the existing action menu.
- The menu contains only remote-supported actions for the selected branch.

Branch detail toolbar:

- Remote detail toolbar can show `BranchActionBar`.
- The bar contains only remote-supported actions.

Status panel:

- Remains informational.
- Worktree path display and copy behavior stay unchanged.
- No extra action buttons are added to the Status rows.

Shortcut behavior:

- Existing branch action shortcut registration remains.
- Only visible and enabled actions can execute.
- Remote repositories therefore respond only to shortcuts for visible remote actions.

## Error Handling

Reuse existing local error keys wherever semantics match:

- `error.remote-unavailable`
- `error.invalid-arguments`
- `error.invalid-worktree-path`
- `error.worktree-not-found-for-branch`
- `error.cannot-remove-main-worktree`
- `error.cannot-remove-locked-worktree`
- `error.cannot-remove-dirty-worktree`
- `error.cannot-delete-protected-branch`
- `error.cannot-remove-unpushed-worktree`
- `error.editor-not-installed`

Add one focused key if needed:

- `error.remote-editor-unavailable`

SSH, git, and editor CLI failures should surface their stderr or message through `ExecResult.message`. Avoid broad custom parsing unless the codebase already has a matching translation.

Cancellation returns `cancelled` and should not show noisy failure toasts.

## Testing

Main SSH command tests:

- Quote `gitWorktreeRemove` paths correctly.
- Quote `gitBranchDelete` branches correctly.
- Quote and compose `gitUpstream` and `gitIsAncestor` checks correctly.

Main editor backend tests:

- Build remote editor invocations for VS Code, Cursor, and Windsurf.
- Prefer alias authority and fall back to `user@host`.
- Return `error.remote-editor-unavailable` when the resolved backend has no remote opener.

Main remote git tests:

- Resolve removable remote worktrees by branch and path.
- Reject primary, locked, dirty, unknown-status, and missing worktrees.
- Remove worktree without deleting branch.
- Remove worktree then delete branch.
- Trigger safe-delete failure before removal when branch deletion is requested.
- Use force branch deletion only after force confirmation.

Shared RPC tests:

- Accept valid `remote.removeWorktree` input.
- Reject non-absolute remote paths.
- Accept valid `remote.openEditor` input.

Renderer store/action tests:

- Remote `editor` calls `rpc.remote.openEditor`.
- Remote `removeWorktree` calls `rpc.remote.removeWorktree`.
- Remote unsupported actions stay hidden.
- Remote removal refreshes snapshot/status through the existing workflow.

UI tests:

- Remote branch row menu appears for branches with worktrees.
- Remote branch detail toolbar appears for branches with worktrees.
- Only `editor` and `removeWorktree` appear for eligible remote branches.
- No actions appear for remote branches without worktrees.
- Primary remote worktree does not show `removeWorktree`.

## Implementation Notes

Prefer small, existing-boundary changes:

- Extend `repoBranchActionsAvailable` into a capability predicate instead of adding a remote-only component.
- Keep local and remote differences in `useBranchActions` capabilities and store RPC routing.
- Add remote editor support to the existing editor backend registry instead of creating a separate editor registry.
- Add remote removal backend functions beside existing remote git functions in `src/main/ssh/git.ts`.
- Reuse parser helpers from `src/main/git/parsers.ts`.

This keeps the implementation aligned with KISS, DRY, and the current repo architecture.
