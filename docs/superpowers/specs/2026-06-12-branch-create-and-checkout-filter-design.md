# Branch Create And Checkout Filter Design

## Goal

Branch write actions should cover three related workflows without changing the user's current checkout unexpectedly:

- Create a local branch from the selected branch row.
- Create a local tracking branch from a remote-tracking branch.
- Switch a worktree only to branches that are safe to check out in that worktree.

All three workflows should reuse the existing branch action and repository refresh paths. They should not create worktrees, push to remotes, delete refs, or switch after creating a branch.

## Scope

In scope:

- Add a separate `Create Branch` branch-row menu item.
- Add a separate `Track Remote Branch` branch-row menu item.
- Create a local branch from the selected branch row as the base.
- Create a local tracking branch from a remote-tracking ref such as `origin/feature/name`.
- Keep both create actions non-checkout operations.
- Filter checkout candidates so a worktree cannot switch to the current branch or to any branch already checked out by another worktree.
- Support local and SSH-backed remote repositories through the existing backend boundary.
- Add focused validation, UI, store, server, system git, and remote command tests.

Out of scope:

- Creating a worktree.
- Switching to the newly created branch.
- Fetching before listing remote-tracking branches.
- Pushing newly created branches.
- Deleting, renaming, or force-updating branches.
- Global toolbar branch creation.
- A broad branch action menu redesign.

## Current State

The repository already has a branch action pipeline that handles checkout, pull, push, worktree creation, branch deletion, and worktree removal. `createWorktree` supports creating a new branch as part of worktree creation, but there is no action that only creates a branch.

The branch-row write hook already hosts worktree-scoped dialogs for checkout-to, merge, commit, and reset-hard. Those actions currently call direct client endpoints for worktree-specific operations. Repository-level branch actions use `RepoBranchAction` and `runBranchAction`, which provide scheduling, operation state, result events, invalidation source tokens, and refresh orchestration.

Remote repositories already route git mutations through `RepoBackend` and `RemoteCommandKind`. Remote branch listing exists through `getRepositoryRemoteBranches`, which returns remote-tracking refs after filtering out invalid refs and remote HEAD aliases.

## Interaction Design

Branch rows gain two independent menu items:

- `Create Branch`
- `Track Remote Branch`

`Create Branch` opens a small dialog. The selected row branch is shown as the base branch. The user enters only the new branch name. On submit, Goblin creates the branch from that base and closes the dialog. The active worktree, current branch, selection, and detail tab do not change except through the normal snapshot refresh.

`Track Remote Branch` opens a separate dialog. It loads remote-tracking branches through `getRepositoryRemoteBranches(repo.id)`. The user picks a remote ref, and Goblin derives a default local branch name with the existing `deriveLocalBranchFromRemoteRef` rule. The user may edit the local branch name. On submit, Goblin creates a local tracking branch and does not switch.

`Checkout To` keeps its existing menu item, but its dialog only lists safe local branch candidates:

- Exclude the branch currently checked out in the target worktree.
- Exclude every branch that has `branch.worktree?.path`, because it is already checked out in some worktree.
- Keep only local branches from the current snapshot.

If no candidate exists, the dialog shows an empty state and disables the confirm button.

## Architecture

The feature should follow existing repository boundaries.

### Shared

Add a small branch-create input model near existing shared git/worktree helpers:

```ts
type CreateBranchInput =
  | { kind: 'local'; branch: string; baseBranch: string }
  | { kind: 'trackRemote'; localBranch: string; remoteRef: string }
```

Validation should reuse `validateBranchName`, `isSafeBranchName`, `parseRemoteTrackingRefs`, and `deriveLocalBranchFromRemoteRef` where applicable. Input normalization should reject missing strings, invalid branch names, invalid remote-tracking refs, and duplicate local branch names when the current branch snapshot is available in the UI.

Add a pure checkout candidate helper near the branch write dialog or repo branch view helpers:

```ts
checkoutBranchCandidates(currentBranch: string, branches: RepoBranchState[]): RepoBranchState[]
```

The helper should not mutate arrays and should be directly unit tested.

### System Git

Add focused system git helpers in `src/system/git/branches.ts`:

```ts
createBranch(cwd, newBranch, baseBranch, signal?)
createTrackingBranch(cwd, localBranch, remoteRef, signal?)
```

Both helpers validate user-controlled refs before invoking git. Local branch creation should execute the equivalent of:

```text
git branch -- <newBranch> <baseBranch>
```

Remote-tracking creation should execute the equivalent of:

```text
git branch --track <localBranch> <remoteRef>
```

### Remote Git

Extend `RemoteCommandKind` with two explicit commands rather than embedding ad hoc shell strings in the backend:

```ts
{ type: 'gitBranchCreate'; path: string; branch: string; baseBranch: string }
{ type: 'gitBranchTrackRemote'; path: string; localBranch: string; remoteRef: string }
```

`src/system/ssh/git.ts` should expose remote equivalents that validate names and remote refs before calling `runRemoteCommand`.

