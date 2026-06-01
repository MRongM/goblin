# Remote Tracking Checkout On SSH Host Design

## Goal

Allow SSH remote repositories to check out remote-tracking branches on the SSH host itself. For example, selecting `origin/feature/x` in an SSH remote repository should create and track the remote host's local branch `feature/x` with `git switch -c feature/x --track origin/feature/x`.

This does not clone, materialize, or cache the repository on the user's computer.

## Decisions

- The repository remains on the SSH host.
- Remote-tracking checkout uses the existing `checkoutRemoteBranch` branch action.
- Renderer code may decide whether the action is visible, but it does not derive shell commands.
- Main process validates and converts `origin/feature/x` to `feature/x`.
- SSH command construction stays in `src/main/ssh/commands.ts`.
- Successful checkout uses the existing branch action refresh workflow.
- No git commits are part of this work.

## Architecture

Remote snapshots currently return local branches from `refs/heads/`. They must also return remote-tracking refs from `refs/remotes/` that do not already have a local branch. This mirrors local repository behavior and gives the renderer a branch row to act on.

The branch action flow stays unified:

1. `RepoToolbarActions` exposes a checkout menu when remote-tracking branches are present.
2. `runBranchAction(..., { kind: 'checkoutRemoteBranch' })` routes by `repo.kind`.
3. Local repositories call `rpc.repo.checkoutRemoteBranch`.
4. SSH remote repositories call `rpc.remote.checkoutRemoteBranch`.
5. Main process validates the target and remote branch, then runs a whitelisted SSH Git command.

## Git Behavior

Given `origin/feature/x`:

- Reject invalid branch names, refs without a slash, `origin/HEAD`, and malformed local names.
- Derive `feature/x`.
- Run `git -C <remote repo path> switch -c <feature/x> --track <origin/feature/x>`.

The command intentionally runs in the remote repository path, not in a worktree path, because this operation creates the server-local branch for the remote repository.

## UI

The toolbar checkout menu should be available for both local repositories and SSH remote repositories when a remote-tracking branch exists and is not already checked out in a worktree. The visible label should avoid implying that SSH remote checkout happens on the user's computer.

## Testing

- Remote snapshot includes remote-tracking refs that have no matching local branch.
- Remote snapshot filters `origin/HEAD` and refs whose local branch already exists.
- SSH command builder quotes remote branch and derived local branch.
- SSH Git helper routes checkout through the new command.
- RPC exposes `remote.checkoutRemoteBranch` and rejects invalid inputs.
- Renderer store routes remote `checkoutRemoteBranch` to `rpc.remote.checkoutRemoteBranch`.
- Toolbar renders the checkout menu for SSH remote repositories with remote-tracking branches.
