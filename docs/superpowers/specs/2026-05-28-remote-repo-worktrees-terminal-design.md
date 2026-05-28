# Remote Repository Worktrees And Terminal Design

## Goal

Give SSH remote repositories first-class support for manual refresh, remote worktree creation, remote worktree status, branch commit logs, and an embedded Goblin terminal that automatically opens in the selected remote worktree.

The design keeps the existing product model: a remote repository remains on the SSH host. Goblin should not clone it locally or treat remote paths as local filesystem paths.

## Confirmed Decisions

- Remote worktrees are created on the remote SSH host.
- The terminal is embedded in Goblin and automatically enters the selected remote worktree directory.
- Manual refresh runs remote `git fetch --all --prune` before refreshing repository data.
- Background refresh does not run remote fetch.
- Remote worktree default paths follow the current local rule: a sibling of the repository path using the new branch slug.
- Remote refresh includes worktree metadata and dirty/status data.
- Remote Commit logs are supported through SSH.
- Scope is limited to refresh, new worktree, status, commits, and terminal. Checkout, pull, push, delete, remove, editor, and GitHub actions remain unavailable for remote repositories.

## Scope

In scope:

- Remote manual fetch and refresh.
- Remote snapshot with branches, current branch, default branch, and worktree metadata.
- Remote status for all known non-bare worktrees.
- Remote branch log loading and pagination.
- Remote worktree creation with `git worktree add -b`.
- Embedded remote terminal sessions keyed by remote repository target and remote worktree path.
- UI changes to expose refresh, new worktree, status, commits, and terminal for remote repositories.

Out of scope:

- Remote checkout, pull, push, delete branch, remove worktree, open editor, or open GitHub/PR.
- Local materialization or caching clones of remote repositories.
- Destructive remote worktree removal.
- Password or passphrase collection inside Goblin.
- Background remote fetch.

## Architecture

Remote repositories continue to use `RepoState.kind === 'remote'` with `remoteTarget`. No new repository kind is introduced.

Renderer store actions branch by `repo.kind` at the RPC boundary:

- Local repositories keep using `rpc.repo.*`.
- Remote repositories use new `rpc.remote.*` procedures.

The renderer should continue to use the existing resource lifecycle:

- `resources.fetch` for manual remote fetch.
- `resources.snapshot` for remote branch/worktree snapshots.
- `resources.status` for remote worktree status.
- `resources.logsByBranch` for remote commits.
- `resources.branchAction` for remote worktree creation.

Execution-only details stay in `runtime.ts` and `operation-runner.ts`. Remote support must not reintroduce `repo.ops` or put queue state on `RepoState`.

Main-process SSH and Git behavior lives behind `src/main/ssh/*`. The renderer never builds SSH commands. It passes a validated `RemoteRepoTarget` to main process RPC, and main owns shell quoting, timeouts, cancellation, and command construction.

## Remote Git Commands

`src/main/ssh/commands.ts` should support these command kinds:

- `gitFetch`: `git -C <repo> fetch --all --prune`
- `gitWorktreeList`: `git -C <repo> worktree list --porcelain`
- `gitStatus`: `git -C <worktree> status --porcelain -z`
- `gitLog`: `git -C <repo> log <branch> --format=<FIELD_SEP format> --max-count=<n> --skip=<n>`
- `gitWorktreeAdd`: `git -C <repo> worktree add -b <newBranch> -- <worktreePath> <baseBranch>`
- `openRemoteTerminal`: used by terminal IPC to enter the remote worktree inside an interactive SSH session.

All path and branch arguments must be shell-quoted by command builders. Branch names still pass shared refname validation before reaching command construction.

Timeouts:

- Read commands can use the existing SSH command timeout unless tests show status over many worktrees needs a dedicated budget.
- Worktree creation should use a longer timeout comparable to local worktree operations.
- Terminal sessions are interactive and should not use the short command timeout after connection is established.

