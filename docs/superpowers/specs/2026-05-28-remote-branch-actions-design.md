# Remote Branch Actions Design

## Goal

Give SSH remote repositories the same practical branch action surface as local repositories while preserving Goblin's existing security boundary: remote repositories stay on the SSH host, renderer code never builds SSH or shell commands, and destructive Git operations keep conservative guard behavior.

This design supersedes the narrower Phase 2 read-only boundary for remote branch actions. Remote read resources still use the existing resource lifecycle, but selected remote branch actions are now in scope.

## Confirmed Decisions

- Remote branch actions should appear in the same right-side branch detail area as local branch actions.
- Remote branch actions should be real operations, not placeholder UI.
- Remote checkout, pull, push, create worktree, remove worktree, delete branch, copy patch, external terminal, embedded Terminal tab, editor opening, and GitHub/PR opening are in scope.
- Remote Finder opening remains out of scope because remote paths are not local filesystem paths.
- Remote delete branch and remove worktree reuse the local safety model: protected branches are not deleted, current branches are not deleted, checked-out branches are not deleted directly, dirty or unknown worktrees are not removed, and unsafe branch deletion requires the existing confirmation flow.
- Remote `pull` is visible only when the branch has tracking/upstream metadata.
- Remote `pull` and `checkout` run in the branch worktree when one exists, otherwise in the remote repository path.
- Remote `push` runs from the remote repository path and pushes the selected branch to `origin`.
- Remote external terminal uses the user's configured terminal app and opens a local terminal window running SSH into the remote worktree.
- Remote editor opening uses the user's configured editor app and its Remote SSH CLI support.
- Remote GitHub/PR opening derives URLs from the remote repository's Git origin instead of requiring a local clone.
- Do not add git commits as part of this design workflow unless explicitly requested.

## Scope

In scope:

- Re-enable remote branch action rendering with fine-grained capabilities.
- Add typed remote RPC procedures for branch actions and app-open actions.
- Add SSH command whitelist entries for remote write/read-action primitives.
- Reuse local branch action UI, dialogs, result toasts, busy state, and refresh behavior.
- Reuse existing embedded remote terminal infrastructure for the Terminal tab.
- Add external terminal support for remote worktrees.
- Add focused tests for RPC validation, SSH command generation, safety guards, store behavior, UI visibility, and local regression coverage.
- Update GSD planning docs so they no longer claim remote branch actions are hidden in the active phase boundary.

Out of scope:

- A generic remote shell command RPC.
- Treating remote worktree paths as local paths.
- Remote Finder integration.
- App-managed SSH passwords or private key custody.
- Automatic edits to user SSH config.
- Background remote fetch policy changes beyond what action refresh requires.

## Architecture

Remote repositories continue to use `RepoState.kind === 'remote'` with a normalized `remoteTarget`.

The renderer keeps one branch action pipeline:

- `BranchDetailToolbar`
- `BranchActionBar`
- `BranchActionsMenu`
- `useBranchActionItems`
- `useBranchActions`
- `runBranchAction`

Capabilities branch by repository kind and branch state instead of hiding all remote actions. The renderer can decide whether an action is visible, but main process still validates every target, branch, and path before executing anything.

Main process remains the privileged boundary:

- Renderer passes structured inputs to typed RPC procedures.
- Main normalizes `RemoteRepoTarget` and requires normalized id equality.
- Main validates branch names and remote absolute paths.
- Main builds all SSH command invocations from a closed whitelist.
- Main owns shell quoting, timeout, cancellation, and error mapping.

No `remote.command` or raw shell procedure is added.

## Remote RPC Contract

Add or restore these typed procedures under `remote`:

- `patch({ target, worktreePath })`
- `checkout({ target, branch, worktreePath? })`
- `pull({ target, branch, worktreePath? })`
- `push({ target, branch })`
- `createWorktree({ target, worktreePath, newBranch, baseBranch })`
- `removeWorktree({ target, branch, worktreePath, alsoDeleteBranch, forceDeleteBranch? })`
- `deleteBranch({ target, branch, force? })`
- `openTerminal({ target, path })`
- `openEditor({ target, path })`
- `openGitHub({ target, branch? })`

Existing read procedures remain:

- `snapshot`
- `status`
- `log`
- diagnostics and path-picker procedures

`openTerminal` is for the external terminal app action. The embedded Terminal tab continues to use terminal IPC and `TerminalSessionBase` with `kind: 'remote'`.

## Remote Git Service

`src/main/ssh/git.ts` owns remote Git semantics and should expose focused helpers:

- `getRemotePatch(target, worktreePath, options)`
- `checkoutRemoteBranch(target, branch, worktreePath?, options)`
- `pullRemoteBranch(target, branch, worktreePath?, options)`
- `pushRemoteBranch(target, branch, options)`
- `createRemoteWorktree(target, input)`
- `removeRemoteWorktree(target, input)`
- `deleteRemoteBranch(target, input)`
- `openRemoteGitHub(target, branch?, options)` or a main-layer helper using remote Git reads

Operation target rules:

- `checkout`: run in `worktreePath` when present, otherwise `target.remotePath`.
- `pull`: run in `worktreePath` when present, otherwise `target.remotePath`.
- `push`: run in `target.remotePath`.
- `patch`: run against the exact worktree path after verifying it is a known worktree.
- `removeWorktree`: resolve by both branch and worktree path from fresh remote worktree data.
- `deleteBranch`: reject the current branch and any branch checked out in a worktree.

Remote helpers return existing `ExecResult` where applicable and do not persist remote stdout/stderr.

## SSH Command Whitelist

Extend `RemoteCommandKind` with structured commands only:

- `gitPatch`
- `gitCheckout`
- `gitPull`
- `gitPush`
- `gitWorktreeAdd`
- `gitWorktreeRemove`
- `gitBranchDelete`
- `gitUpstream`
- `gitIsAncestor`
- `gitRemoteGetUrl`

The existing commands remain for snapshot, worktree list, status, and log.

Command builders must shell-quote all paths and branch names. Branches still pass shared branch validation before command construction. Remote absolute paths must start with `/`, contain no null byte, and stay within reasonable length limits.

Representative command semantics:

- `git -C <targetPath> checkout -- <branch>`
- `gitPull` should mirror local `pullBranch`: when the selected branch is current in the target path, run `git pull --ff-only`; otherwise resolve the upstream and fetch the upstream branch into the selected branch.
- `git -C <repoPath> push -u origin <branch>`
- `git -C <repoPath> worktree add -b <newBranch> -- <worktreePath> <baseBranch>`
- `git -C <repoPath> worktree remove -- <worktreePath>`
- `git -C <repoPath> branch -d|-D -- <branch>`
- `git -C <repoPath> rev-parse --abbrev-ref <branch>@{u}`
- `git -C <repoPath> merge-base --is-ancestor -- <ancestor> <descendant>`
- `git -C <repoPath> remote get-url origin`

Where Git supports `--`, use it before user-controlled ref/path arguments.

## Safety Rules

Remote branch deletion:

1. Validate target and branch.
2. Read current branch from the remote repo.
3. Reject deleting the current branch.
4. Reject protected branches.
5. Read remote worktrees.
6. Reject branches currently checked out in any worktree.
7. If not forced, require safe deletion by checking upstream/ancestor state.
8. Run remote branch delete only after all guards pass.

Remote worktree removal:

1. Validate target, branch, worktree path, and boolean options.
2. Read remote worktrees.
3. Resolve the target by matching both branch and worktree path.
4. Reject primary worktree.
5. Reject locked worktree.
6. Run remote status for the target worktree.
7. Reject dirty worktree or status failure.
8. If also deleting the branch, reject protected branches.
9. If also deleting and not forced, require safe deletion.
10. Remove the worktree.
11. Delete the branch when requested.
12. Prune/close embedded remote terminal sessions for the removed worktree.