### Server

Extend `RepoBackend` with branch creation methods:

```ts
createBranch(input, signal?)
```

The local backend delegates to system git helpers. The remote backend delegates to remote git helpers. Both paths publish repo snapshot invalidation only on success through the existing repository write path.

Expose endpoints under `src/server/routes/repo.ts`:

- `/api/repo/create-branch`
- `/api/repo/track-remote-branch`

The route layer only parses JSON and delegates to `repo-write-paths`. It should not contain orchestration or branch policy logic.

### Renderer Store

Extend `RepoBranchAction`:

```ts
| { kind: 'createBranch'; branch: string; baseBranch: string }
| { kind: 'trackRemoteBranch'; localBranch: string; remoteRef: string }
```

Add both action kinds to:

- branch action reason mapping
- operation target mapping
- event action mapping
- RPC dispatch
- scheduler tests where branch action kinds are enumerated

These actions should use the existing non-network write lane. They do not need the network fetch lane because they only operate on already known refs.

### Renderer UI

Add two dialogs in `src/web/components/branch-list/BranchWriteDialogs.tsx` or a nearby focused file:

- `CreateBranchDialog`
- `TrackRemoteBranchDialog`

`useBranchWriteActions` should add two menu items with lucide icons:

- `GitBranchPlus` for create branch.
- `RadioTower` or another existing remote-style icon for tracking a remote branch.

The actions should be visible for regular branch rows. They should be disabled while the repository branch action operation is busy, consistent with existing action disabling.

## Data Flow

### Create Branch

1. User opens a branch row menu and selects `Create Branch`.
2. Dialog receives the selected row branch as `baseBranch`.
3. User enters a new branch name.
4. UI validates branch name and duplicate local branch names.
5. Dialog submits `RepoBranchAction { kind: 'createBranch', branch, baseBranch }`.
6. Store schedules the action in the write lane.
7. Client posts to `/api/repo/create-branch`.
8. Server resolves local or remote backend.
9. Backend creates the branch.
10. On success, repo snapshot invalidation and refresh update the branch list.

### Track Remote Branch

1. User opens a branch row menu and selects `Track Remote Branch`.
2. Dialog loads remote-tracking refs via `getRepositoryRemoteBranches`.
3. User selects a remote ref.
4. UI derives a local branch name and allows edits.
5. UI validates branch name and duplicate local branch names.
6. Dialog submits `RepoBranchAction { kind: 'trackRemoteBranch', localBranch, remoteRef }`.
7. Store schedules the action in the write lane.
8. Client posts to `/api/repo/track-remote-branch`.
9. Server resolves local or remote backend.
10. Backend creates the local tracking branch.
11. On success, repo snapshot invalidation and refresh update the branch list.

## Error Handling

Client-side validation should prevent obvious invalid submissions:

- Empty branch name.
- Invalid git branch name.
- Existing local branch name.
- Missing remote-tracking ref.
- Invalid derived local branch name.

Server-side validation remains authoritative and returns structured `ExecResult` failures:

- `error.invalid-arguments` for invalid branch or remote ref inputs.
- `error.failed-read-repo` for route-level fallback failures.
- Raw git output for race conditions such as a branch created after the dialog opened.
- `cancelled` when the request signal aborts.

Remote branch list loading failure should leave the dialog in an empty state with the confirm button disabled. It should not create a branch from arbitrary free-form remote ref input.

No additional destructive confirmation is required because these workflows only create local refs. They do not delete, reset, force-update, push, or modify worktree files.

## Testing

Add focused coverage:

- Checkout candidate helper excludes the current branch.
- Checkout candidate helper excludes branches checked out in any worktree.
- Checkout candidate helper keeps local branches without worktree paths.
- Create branch dialog validates branch names and duplicate names.
- Create branch dialog submits the selected row branch as base.
- Track remote branch dialog loads remote refs, derives local names, validates duplicates, and handles an empty remote ref list.
- `RepoBranchAction` store tests cover both new action kinds, event action mapping, refresh after success, and no refresh suppression on normal failures.
- `repo-client` tests cover both new endpoints.
- Server route and backend tests cover local and remote success and invalid input.
- `src/system/git/branches.test.ts` covers git argument construction and invalid names.
- `src/system/ssh/commands` or `src/system/ssh/git` tests cover remote command construction and invalid inputs.
- Existing checkout, worktree create, merge, commit, reset, pull, and push tests remain green.

## Verification

Implementation should pass:

```text
bun run typecheck
bun run test
bun run check:architecture
```

Manual verification should cover:

- Create a local branch from a selected non-current branch row and confirm the current checkout does not change.
- Track `origin/feature/example` into local `feature/example` and confirm the current checkout does not change.
- Try tracking a remote ref whose derived local branch already exists and confirm submission is blocked.
- Open `Checkout To` for a worktree and confirm the current branch and all branches already checked out in worktrees are absent.
- Confirm no menu action pushes, deletes, resets, or creates a worktree.