## Remote Snapshot And Status

Remote snapshot returns the existing shared shape:

```ts
interface RepoSnapshot {
  branches: BranchInfo[]
  current: string
}
```

Implementation:

1. Run the existing branch snapshot command.
2. Run remote `git worktree list --porcelain`.
3. Parse worktrees with the existing `parseWorktrees`.
4. For each non-bare worktree, run remote `git status --porcelain -z` with bounded concurrency.
5. Pass the parsed worktrees into `parseBranches` so branches get `worktreePath`, `worktreeDirty`, `worktreeChangeCount`, `worktreeIsPrimary`, and `worktreeLocked`.

Remote status returns the existing `WorktreeStatus[]` shape. Each `path` is a remote absolute path. Renderer code must not validate those paths with local filesystem validators.

Snapshot and status are related but separate resources. Snapshot marks the branch rows and worktree badges; status powers the Changes tab and patch-related counts. Remote copy-patch remains out of scope.

## Remote Logs

Remote `refreshBranchLog` uses `rpc.remote.log({ target, branch, count, skip })`.

The response shape remains `LogEntry[]`, parsed with the existing `parseLog`. Pagination uses the existing `INITIAL_LOG_COUNT`, `LOG_PAGE_SIZE`, and `MAX_LOG_COUNT` renderer behavior.

Pull request refresh stays unavailable for remote repositories. Existing PR resources should not be started for remote repos.

## Manual Refresh

For local repositories, `syncAndRefresh` remains unchanged.

For remote repositories:

1. Validate that the repo has a fresh token and a `remoteTarget`.
2. Check existing resource/runtime blockers for fetch, branch action, snapshot, and status.
3. Start `resources.fetch`.
4. Call `rpc.remote.fetch({ target })`.
5. Finish fetch resource based on result.
6. Run the existing manual refresh workflow, adjusted so remote repos refresh snapshot/status and visible commits but skip PRs.
7. Show the fetch result through the existing repo event/toast path.

Background fetch continues to skip remote repositories. Background or on-demand read refresh may still load snapshot/status/log where the current workflow already requests those reads.

## Remote Worktree Creation

The existing `CreateWorktreeDialog` is reused with remote-aware path behavior.

For a remote repository at `/srv/goblin` and new branch `feat/x`, the default worktree path is `/srv/goblin-feat-x`. The user may override it with any remote absolute path. `~` expansion and local `tildify` display are not used for remote paths.

Submit flow:

1. Validate new branch name with `validateBranchName`.
2. Validate base branch from current remote branch list.
3. Validate worktree path as a remote absolute path: starts with `/` and contains no null byte.
4. Start `resources.branchAction` with kind `createWorktree`.
5. Call `rpc.remote.createWorktree({ target, worktreePath, newBranch, baseBranch })`.
6. On success, refresh remote snapshot and status.
7. On failure, surface the raw git/SSH message.

The existing local `createWorktree` branch action remains local-only. Remote creation can either extend the branch action RPC switch with a remote branch, or add a focused store helper. The preferred implementation is to keep one UI action path while selecting `repo.createWorktree` vs `remote.createWorktree` at the store/RPC boundary.

## Embedded Remote Terminal

Remote terminal support extends the terminal input model with a discriminated target:

```ts
type TerminalOpenInput =
  | {
      kind: 'local'
      repoRoot: string
      branch: string
      worktreePath: string
      terminalId: string
      cols: number
      rows: number
    }
  | {
      kind: 'remote'
      target: RemoteRepoTarget
      branch: string
      worktreePath: string
      terminalId: string
      cols: number
      rows: number
    }
```

The current local input can be migrated conservatively by defaulting missing `kind` to `local` at the IPC boundary if needed, but new renderer code should send `kind` explicitly.

For remote sessions, main starts a local PTY running `ssh` with the validated target and an interactive remote command that changes to the remote worktree and execs the remote shell. The command should fail fast when `cd` fails and should preserve interactive terminal behavior.

