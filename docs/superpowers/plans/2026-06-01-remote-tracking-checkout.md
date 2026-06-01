# Remote Tracking Checkout On SSH Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Git commit steps are intentionally omitted because project instructions forbid commits unless explicitly requested.

**Goal:** SSH remote repositories can promote `origin/*` remote-tracking branches into server-local branches.

**Architecture:** Extend remote snapshot to include unpromoted `refs/remotes/` refs, add a typed `remote.checkoutRemoteBranch` RPC, and route the existing renderer `checkoutRemoteBranch` action by repository kind. Keep branch-name parsing and SSH command construction in main process.

**Tech Stack:** Electron main process, tRPC, Valibot, Vitest, React renderer, Zustand store, SSH command whitelist.

---

### File Structure

- Modify `src/main/ssh/commands.ts`: add a whitelisted `gitCheckoutRemoteTracking` command.
- Modify `src/main/ssh/git.ts`: parse remote-tracking refs in snapshots and add the checkout helper.
- Modify `src/shared/rpc.ts`: add `remote.checkoutRemoteBranch` to the typed contract and router.
- Modify `src/main/rpc.ts`: validate and route the new remote RPC.
- Modify `src/renderer/stores/repos/branch-actions.ts`: route remote `checkoutRemoteBranch` to remote RPC.
- Modify `src/renderer/components/repo-toolbar/RepoToolbarActions.tsx`: show checkout menu for remote repositories too.
- Modify tests near each layer.

### Task 1: Remote Snapshot Remote-Tracking Branches

- [ ] Add a failing test in `src/main/ssh/git.test.ts` proving `getRemoteSnapshot` returns `origin/feature/y` with `remoteTracking: true` when only `feature/x` exists locally.
- [ ] Run `bun run test src/main/ssh/git.test.ts` and verify that test fails because remote-tracking refs are absent.
- [ ] Update `src/main/ssh/commands.ts` `gitSnapshot` to emit a new remote-tracking section from `refs/remotes/`.
- [ ] Update `src/main/ssh/git.ts` parsing to merge local branches with remote-tracking refs whose `localName` is not already local and is not `HEAD`.
- [ ] Re-run `bun run test src/main/ssh/git.test.ts` and verify it passes.

### Task 2: SSH Checkout Command And Helper

- [ ] Add a failing test in `src/main/ssh/commands.test.ts` for `gitCheckoutRemoteTracking` producing `git -C '<repo>' switch -c '<local>' --track '<remote>'`.
- [ ] Add a failing test in `src/main/ssh/git.test.ts` for `checkoutRemoteTrackingBranchOnRemote`.
- [ ] Run the focused tests and verify they fail because the command/helper do not exist.
- [ ] Add the command kind and script builder in `src/main/ssh/commands.ts`.
- [ ] Add `checkoutRemoteTrackingBranchOnRemote` in `src/main/ssh/git.ts`, deriving local branch name from the remote-tracking ref and rejecting invalid input.
- [ ] Re-run focused tests.

### Task 3: RPC And Store Routing

- [ ] Add a failing RPC test in `src/main/rpc.test.ts` for `remote.checkoutRemoteBranch`.
- [ ] Add a failing store test in `src/renderer/stores/repos/branch-actions.test.ts` proving remote `checkoutRemoteBranch` calls `remote.checkoutRemoteBranch`.
- [ ] Run both focused test files and verify failures.
- [ ] Add the remote RPC contract and router in `src/shared/rpc.ts`.
- [ ] Add the main RPC handler in `src/main/rpc.ts`.
- [ ] Route remote `checkoutRemoteBranch` in `src/renderer/stores/repos/branch-actions.ts`.
- [ ] Re-run both focused test files.

### Task 4: Toolbar Availability

- [ ] Add a failing UI test in `src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx` proving an SSH remote repo with `origin/feature/x` renders the checkout menu.
- [ ] Update `RepoToolbarActions.tsx` so both local and remote repositories use the same remote-tracking branch filter.
- [ ] Use remote-specific tooltip/copy only if the existing i18n keys are insufficient.
- [ ] Re-run the toolbar test.

### Task 5: Verification

- [ ] Run `bun run test src/main/ssh/commands.test.ts src/main/ssh/git.test.ts src/main/rpc.test.ts src/renderer/stores/repos/branch-actions.test.ts src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx`.
- [ ] Run `bun run typecheck`.
- [ ] Review `git diff` to ensure no unrelated user changes were reverted.
