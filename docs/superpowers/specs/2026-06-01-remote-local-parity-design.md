# Remote Local Parity Design

## Goal

Close the highest-value feature gaps between local repositories and SSH remote repositories without expanding the SSH remote model beyond server-side Git operations.

This phase adds:

- Commit detail support for SSH remote repositories.
- Upstream deletion parity for SSH remote branch deletion and worktree removal.

This phase does not add remote pull request metadata, server-side clone, remote cache persistence, or new SSH initialization behavior.

## Current Gaps

Local repositories can open a commit from the log and show its commit detail. SSH remote repositories already load branch logs, but `openCommit` exits early for remote repositories, so the commit detail panel never opens.

Local repositories can optionally delete the upstream branch when deleting a local branch or removing a worktree and deleting its branch. SSH remote repositories expose the same confirmation UI, but the remote RPC and SSH Git layer do not accept or execute the `alsoDeleteUpstream` option.

## Decisions

- Reuse the existing `CommitDetail` UI and renderer state shape.
- Add `remote.commit` with the same `CommitDetail | null` return contract as `repo.commit`.
- Keep commit detail parsing in main-process Git helpers, not renderer code.
- Keep all SSH command construction in `src/main/ssh/commands.ts`.
- Route `openCommit` by `repo.kind` instead of blocking remote repositories.
- Add `alsoDeleteUpstream` to remote branch deletion and remote worktree removal contracts.
- Delete upstream only after the server-local branch/worktree operation succeeds.
- Do not delete upstream when the upstream remote is `.` or when no upstream is configured.
- Preserve existing protected-branch, current-branch, checked-out-branch, dirty-worktree, and force-delete safeguards.
- Do not introduce local materialization or local clones for SSH remote repositories.

## Architecture

### Remote Commit Detail

The shared RPC contract gains:

- `remote.commit({ target, hash }) => Promise<CommitDetail | null>`

The renderer `openCommit` flow changes from local-only to kind-based dispatch:

1. Validate that the repo still exists and the instance token is current.
2. Set `repo.ui.commitDetail` to `{ phase: 'opening', hash }`.
3. For local repositories, call `rpc.repo.commit`.
4. For SSH remote repositories, call `rpc.remote.commit`.
5. Apply the existing detail result to `repo.ui.commitDetail`.

The main process validates the remote target and commit hash, then asks the SSH Git helper for commit detail. The helper runs a whitelisted remote Git command and returns the existing `CommitDetail` shape, so `CommitDetail.tsx` stays unchanged.

### Remote Upstream Deletion

The shared RPC contract extends:

- `remote.deleteBranch({ target, branch, force, alsoDeleteUpstream })`
- `remote.removeWorktree({ target, branch, worktreePath, alsoDeleteBranch, forceDeleteBranch, alsoDeleteUpstream })`

Renderer branch actions already carry `alsoDeleteUpstream` for local operations. The remote dispatch path should forward that option instead of dropping it.

Main-process remote branch deletion follows this order:

1. Validate target and branch.
2. Reject protected/current/checked-out branches using existing remote safeguards.
3. Verify safe deletion unless force was requested.
4. Resolve `branch@{u}`.
5. Delete the server-local branch.
6. If requested and the upstream is delete-eligible, delete the upstream ref with `git push <remote> --delete <branch>`.

Remote worktree removal follows the existing flow and adds upstream deletion only when `alsoDeleteBranch` is true and the server-local branch deletion succeeds.

## Git Behavior

### Commit Detail Command

Remote commit detail should use Git plumbing that is deterministic and parseable. It should include:

- Full hash and short hash.
- Subject/body metadata needed by the existing `CommitDetail` UI.
- Author and committer fields matching local detail behavior.
- File stats matching local detail behavior.

The command must accept only validated hashes and must run under the remote repository path.

### Upstream Delete Command

Given upstream `origin/feature/x`, delete it with:

```sh
git -C <remote repo path> push origin --delete feature/x
```

Given upstream `./feature/x`, do not run an upstream delete command because `.` is a local repository remote.

Given no upstream, treat upstream deletion as a no-op after local branch deletion succeeds.

## Error Handling

- Remote commit returns `null` when Git cannot load the commit, matching local behavior.
- Remote commit errors should reset the commit detail state to idle and emit the existing repo error event.
- Upstream deletion failure should return a failed `ExecResult` after the local branch deletion succeeds, so the user sees that cleanup was incomplete.
- Cancellation should preserve the existing `cancelled` result convention.
- Validation failures return existing error keys such as `error.invalid-arguments`.

## Testing

Add or update tests for:

- Shared RPC contract exposes `remote.commit` and the new `alsoDeleteUpstream` inputs.
- Main RPC validates remote commit inputs and routes to the SSH Git helper.
- SSH command builder includes a whitelisted commit detail command.
- SSH Git helper parses remote commit detail into the existing `CommitDetail` shape.
- Renderer `openCommit` calls `rpc.remote.commit` for SSH remote repositories.
- Renderer `openCommit` still calls `rpc.repo.commit` for local repositories.
- Remote branch action dispatch forwards `alsoDeleteUpstream` to `remote.deleteBranch`.
- Remote worktree removal forwards `alsoDeleteUpstream` to `remote.removeWorktree`.
- Remote delete branch deletes upstream only when requested and eligible.
- Remote remove worktree deletes upstream only after branch deletion succeeds.
- Upstream remote `.` and missing upstream do not run `git push --delete`.

## Acceptance Criteria

- Clicking a commit in an SSH remote repository opens the existing commit detail panel.
- Local commit detail behavior is unchanged.
- SSH remote branch deletion can delete the configured upstream when the user selects that option.
- SSH remote worktree removal can delete both the server-local branch and its configured upstream when the user selects those options.
- Existing SSH remote branch/worktree safety checks continue to apply.
- `bun run test` passes.
- `bun run typecheck` passes.