Session keys must distinguish local and remote sessions. A remote key should include the normalized remote repo id, remote worktree path, and terminal id. Pruning must only close sessions in the matching local or remote scope.

`TerminalSlot` can be reused by passing a terminal base that includes repo kind and remote target. The switcher, search, replay, resize, write, restart, and close behavior remain shared.

## UI

Remote repository toolbar:

- Show `Refresh` for manual remote fetch + refresh.
- Show `New worktree` when a remote target is available and no blocking operation is running.
- Keep diagnostics visible as a badge or retry affordance.
- Disable remote refresh and new worktree when the target is invalid or diagnostics/resource state blocks the action.

Remote branch detail:

- Show Status, Changes, and Commits for the selected remote branch.
- Show Terminal only when the selected branch has a remote worktree path.
- In Changes, show the existing no-worktree empty state when the selected branch has no remote worktree.
- Keep branch action buttons hidden for remote repositories.

Remote branch list:

- Continue to show branch rows with worktree and dirty indicators.
- Use remote `worktreePath` only as display and identity data, not as a local filesystem path.

## Error Handling

Remote command failures are reported as `ExecResult` or resource errors using stderr when available.

Rules:

- Snapshot failure marks only `resources.snapshot`.
- Status failure marks only `resources.status` and keeps prior status data stale.
- Log failure marks only the selected branch log resource.
- Fetch failure marks `resources.fetch`, emits a repo event, and does not auto-retry.
- Worktree creation failure marks `resources.branchAction`, emits a repo event, and does not refresh unless explicitly useful.
- Cancellation returns `cancelled` and should not show noisy failure toasts.

Common git failures such as branch already exists, path already exists, permission denied, missing parent directory, and remote command timeout should surface without custom parsing unless a focused translation already exists.

## Safety And Boundaries

The implementation must preserve existing safety boundaries:

- No destructive remote actions are introduced.
- No password, passphrase, or private key content is collected.
- Renderer never constructs shell commands.
- Remote paths are not passed to local filesystem APIs.
- Runtime operation state stays out of `RepoState`.
- Background fetch does not run on remote repositories.

## Testing

Main process tests:

- SSH command builders quote fetch/status/log/worktree-list/worktree-add/terminal commands correctly.
- Remote snapshot parser merges branches and worktrees correctly.
- Remote status handles multiple worktrees and dirty counts.
- Remote fetch and create worktree map success/failure to `ExecResult`.
- Terminal remote input validation rejects malformed targets, invalid terminal ids, and invalid remote paths.

Renderer store tests:

- Remote `refreshSnapshot` calls `rpc.remote.snapshot`.
- Remote `refreshStatus` calls `rpc.remote.status`.
- Remote `refreshBranchLog` calls `rpc.remote.log`.
- Remote `syncAndRefresh` calls `rpc.remote.fetch` only for manual refresh.
- Remote worktree creation calls `rpc.remote.createWorktree` and refreshes snapshot/status on success.
- Remote workflows do not start PR refreshes.

UI tests:

- Remote toolbar shows Refresh and New worktree.
- Remote toolbar retains diagnostics visibility.
- Remote branch actions remain hidden.
- Remote Terminal tab appears only for branches with remote worktree paths.
- Create worktree dialog computes remote sibling defaults and accepts remote absolute paths.

Terminal tests:

- Local terminal behavior remains unchanged.
- Remote session keys are isolated from local sessions.
- Remote prune closes only matching remote sessions.
- Restart uses the same remote target and worktree path.

## Implementation Notes

Keep the work incremental:

1. Add remote Git command/RPC primitives with tests.
2. Wire renderer refresh/status/log flows for remote repos.
3. Add remote worktree creation using existing resource lifecycle.
4. Extend terminal input/session handling for remote sessions.
5. Update UI affordances and tests.

This order keeps each layer testable before UI changes depend on it.