The renderer's stale branch data is never trusted for destructive operations.

## Frontend State And Refresh

Do not add runtime operation fields to `RepoState`.

Reuse:

- `repo.resources.branchAction`
- `repo.resources.fetch`
- `repo.resources.snapshot`
- `repo.resources.status`
- `repo.resources.logsByBranch`
- `runtime.ts`
- `operation-runner.ts`

Remote branch actions use the same lane model as local actions:

- `checkout`, `createWorktree`, `deleteBranch`, and `removeWorktree` use the write lane.
- `pull` and `push` use the network lane and mark `resources.fetch`, matching local branch network actions.
- UI-only actions (`copyPatch`, `openTerminal`, `openEditor`, `openGitHub`) use the existing async pending UI action path.

After successful write/network operations, run a remote refresh workflow:

1. Refresh snapshot.
2. Refresh status when appropriate.
3. Refresh visible commit log for the selected branch when the commits tab is visible.
4. Skip local-only PR refresh side effects unless remote GitHub/PR support has a dedicated remote path.

Failed operations update branch action/fetch resources and preserve previously loaded data.

## UI Capability Rules

Remote actions are visible through the existing branch action bar/dropdown:

- `copyPatch`: branch has `worktreePath` and remote status shows changes for that worktree.
- `checkout`: branch is not current and not already checked out in another worktree.
- `pull`: branch has tracking/upstream metadata.
- `push`: any valid branch.
- `terminal`: branch has `worktreePath` and terminal backend is available.
- `editor`: branch has `worktreePath` and editor backend is available.
- `github`: any valid branch.
- `removeWorktree`: branch has a non-primary `worktreePath`.
- `deleteBranch`: branch is not current, has no worktree, and is not protected.

The embedded `Terminal` tab is visible for remote branches with `worktreePath`. It passes a remote terminal base:

```ts
{
  kind: 'remote',
  repoId: repo.id,
  target: repo.remoteTarget,
  branch: branch.name,
  worktreePath: branch.worktreePath
}
```

The external terminal action uses the configured terminal backend to open a local terminal window running SSH into the remote worktree. The embedded terminal and external terminal are separate actions.

Finder remains hidden for remote repositories.

## External Terminal

Extend terminal backends with optional remote opening support:

```ts
interface TerminalBackend {
  isInstalled: () => boolean
  open: (path: string) => Promise<ExecResult>
  openRemote?: (target: RemoteRepoTarget, path: string) => Promise<ExecResult>
}
```

For remote paths, resolve the preferred terminal and invoke `openRemote` when available.

The remote terminal command should open a local terminal window that runs SSH with the existing target data and changes into the remote worktree:

```sh
ssh -tt <destination> "sh -lc 'cd <worktreePath> && exec ${SHELL:-/bin/sh} -l'"
```

The actual implementation should build argv arrays, not shell-concatenated local commands. Remote shell text still uses the existing remote shell quoting helper.

If a terminal backend cannot open remote sessions, return `error.remote-terminal-unavailable`.

## Remote Editor

Reuse the existing editor preference model and Remote SSH CLI support:

- VS Code: `code --remote ssh-remote+<authority> <remotePath>`
- Cursor: Cursor CLI with the same remote shape.
- Windsurf: Windsurf CLI with the same remote shape.

Authority selection:

- Prefer `target.alias`.
- Fall back to `user@host`.

Non-default port, identity file, ProxyJump, and similar SSH details require an SSH config alias for editor CLI compatibility. Goblin should surface editor CLI failure rather than editing SSH config automatically.

## GitHub And PR Opening

Remote GitHub/PR opening should match the local user expectation:

1. Read `origin` URL from the remote repo.
2. Normalize GitHub HTTPS/SSH origin forms into a GitHub repository URL.
3. If branch metadata already includes a matching pull request URL, open it.
4. Otherwise, build a compare/new PR URL for the branch when possible.
5. Fall back to opening the repository URL.

If origin is not GitHub or cannot be parsed, return `error.open-github-no-origin` or the closest existing error key.

Remote PR discovery can be limited to URL construction in this design. Full GitHub API PR enrichment remains separate unless already implemented for remote branches.

## Copy Patch

Remote copy patch mirrors local copy patch:

1. The action is visible only when status data shows changes for the selected worktree.
2. Main verifies the worktree is known from fresh remote worktree data.
3. Main generates a `git apply --binary` patch for tracked and untracked changes on the remote worktree.
4. Renderer copies the returned patch text to the local clipboard.
5. Empty patch returns the existing "nothing to copy" result.

The remote implementation should reuse the local patch format and parser expectations where practical, but command execution occurs over SSH.

## Worktree Creation

The existing `CreateWorktreeDialog` stays shared.

For remote repos:

- Default path is a remote sibling path derived from `target.remotePath` and the branch slug.
- User-entered paths are remote absolute paths, not local paths.
- No `~` local expansion or local filesystem validation is applied.
- Submission uses `remote.createWorktree`.

On success, refresh remote snapshot and status. On failure, surface the returned Git/SSH message.

## Error Handling

Use existing result/toast behavior:

- `cancelled` is silent.
- Operation errors set `resources.branchAction` and optionally `resources.fetch`.
- UI-only action errors use `setLastResult`.
- Stale data remains visible after failed refreshes.

Add new error keys only when existing keys are too misleading:

- `error.remote-terminal-unavailable`
- `error.remote-editor-unavailable` if not already present
- Remote Git command failures may surface raw Git stderr when specific mapping is not available.

## Testing

Main tests:

- SSH command generation shell-quotes paths and branches.
- Remote patch, checkout, pull, push, create worktree, remove worktree, delete branch, and origin URL helpers call the expected command kinds.
- Destructive guards reject protected/current/checked-out/dirty/locked/unknown-state cases.
- RPC validation rejects invalid target ids, invalid branches, invalid paths, and missing procedures.
- External terminal and editor remote openers pass structured argv and return backend failures.

Renderer store tests:

- Remote branch actions call `remote.*`, never `repo.*`.
- Network remote actions mark `resources.fetch`.
- Write remote actions mark `resources.branchAction`.
- Success triggers remote refresh workflow.
- Stale tokens do not mutate reopened repos.

UI tests:

- Remote right-side detail action area shows the expected actions by branch capability.
- Embedded Terminal tab appears for remote branches with `worktreePath`.
- External terminal action appears separately from the embedded tab.
- Finder remains hidden for remote repos.
- Local action visibility remains unchanged.

Verification:

- `bun run test -- src/main/ssh/commands.test.ts src/main/ssh/git.test.ts src/main/rpc.test.ts`
- `bun run test -- src/renderer/stores/repos/branch-actions.test.ts src/renderer/stores/repos/refresh.test.ts`
- `bun run test -- src/renderer/hooks/useBranchActionItems.test.tsx src/renderer/hooks/branch-action-state.test.ts`
- `bun run typecheck`

Manual verification should cover a real SSH remote repository with a changed worktree, branch with upstream, branch without worktree, protected branch, and remote editor/terminal settings.

## GSD Planning Update

The active GSD docs currently describe Phase 2 as read-only and explicitly hide several remote actions. Implementation should update the relevant `.planning/phases/02-remote-git-read-model/*` and roadmap notes before or alongside the code change so planning artifacts match the accepted feature boundary.

The updated boundary is:

- Phase 2 still owns remote read model and UI presentation.
- This follow-up expands remote branch action support inside the selected branch detail surface.
- Full remote behavior is implemented through typed RPC and guarded SSH command primitives, not a generic command surface.
