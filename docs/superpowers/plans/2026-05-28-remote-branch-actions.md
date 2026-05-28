# Remote Branch Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SSH remote repository branch actions work from the right-side branch detail area with the same safety model as local repositories.

**Architecture:** Keep the existing local/remote repository split in `RepoState.kind`. Renderer actions stay shared, but remote-capable actions route to typed `rpc.remote.*` procedures. Main process owns all SSH command construction, validation, destructive guards, external app launching, and URL derivation through structured whitelist commands.

**Tech Stack:** TypeScript, React, Zustand, tRPC/valibot, Electron IPC, OpenSSH via `execa`, node-pty, Vitest.

---

Project instruction override: `AGENTS.md` says not to plan or execute git commits unless the user explicitly asks. This plan intentionally omits commit steps even though the generic writing-plans skill recommends frequent commits.

## Scope Check

The spec touches SSH command primitives, remote Git services, RPC contracts, renderer action routing, terminal/editor app integrations, UI capability rules, tests, and GSD planning docs. These are sequential parts of one vertical feature: remote branch actions. Splitting them into separate implementation plans would expose UI actions without safe backend support or create backend APIs without a reachable UI, so this remains one plan with layered tasks.

## File Structure

- Modify `src/main/ssh/commands.ts`: add structured remote Git command kinds for patch, checkout, pull, push, worktree add/remove, branch delete, upstream checks, origin URL reads, and external terminal SSH invocation reuse.
- Modify `src/main/ssh/commands.test.ts`: verify command shapes, shell quoting, numeric clamping, and absence of a generic command surface.
- Modify `src/main/ssh/git.ts`: implement remote branch action helpers and destructive guards.
- Modify `src/main/ssh/git.test.ts`: test helpers through fake remote runners without real SSH.
- Modify `src/main/system/terminals.ts`, `src/main/system/ghostty.ts`, `src/main/system/apple-terminal.ts`: add remote external terminal opening support.
- Modify `src/main/system/editors.ts`, `src/main/system/open-app.ts`, `src/main/system/vscode.ts`, `src/main/system/cursor.ts`, `src/main/system/windsurf.ts`: keep or restore remote editor opening support.
- Modify `src/shared/rpc.ts`: add typed `remote.*` procedure definitions and valibot schemas.
- Modify `src/main/rpc.ts`: wire remote handlers and validation to SSH Git/app helpers.
- Modify `src/main/rpc.test.ts`: verify callable remote procedures and invalid-input rejection.
- Modify `src/renderer/stores/repos/branch-actions.ts`: route remote branch actions through `rpc.remote.*`.
- Modify `src/renderer/stores/repos/branch-actions.test.ts`: verify resource state, lanes, and remote routing.
- Modify `src/renderer/hooks/branch-action-state.ts`, `src/renderer/hooks/useBranchActions.tsx`, `src/renderer/hooks/useBranchActionItems.ts`: expose fine-grained remote capabilities and remote UI actions.
- Modify tests beside those hooks: verify visible action ids for remote branches.
- Modify `src/renderer/components/branch-detail/BranchDetailToolbar.tsx`, `src/renderer/components/branch-detail/BranchDetailContent.tsx`: show remote action bar and embedded Terminal tab for remote worktrees.
- Modify `src/renderer/components/repo-toolbar/RepoToolbarActions.tsx`: restore remote worktree creation in the repo toolbar.
- Modify `src/main/i18n/en.ts`, `src/main/i18n/zh.ts`, `src/main/i18n/ja.ts`, `src/main/i18n/ko.ts`: add remote terminal/editor error copy only when missing.
- Modify `.planning/phases/02-remote-git-read-model/02-CONTEXT.md`, `.planning/phases/02-remote-git-read-model/02-03-PLAN.md`, and `.planning/ROADMAP.md`: update the GSD boundary to match approved remote branch action scope.

## Task 1: SSH Command Whitelist

**Files:**

- Modify: `src/main/ssh/commands.test.ts`
- Modify: `src/main/ssh/commands.ts`

- [ ] **Step 1: Write failing command-builder tests**

Append these tests inside the existing `describe` block in `src/main/ssh/commands.test.ts`:

```ts
test('builds remote branch action commands with quoted refs and paths', async () => {
  const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

  const checkout = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitCheckout',
    path: "/srv/team's app",
    branch: 'feature/x',
  })
  const push = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitPush',
    path: '/srv/goblin',
    branch: "feature/quote's",
  })
  const currentPull = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitPullCurrent',
    path: '/srv/goblin-feature-x',
  })
  const fetchBranch = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitFetchBranch',
    path: '/srv/goblin',
    remote: 'origin',
    remoteBranch: 'feature/x',
    branch: 'feature/x',
  })

  expect(checkout.script).toBe("git -C '/srv/team'\\''s app' checkout -- 'feature/x'")
  expect(push.script).toBe("git -C '/srv/goblin' push -u origin 'feature/quote'\\''s'")
  expect(currentPull.script).toBe("git -C '/srv/goblin-feature-x' pull --ff-only")
  expect(fetchBranch.script).toBe("git -C '/srv/goblin' fetch -- 'origin' 'feature/x:feature/x'")
})

test('builds remote destructive guard commands with quoted args', async () => {
  const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

  const remove = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitWorktreeRemove',
    path: '/srv/goblin',
    worktreePath: "/srv/goblin-feature's",
  })
  const safeDelete = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitBranchDelete',
    path: '/srv/goblin',
    branch: 'feature/delete',
    force: false,
  })
  const upstream = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitUpstream',
    path: '/srv/goblin',
    branch: "feature/quote's",
  })
  const ancestor = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitIsAncestor',
    path: '/srv/goblin',
    ancestor: "feature/quote's",
    descendant: 'origin/main',
  })

  expect(remove.script).toBe("git -C '/srv/goblin' worktree remove -- '/srv/goblin-feature'\\''s'")
  expect(safeDelete.script).toBe("git -C '/srv/goblin' branch -d -- 'feature/delete'")
  expect(upstream.script).toBe("git -C '/srv/goblin' rev-parse --abbrev-ref 'feature/quote'\\''s@{u}'")
  expect(ancestor.script).toBe(
    "git -C '/srv/goblin' merge-base --is-ancestor -- 'feature/quote'\\''s' 'origin/main'",
  )
})

test('builds remote origin and patch commands without raw command input', async () => {
  const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

  const origin = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitRemoteGetUrl',
    path: '/srv/goblin',
  })
  const patch = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitPatch',
    path: '/srv/goblin-feature-x',
  })

  expect(origin.script).toBe("git -C '/srv/goblin' remote get-url origin")
  expect(patch.script).toContain("git -C '/srv/goblin-feature-x' diff HEAD --binary")
  expect(patch.script).toContain("git -C '/srv/goblin-feature-x' status --porcelain -z -uall")
})
```

- [ ] **Step 2: Run the command tests and verify red**

Run:

```sh
bun run test "src/main/ssh/commands.test.ts"
```

Expected: FAIL because the new command kinds are not in `RemoteCommandKind`.

- [ ] **Step 3: Extend `RemoteCommandKind`**

In `src/main/ssh/commands.ts`, add these variants to `RemoteCommandKind`:

```ts
  | { type: 'gitPatch'; path: string }
  | { type: 'gitCheckout'; path: string; branch: string }
  | { type: 'gitPullCurrent'; path: string }
  | { type: 'gitFetchBranch'; path: string; remote: string; remoteBranch: string; branch: string }
  | { type: 'gitPush'; path: string; branch: string }
  | { type: 'gitWorktreeAdd'; path: string; worktreePath: string; newBranch: string; baseBranch: string }
  | { type: 'gitWorktreeRemove'; path: string; worktreePath: string }
  | { type: 'gitBranchDelete'; path: string; branch: string; force?: boolean }
  | { type: 'gitUpstream'; path: string; branch: string }
  | { type: 'gitIsAncestor'; path: string; ancestor: string; descendant: string }
  | { type: 'gitRemoteGetUrl'; path: string }
```

- [ ] **Step 4: Add command builders**

Add these `scriptForCommand` cases in `src/main/ssh/commands.ts`:

```ts
    case 'gitPatch':
      return [
        `git -C ${shellQuote(command.path)} diff HEAD --binary`,
        `git -C ${shellQuote(command.path)} status --porcelain -z -uall`,
      ].join('\n')
    case 'gitCheckout':
      return `git -C ${shellQuote(command.path)} checkout -- ${shellQuote(command.branch)}`
    case 'gitPullCurrent':
      return `git -C ${shellQuote(command.path)} pull --ff-only`
    case 'gitFetchBranch':
      return `git -C ${shellQuote(command.path)} fetch -- ${shellQuote(command.remote)} ${shellQuote(
        `${command.remoteBranch}:${command.branch}`,
      )}`
    case 'gitPush':
      return `git -C ${shellQuote(command.path)} push -u origin ${shellQuote(command.branch)}`
    case 'gitWorktreeAdd':
      return `git -C ${shellQuote(command.path)} worktree add -b ${shellQuote(command.newBranch)} -- ${shellQuote(
        command.worktreePath,
      )} ${shellQuote(command.baseBranch)}`
    case 'gitWorktreeRemove':
      return `git -C ${shellQuote(command.path)} worktree remove -- ${shellQuote(command.worktreePath)}`
    case 'gitBranchDelete':
      return `git -C ${shellQuote(command.path)} branch ${command.force ? '-D' : '-d'} -- ${shellQuote(
        command.branch,
      )}`
    case 'gitUpstream':
      return `git -C ${shellQuote(command.path)} rev-parse --abbrev-ref ${shellQuote(`${command.branch}@{u}`)}`
    case 'gitIsAncestor':
      return `git -C ${shellQuote(command.path)} merge-base --is-ancestor -- ${shellQuote(
        command.ancestor,
      )} ${shellQuote(command.descendant)}`
    case 'gitRemoteGetUrl':
      return `git -C ${shellQuote(command.path)} remote get-url origin`
```

- [ ] **Step 5: Run command tests and verify green**

Run:

```sh
bun run test "src/main/ssh/commands.test.ts"
```

Expected: PASS.

## Task 2: Remote Git Action Services

**Files:**

- Modify: `src/main/ssh/git.test.ts`
- Modify: `src/main/ssh/git.ts`

- [ ] **Step 1: Add failing service tests**

Add a `describe('remote git branch actions', () => { ... })` block to `src/main/ssh/git.test.ts`:

```ts
describe('remote git branch actions', () => {
  test('checks out a branch in the provided remote worktree path', async () => {
    const { checkoutRemoteBranch } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({ ok: true, stdout: '', stderr: '' }))

    await expect(checkoutRemoteBranch(TARGET, 'feature/x', '/srv/goblin-feature-x', { run })).resolves.toEqual({
      ok: true,
      message: 'ok',
    })

    expect(run).toHaveBeenCalledWith(
      { type: 'gitCheckout', path: '/srv/goblin-feature-x', branch: 'feature/x' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('pushes a branch from the remote repository path', async () => {
    const { pushRemoteBranch } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({ ok: true, stdout: 'pushed', stderr: '' }))

    await expect(pushRemoteBranch(TARGET, 'feature/x', { run })).resolves.toEqual({
      ok: true,
      message: 'pushed',
    })

    expect(run).toHaveBeenCalledWith(
      { type: 'gitPush', path: '/srv/goblin', branch: 'feature/x' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('removes a clean non-primary remote worktree without deleting the branch', async () => {
    const { removeRemoteWorktree } = await import('#/main/ssh/git.ts')
    const calls: string[] = []
    const run = vi.fn(async (command) => {
      calls.push(command.type)
      if (command.type === 'gitWorktreeList') {
        return {
          ok: true,
          stderr: '',
          stdout: [
            'worktree /srv/goblin',
            'HEAD abc1234',
            'branch refs/heads/main',
            '',
            'worktree /srv/goblin-feature-x',
            'HEAD def5678',
            'branch refs/heads/feature/x',
          ].join('\n'),
        }
      }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(
      removeRemoteWorktree(TARGET, {
        branch: 'feature/x',
        worktreePath: '/srv/goblin-feature-x',
        alsoDeleteBranch: false,
        forceDeleteBranch: false,
        run,
      }),
    ).resolves.toEqual({ ok: true, message: 'ok' })

    expect(calls).toEqual(['gitWorktreeList', 'gitStatus', 'gitWorktreeRemove'])
  })

  test('rejects dirty remote worktree removal', async () => {
    const { removeRemoteWorktree } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async (command) => {
      if (command.type === 'gitWorktreeList') {
        return {
          ok: true,
          stderr: '',
          stdout: [
            'worktree /srv/goblin',
            'HEAD abc1234',
            'branch refs/heads/main',
            '',
            'worktree /srv/goblin-feature-x',
            'HEAD def5678',
            'branch refs/heads/feature/x',
          ].join('\n'),
        }
      }
      if (command.type === 'gitStatus') return { ok: true, stderr: '', stdout: ' M file.txt\0' }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(
      removeRemoteWorktree(TARGET, {
        branch: 'feature/x',
        worktreePath: '/srv/goblin-feature-x',
        alsoDeleteBranch: true,
        forceDeleteBranch: false,
        run,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.cannot-remove-dirty-worktree' })
  })
})
```

- [ ] **Step 2: Run service tests and verify red**

Run:

```sh
bun run test "src/main/ssh/git.test.ts"
```

Expected: FAIL because remote action helpers are missing.

- [ ] **Step 3: Add shared execution helpers**

In `src/main/ssh/git.ts`, add imports and constants:

```ts
import { PROTECTED_BRANCHES, type ExecResult } from '#/shared/git-types.ts'

const REMOTE_BRANCH_OP_TIMEOUT_MS = 180_000
const REMOTE_PATCH_TIMEOUT_MS = 90_000
```

Add this result helper near existing private helpers:

```ts
function remoteExecResult(result: RemoteCommandResult): ExecResult {
  if (result.ok) return { ok: true, message: result.stdout || result.stderr || 'ok' }
  return { ok: false, message: result.message || result.stderr || 'error.unknown' }
}
```

- [ ] **Step 4: Add branch action helpers**

Add these exports to `src/main/ssh/git.ts`:

```ts
export async function checkoutRemoteBranch(
  target: RemoteRepoTarget,
  branch: string,
  worktreePath?: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    { type: 'gitCheckout', path: worktreePath ?? target.remotePath, branch },
    target,
    { signal: options.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}

export async function pushRemoteBranch(
  target: RemoteRepoTarget,
  branch: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    { type: 'gitPush', path: target.remotePath, branch },
    target,
    { signal: options.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}

export async function createRemoteWorktree(
  target: RemoteRepoTarget,
  input: { worktreePath: string; newBranch: string; baseBranch: string; signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<ExecResult> {
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    {
      type: 'gitWorktreeAdd',
      path: target.remotePath,
      worktreePath: input.worktreePath,
      newBranch: input.newBranch,
      baseBranch: input.baseBranch,
    },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}
```

- [ ] **Step 5: Add safe removal helper**

Add this export and helper group to `src/main/ssh/git.ts`:

```ts
export async function removeRemoteWorktree(
  target: RemoteRepoTarget,
  input: {
    branch: string
    worktreePath: string
    alsoDeleteBranch: boolean
    forceDeleteBranch?: boolean
    signal?: AbortSignal
    run?: RemoteGitRunner
  },
): Promise<ExecResult> {
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const listResult = await run({ type: 'gitWorktreeList', path: target.remotePath }, target, { signal: input.signal })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!listResult.ok) return remoteExecResult(listResult)

  const resolved = resolveRemoteRemovableWorktree(
    parseWorktrees(listResult.stdout),
    input.branch,
    input.worktreePath,
    target.remotePath,
  )
  if ('ok' in resolved) return resolved
  if (resolved.isLocked === true) return { ok: false, message: 'error.cannot-remove-locked-worktree' }

  const status = await run({ type: 'gitStatus', path: resolved.path }, target, { signal: input.signal })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!status.ok || parseStatus(status.stdout).length > 0) {
    return { ok: false, message: 'error.cannot-remove-dirty-worktree' }
  }

  const shouldForceDeleteBranch = input.forceDeleteBranch === true
  if (input.alsoDeleteBranch) {
    if (PROTECTED_BRANCHES.has(input.branch)) return { ok: false, message: 'error.cannot-delete-protected-branch' }
    const safelyDeletable =
      shouldForceDeleteBranch || (await isRemoteSafelyDeletableBranch(target, input.branch, { signal: input.signal, run }))
    if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
    if (!safelyDeletable) return { ok: false, message: 'error.cannot-remove-unpushed-worktree' }
  }

  const removeResult = await run(
    { type: 'gitWorktreeRemove', path: target.remotePath, worktreePath: resolved.path },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  if (!removeResult.ok) return remoteExecResult(removeResult)
  if (!input.alsoDeleteBranch) return remoteExecResult(removeResult)

  const deleteResult = await run(
    { type: 'gitBranchDelete', path: target.remotePath, branch: input.branch, force: shouldForceDeleteBranch },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(deleteResult)
}

function resolveRemoteRemovableWorktree(
  worktrees: WorktreeInfo[],
  branch: string,
  worktreePath: string,
  repoPath: string,
): WorktreeInfo | ExecResult {
  const target = worktrees.find((wt) => wt.path === worktreePath && wt.branch === branch)
  if (!target) return { ok: false, message: 'error.worktree-not-found-for-branch' }
  if (target.isPrimary || target.path === repoPath) return { ok: false, message: 'error.cannot-remove-main-worktree' }
  return target
}

async function isRemoteSafelyDeletableBranch(
  target: RemoteRepoTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<boolean> {
  const upstream = await options.run({ type: 'gitUpstream', path: target.remotePath, branch }, target, {
    signal: options.signal,
  })
  if (!upstream.ok || options.signal?.aborted) return false
  const ancestor = await options.run(
    { type: 'gitIsAncestor', path: target.remotePath, ancestor: branch, descendant: upstream.stdout.trim() },
    target,
    { signal: options.signal },
  )
  return ancestor.ok && !options.signal?.aborted
}
```

- [ ] **Step 6: Run service tests and verify green**

Run:

```sh
bun run test "src/main/ssh/git.test.ts"
```

Expected: PASS.

## Task 3: Remote RPC Contract And Main Handlers

**Files:**

- Modify: `src/shared/rpc.ts`
- Modify: `src/main/rpc.ts`
- Modify: `src/main/rpc.test.ts`

- [ ] **Step 1: Add failing RPC tests**

In `src/main/rpc.test.ts`, extend the remote procedure tests with:

```ts
test('exposes typed remote branch action procedures', async () => {
  await expect(invokeRpc('remote.checkout', { target: REMOTE_TARGET, branch: 'feature/x' })).resolves.toMatchObject({
    ok: true,
  })
  await expect(invokeRpc('remote.push', { target: REMOTE_TARGET, branch: 'feature/x' })).resolves.toMatchObject({
    ok: true,
  })
  await expect(
    invokeRpc('remote.createWorktree', {
      target: REMOTE_TARGET,
      worktreePath: '/srv/goblin-feature-x',
      newBranch: 'feature/x',
      baseBranch: 'main',
    }),
  ).resolves.toMatchObject({ ok: true })
})

test('rejects invalid remote worktree action inputs', async () => {
  await expect(
    invokeRpc('remote.removeWorktree', {
      target: REMOTE_TARGET,
      branch: 'feature/x',
      worktreePath: 'relative',
      alsoDeleteBranch: true,
    }),
  ).resolves.toMatchObject({ ok: false })
})
```

- [ ] **Step 2: Run RPC tests and verify red**

Run:

```sh
bun run test "src/main/rpc.test.ts"
```

Expected: FAIL because the procedures are not in `shared/rpc.ts` or `main/rpc.ts`.

- [ ] **Step 3: Extend `AppRpcHandlers.remote`**

In `src/shared/rpc.ts`, add these handler signatures:

```ts
    patch: (input: { target: RemoteRepoTarget; worktreePath: string }) => Promise<ExecResult>
    checkout: (input: { target: RemoteRepoTarget; branch: string; worktreePath?: string }) => Promise<ExecResult>
    pull: (input: { target: RemoteRepoTarget; branch: string; worktreePath?: string }) => Promise<ExecResult>
    push: (input: { target: RemoteRepoTarget; branch: string }) => Promise<ExecResult>
    createWorktree: (input: {
      target: RemoteRepoTarget
      worktreePath: string
      newBranch: string
      baseBranch: string
    }) => Promise<ExecResult>
    removeWorktree: (input: {
      target: RemoteRepoTarget
      branch: string
      worktreePath: string
      alsoDeleteBranch: boolean
      forceDeleteBranch?: boolean
    }) => Promise<ExecResult>
    deleteBranch: (input: { target: RemoteRepoTarget; branch: string; force?: boolean }) => Promise<ExecResult>
    openTerminal: (input: { target: RemoteRepoTarget; path: string }) => Promise<ExecResult>
    openEditor: (input: { target: RemoteRepoTarget; path: string }) => Promise<ExecResult>
    openGitHub: (input: { target: RemoteRepoTarget; branch?: string }) => Promise<ExecResult>
```

- [ ] **Step 4: Add valibot schemas and router procedures**

In `src/shared/rpc.ts`, add:

```ts
const RemoteAbsolutePath = v.pipe(
  v.string(),
  v.check((value) => value.startsWith('/') && !value.includes('\0'), 'Invalid remote path'),
)
const RemoteBranchInput = v.object({ target: RemoteTargetSchema, branch: v.string() })
```

Then add remote router entries:

```ts
      patch: p
        .input(v.object({ target: RemoteTargetSchema, worktreePath: RemoteAbsolutePath }))
        .mutation(({ input }) => handlers.remote.patch(input)),
      checkout: p
        .input(v.object({ target: RemoteTargetSchema, branch: v.string(), worktreePath: v.optional(RemoteAbsolutePath) }))
        .mutation(({ input }) => handlers.remote.checkout(input)),
      pull: p
        .input(v.object({ target: RemoteTargetSchema, branch: v.string(), worktreePath: v.optional(RemoteAbsolutePath) }))
        .mutation(({ input }) => handlers.remote.pull(input)),
      push: p.input(RemoteBranchInput).mutation(({ input }) => handlers.remote.push(input)),
      createWorktree: p
        .input(
          v.object({
            target: RemoteTargetSchema,
            worktreePath: RemoteAbsolutePath,
            newBranch: v.string(),
            baseBranch: v.string(),
          }),
        )
        .mutation(({ input }) => handlers.remote.createWorktree(input)),
      removeWorktree: p
        .input(
          v.object({
            target: RemoteTargetSchema,
            branch: v.string(),
            worktreePath: RemoteAbsolutePath,
            alsoDeleteBranch: v.boolean(),
            forceDeleteBranch: v.optional(v.boolean()),
          }),
        )
        .mutation(({ input }) => handlers.remote.removeWorktree(input)),
      deleteBranch: p
        .input(v.object({ target: RemoteTargetSchema, branch: v.string(), force: v.optional(v.boolean()) }))
        .mutation(({ input }) => handlers.remote.deleteBranch(input)),
      openTerminal: p
        .input(v.object({ target: RemoteTargetSchema, path: RemoteAbsolutePath }))
        .mutation(({ input }) => handlers.remote.openTerminal(input)),
      openEditor: p
        .input(v.object({ target: RemoteTargetSchema, path: RemoteAbsolutePath }))
        .mutation(({ input }) => handlers.remote.openEditor(input)),
      openGitHub: p
        .input(v.object({ target: RemoteTargetSchema, branch: v.optional(v.string()) }))
        .mutation(({ input }) => handlers.remote.openGitHub(input)),
```

- [ ] **Step 5: Wire main handlers**

In `src/main/rpc.ts`, import remote helpers:

```ts
import {
  checkoutRemoteBranch,
  createRemoteWorktree,
  getRemoteLog,
  getRemotePatch,
  getRemoteSnapshot,
  getRemoteStatus,
  pullRemoteBranch,
  pushRemoteBranch,
  removeRemoteWorktree,
} from '#/main/ssh/git.ts'
```

Add remote handlers using existing `normalizedRemoteTargetOrThrow` and `isValidBranch`:

```ts
      patch: async ({ target, worktreePath }) =>
        getRemotePatch(normalizedRemoteTargetOrThrow(target), worktreePath, { signal: currentRpcSignal() }),
      checkout: async ({ target, branch, worktreePath }) => {
        if (!isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        return checkoutRemoteBranch(normalizedRemoteTargetOrThrow(target), branch, worktreePath, {
          signal: currentRpcSignal(),
        })
      },
      pull: async ({ target, branch, worktreePath }) => {
        if (!isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        return pullRemoteBranch(normalizedRemoteTargetOrThrow(target), branch, worktreePath, {
          signal: currentRpcSignal(),
        })
      },
      push: async ({ target, branch }) => {
        if (!isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        return pushRemoteBranch(normalizedRemoteTargetOrThrow(target), branch, { signal: currentRpcSignal() })
      },
      createWorktree: async ({ target, worktreePath, newBranch, baseBranch }) => {
        if (!isValidBranch(newBranch) || !isValidBranch(baseBranch)) {
          return { ok: false, message: 'error.invalid-arguments' }
        }
        return createRemoteWorktree(normalizedRemoteTargetOrThrow(target), {
          worktreePath,
          newBranch,
          baseBranch,
          signal: currentRpcSignal(),
        })
      },
      removeWorktree: async ({ target, branch, worktreePath, alsoDeleteBranch, forceDeleteBranch }) => {
        if (!isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        return removeRemoteWorktree(normalizedRemoteTargetOrThrow(target), {
          branch,
          worktreePath,
          alsoDeleteBranch,
          forceDeleteBranch,
          signal: currentRpcSignal(),
        })
      },
```

Add `deleteBranch`, `openTerminal`, `openEditor`, and `openGitHub` signatures in the same handler block during this task. Task 4 wires `openTerminal` and `openEditor`; Task 9 wires `deleteBranch` and `openGitHub`.

- [ ] **Step 6: Run focused RPC tests**

Run:

```sh
bun run test "src/main/rpc.test.ts"
```

Expected: PASS for checkout/push/createWorktree/removeWorktree procedures. Task 4 adds and verifies app opener behavior; Task 9 adds and verifies delete branch and GitHub behavior.

## Task 4: External Terminal And Editor Remote Openers

**Files:**

- Modify: `src/main/system/terminals.ts`
- Modify: `src/main/system/ghostty.ts`
- Modify: `src/main/system/apple-terminal.ts`
- Modify: `src/main/system/editors.ts`
- Modify: `src/main/rpc.ts`
- Modify: `src/main/rpc.test.ts`

- [ ] **Step 1: Add failing RPC tests for app openers**

In `src/main/rpc.test.ts`, add:

```ts
test('opens remote editor and external terminal through typed remote RPC', async () => {
  await expect(
    invokeRpc('remote.openEditor', { target: REMOTE_TARGET, path: '/srv/goblin-feature-x' }),
  ).resolves.toMatchObject({ ok: true })
  await expect(
    invokeRpc('remote.openTerminal', { target: REMOTE_TARGET, path: '/srv/goblin-feature-x' }),
  ).resolves.toMatchObject({ ok: true })
})
```

- [ ] **Step 2: Extend terminal backend contract**

In `src/main/system/terminals.ts`, update `TerminalBackend`:

```ts
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

export interface TerminalBackend {
  isInstalled: () => boolean
  open: (path: string) => Promise<{ ok: boolean; message: string }>
  openRemote?: (target: RemoteRepoTarget, path: string) => Promise<{ ok: boolean; message: string }>
}
```

Add:

```ts
export function openRemoteInPreferredTerminal(
  target: RemoteRepoTarget,
  path: string,
  pref: TerminalPref,
): Promise<{ ok: boolean; message: string }> {
  const resolved = resolveTerminalApp(pref)
  if (!resolved) return Promise.resolve({ ok: false, message: 'error.terminal-not-installed' })
  const opener = backends[resolved].openRemote
  return opener ? opener(target, path) : Promise.resolve({ ok: false, message: 'error.remote-terminal-unavailable' })
}
```

- [ ] **Step 3: Implement remote terminal openers**

In `src/main/system/apple-terminal.ts`, add:

```ts
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { buildRemoteTerminalInvocation } from '#/main/ssh/commands.ts'

export async function openRemoteInAppleTerminal(
  target: RemoteRepoTarget,
  remotePath: string,
): Promise<{ ok: boolean; message: string }> {
  const invocation = buildRemoteTerminalInvocation(target, remotePath, { cols: 80, rows: 24 })
  const command = [invocation.command, ...invocation.args].map((part) => part.replace(/'/g, "'\\''")).join("' '")
  try {
    await execa('/usr/bin/osascript', ['-e', `tell application "Terminal" to do script '${command}'`], {
      timeout: OPEN_TIMEOUT_MS,
      forceKillAfterDelay: 500,
    })
    return { ok: true, message: remotePath }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
```

In `src/main/system/ghostty.ts`, add an opener that launches `ssh` directly:

```ts
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { buildRemoteTerminalInvocation } from '#/main/ssh/commands.ts'

export async function openRemoteInGhostty(
  target: RemoteRepoTarget,
  remotePath: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isGhosttyInstalled()) return { ok: false, message: 'error.ghostty-not-installed' }
  const invocation = buildRemoteTerminalInvocation(target, remotePath, { cols: 80, rows: 24 })
  try {
    const child = execa('open', ['-na', 'Ghostty.app', '--args', '-e', invocation.command, ...invocation.args], {
      detached: true,
      stdio: 'ignore',
      cleanup: false,
      timeout: OPEN_TIMEOUT_MS,
      forceKillAfterDelay: 500,
    })
    child.unref()
    await child
    return { ok: true, message: remotePath }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
```

Update `backends` in `src/main/system/terminals.ts`:

```ts
const backends: Record<ResolvedTerminalApp, TerminalBackend> = {
  ghostty: { isInstalled: isGhosttyInstalled, open: openInGhostty, openRemote: openRemoteInGhostty },
  terminal: { isInstalled: () => true, open: openInAppleTerminal, openRemote: openRemoteInAppleTerminal },
}
```

- [ ] **Step 4: Restore remote editor handler**

In `src/main/rpc.ts`, import:

```ts
import { getResolvedEditorApp, openInPreferredEditor, openRemoteInPreferredEditor } from '#/main/system/editors.ts'
import { getResolvedTerminalApp, openInPreferredTerminal, openRemoteInPreferredTerminal } from '#/main/system/terminals.ts'
```

Add remote handlers:

```ts
      openTerminal: async ({ target, path: remotePath }) =>
        openRemoteInPreferredTerminal(normalizedRemoteTargetOrThrow(target), remotePath, getTerminalApp()),
      openEditor: async ({ target, path: remotePath }) =>
        openRemoteInPreferredEditor(normalizedRemoteTargetOrThrow(target), remotePath, getEditorApp()) ?? {
          ok: false,
          message: 'error.remote-editor-unavailable',
        },
```

- [ ] **Step 5: Run app opener tests**

Run:

```sh
bun run test "src/main/rpc.test.ts" "src/main/system/editors.test.ts"
```

Expected: PASS.

## Task 5: Renderer Store Remote Branch Actions

**Files:**

- Modify: `src/renderer/stores/repos/branch-actions.test.ts`
- Modify: `src/renderer/stores/repos/branch-actions.ts`

- [ ] **Step 1: Add failing store routing tests**

In `src/renderer/stores/repos/branch-actions.test.ts`, replace the current remote unsupported tests with:

```ts
test('routes remote push through remote RPC and network resources', async () => {
  resetReposStore()
  const remote = emptyRepo(REMOTE_TARGET.id, REMOTE_TARGET.displayName, {
    kind: 'remote',
    remoteTarget: REMOTE_TARGET,
  })
  useReposStore.setState({ repos: { [REMOTE_TARGET.id]: remote }, order: [REMOTE_TARGET.id], activeId: REMOTE_TARGET.id, sessionReady: true })
  const calls: string[] = []
  installGoblinTestBridge({
    'remote.push': async ({ branch }: { branch: string }) => {
      calls.push(branch)
      return { ok: true, message: 'ok' }
    },
    'remote.snapshot': async () => ({ branches: [], current: '' }),
    'remote.status': async () => [],
  })

  const result = await useReposStore.getState().runBranchAction(REMOTE_TARGET.id, { kind: 'push', branch: 'feature/x' })

  expect(result).toEqual({ ok: true, message: 'ok' })
  expect(calls).toEqual(['feature/x'])
  expect(useReposStore.getState().repos[REMOTE_TARGET.id]?.resources.fetch.phase).toBe('idle')
})

test('routes remote remove worktree through remote RPC', async () => {
  resetReposStore()
  const remote = emptyRepo(REMOTE_TARGET.id, REMOTE_TARGET.displayName, {
    kind: 'remote',
    remoteTarget: REMOTE_TARGET,
  })
  useReposStore.setState({ repos: { [REMOTE_TARGET.id]: remote }, order: [REMOTE_TARGET.id], activeId: REMOTE_TARGET.id, sessionReady: true })
  const calls: string[] = []
  installGoblinTestBridge({
    'remote.removeWorktree': async ({ worktreePath }: { worktreePath: string }) => {
      calls.push(worktreePath)
      return { ok: true, message: 'ok' }
    },
    'remote.snapshot': async () => ({ branches: [], current: '' }),
    'remote.status': async () => [],
  })

  const result = await useReposStore.getState().runBranchAction(REMOTE_TARGET.id, {
    kind: 'removeWorktree',
    branch: 'feature/x',
    worktreePath: '/srv/goblin-feature-x',
    alsoDeleteBranch: true,
    forceDeleteBranch: false,
  })

  expect(result).toEqual({ ok: true, message: 'ok' })
  expect(calls).toEqual(['/srv/goblin-feature-x'])
})
```

- [ ] **Step 2: Run store tests and verify red**

Run:

```sh
bun run test "src/renderer/stores/repos/branch-actions.test.ts"
```

Expected: FAIL because `runBranchAction` currently rejects remote repos.

- [ ] **Step 3: Route remote RPCs in `runBranchActionRpc`**

In `src/renderer/stores/repos/branch-actions.ts`, replace the remote early return in `runBranchActionRpc` with:

```ts
  if (repo.kind === 'remote') {
    if (!repo.remoteTarget) return Promise.resolve({ ok: false, message: 'error.remote-unavailable' })
    switch (action.kind) {
      case 'checkout':
        return rpc.remote.checkout.mutate({ target: repo.remoteTarget, branch: action.branch }, { signal })
      case 'pull':
        return rpc.remote.pull.mutate(
          { target: repo.remoteTarget, branch: action.branch, worktreePath: action.worktreePath },
          { signal },
        )
      case 'push':
        return rpc.remote.push.mutate({ target: repo.remoteTarget, branch: action.branch }, { signal })
      case 'createWorktree':
        return rpc.remote.createWorktree.mutate(
          {
            target: repo.remoteTarget,
            worktreePath: action.worktreePath,
            newBranch: action.newBranch,
            baseBranch: action.baseBranch,
          },
          { signal },
        )
      case 'deleteBranch':
        return rpc.remote.deleteBranch.mutate(
          { target: repo.remoteTarget, branch: action.branch, force: action.force },
          { signal },
        )
      case 'removeWorktree':
        return rpc.remote.removeWorktree.mutate(
          {
            target: repo.remoteTarget,
            branch: action.branch,
            worktreePath: action.worktreePath,
            alsoDeleteBranch: action.alsoDeleteBranch,
            forceDeleteBranch: action.forceDeleteBranch,
          },
          { signal },
        )
    }
  }
```

- [ ] **Step 4: Allow remote branch actions through busy checks**

Change `canStartBranchAction` in `src/renderer/stores/repos/branch-actions.ts`:

```ts
function canStartBranchAction(repo: RepoState, _action: RepoBranchAction): boolean {
  return canStartRemoteFetch(repo)
}
```

Remove this early return from `runBranchAction`:

```ts
if (repoBefore.kind === 'remote') return { ok: false, message: 'error.remote-unavailable' }
```

- [ ] **Step 5: Run store tests and verify green**

Run:

```sh
bun run test "src/renderer/stores/repos/branch-actions.test.ts"
```

Expected: PASS.

## Task 6: Remote UI Action Capabilities

**Files:**

- Modify: `src/renderer/hooks/branch-action-state.test.ts`
- Modify: `src/renderer/hooks/branch-action-state.ts`
- Modify: `src/renderer/hooks/useBranchActionItems.test.tsx`
- Modify: `src/renderer/hooks/useBranchActions.tsx`
- Modify: `src/renderer/hooks/useBranchActionItems.ts`

- [ ] **Step 1: Add failing capability tests**

In `src/renderer/hooks/branch-action-state.test.ts`, assert remote branches with worktrees have actions:

```ts
test('remote branches with worktrees expose branch actions', () => {
  const remote = remoteRepo()
  expect(branchActionsAvailable(remote, createBranch('feature/x', { worktreePath: '/srv/goblin-feature-x' }))).toBe(true)
})
```

In `src/renderer/hooks/useBranchActionItems.test.tsx`, add:

```ts
test('shows remote worktree branch actions', () => {
  const ids = visibleIds(remoteRepo(), createBranch('feature/x', {
    tracking: 'origin/feature/x',
    worktreePath: '/srv/goblin-feature-x',
  }))
  expect(ids).toEqual(expect.arrayContaining(['copyPatch', 'pull', 'push', 'terminal', 'editor', 'github', 'removeWorktree']))
  expect(ids).not.toContain('deleteBranch')
})

test('shows remote plain branch actions', () => {
  const ids = visibleIds(remoteRepo(), createBranch('feature/plain'))
  expect(ids).toEqual(expect.arrayContaining(['checkout', 'push', 'github', 'deleteBranch']))
  expect(ids).not.toContain('terminal')
  expect(ids).not.toContain('removeWorktree')
})
```

- [ ] **Step 2: Run hook tests and verify red**

Run:

```sh
bun run test "src/renderer/hooks/branch-action-state.test.ts" "src/renderer/hooks/useBranchActionItems.test.tsx"
```

Expected: FAIL because remote actions are currently hidden.

- [ ] **Step 3: Make action availability remote-aware**

In `src/renderer/hooks/branch-action-state.ts`, change:

```ts
export function repoBranchActionsAvailable(repo: RepoState): boolean {
  return repo.kind !== 'remote' || !!repo.remoteTarget
}
```

Keep `branchActionsAvailable` branch-scoped:

```ts
export function branchActionsAvailable(repo: RepoState, branch: BranchInfo | null | undefined): boolean {
  if (!branch || !repoBranchActionsAvailable(repo)) return false
  return true
}
```

- [ ] **Step 4: Route remote UI-only actions**

In `src/renderer/hooks/useBranchActions.tsx`, update `copyPatch`, `openTerminal`, `openEditor`, and `openGitHub`:

```ts
  function copyPatch() {
    if (!branch.worktreePath) return
    const worktreePath = branch.worktreePath
    return runUiAction('copyPatch', async () => {
      const result =
        repo.kind === 'remote'
          ? repo.remoteTarget
            ? await rpc.remote.patch.mutate({ target: repo.remoteTarget, worktreePath })
            : { ok: false, message: 'error.remote-unavailable' }
          : await rpc.repo.patch.mutate({ cwd: repo.id, worktreePath })
      if (!result.ok) return { ok: false, message: result.message }
      if (!result.message) return { ok: false, message: 'status.copy-patch-empty' }
      await navigator.clipboard.writeText(result.message)
      return { ok: true, message: 'status.copy-patch-ok' }
    })
  }

  function openTerminal() {
    if (!branch.worktreePath) return
    const worktreePath = branch.worktreePath
    return runUiAction('terminal', () =>
      repo.kind === 'remote'
        ? repo.remoteTarget
          ? rpc.remote.openTerminal.mutate({ target: repo.remoteTarget, path: worktreePath })
          : Promise.resolve({ ok: false, message: 'error.remote-unavailable' })
        : rpc.repo.openTerminal.mutate({ path: worktreePath }),
    )
  }

  function openEditor() {
    if (!branch.worktreePath) return
    const worktreePath = branch.worktreePath
    return runUiAction('editor', () =>
      repo.kind === 'remote'
        ? repo.remoteTarget
          ? rpc.remote.openEditor.mutate({ target: repo.remoteTarget, path: worktreePath })
          : Promise.resolve({ ok: false, message: 'error.remote-unavailable' })
        : rpc.repo.openEditor.mutate({ path: worktreePath }),
    )
  }

  function openGitHub() {
    return runUiAction('github', () =>
      repo.kind === 'remote'
        ? repo.remoteTarget
          ? rpc.remote.openGitHub.mutate({ target: repo.remoteTarget, branch: branch.name })
          : Promise.resolve({ ok: false, message: 'error.remote-unavailable' })
        : rpc.repo.openGitHub.mutate({ cwd: repo.id, branch: branch.name }),
    )
  }
```

- [ ] **Step 5: Update capability booleans**

In the returned `capabilities` object in `useBranchActions.tsx`, use:

```ts
      canCheckout: !isCurrent && !checkedOutInAnotherWorktree,
      canRemoveWorktree: checkedOutInAnotherWorktree && !branch.worktreeIsPrimary,
      isRegularBranch: !isCurrent && !branch.worktreePath && !isProtected,
      canCopyPatch: !!branch.worktreePath && (changedStatus?.entries.length ?? 0) > 0,
      canPull: !!branch.tracking,
      canPush: true,
      canOpenTerminal: !!branch.worktreePath,
      canOpenEditor: !!branch.worktreePath,
      canOpenGitHub: true,
```

- [ ] **Step 6: Run hook tests and verify green**

Run:

```sh
bun run test "src/renderer/hooks/branch-action-state.test.ts" "src/renderer/hooks/useBranchActionItems.test.tsx"
```

Expected: PASS.

## Task 7: Embedded Remote Terminal Tab

**Files:**

- Modify: `src/renderer/components/branch-detail/BranchDetailToolbar.tsx`
- Modify: `src/renderer/components/branch-detail/BranchDetailContent.tsx`
- Modify: `src/renderer/stores/repos/selection.ts`
- Modify: `src/renderer/hooks/useKeyboard.ts`
- Modify: related tests beside these files

- [ ] **Step 1: Add failing UI tests for remote Terminal tab**

In `src/renderer/components/branch-detail/BranchDetailContent.ui.test.tsx`, assert remote terminal content is rendered for a remote branch with a worktree:

```ts
test('renders embedded terminal tab for remote worktree branches', () => {
  const repo = remoteRepo()
  repo.ui.detailTab = 'terminal'
  repo.data.branches = [createBranch('feature/x', { worktreePath: '/srv/goblin-feature-x' })]
  repo.ui.selectedBranch = 'feature/x'

  render(<BranchDetailContent repo={repo} detail={selectedBranchDetail(repo)} detailId="detail" contentId="content" layout="left-right" />)

  expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'detail-terminal-panel')
})
```

- [ ] **Step 2: Run terminal UI tests and verify red**

Run:

```sh
bun run test "src/renderer/components/branch-detail/BranchDetailContent.ui.test.tsx" "src/renderer/stores/repos/selection.test.ts"
```

Expected: FAIL because remote terminal tab is filtered out.

- [ ] **Step 3: Use terminal capability instead of local-only worktree checks**

In `BranchDetailToolbar.tsx`, set:

```ts
  const canOpenTerminal = !!detail.branch?.worktreePath
  const terminalWorktreePath = canOpenTerminal ? detail.branch?.worktreePath : null
  const terminalScope = terminalWorktreePath
    ? repo.kind === 'remote' && repo.remoteTarget
      ? { kind: 'remote' as const, repoId: repo.id, worktreePath: terminalWorktreePath }
      : { kind: 'local' as const, repoRoot: repo.id, worktreePath: terminalWorktreePath }
    : null
```

In `BranchDetailContent.tsx`, set:

```ts
  const canOpenTerminal = !!branch?.worktreePath
```

And update `BranchTerminalTab`:

```ts
  if (!branch.worktreePath) return null
  const base =
    repo.kind === 'remote'
      ? repo.remoteTarget
        ? {
            kind: 'remote' as const,
            repoId: repo.id,
            target: repo.remoteTarget,
            branch: branch.name,
            worktreePath: branch.worktreePath,
          }
        : null
      : { kind: 'local' as const, repoRoot: repo.id, branch: branch.name, worktreePath: branch.worktreePath }
  if (!base) return null
```

- [ ] **Step 4: Update selection and keyboard terminal capability**

In `src/renderer/stores/repos/selection.ts`, change `branchCanOpenTerminal` to:

```ts
function branchCanOpenTerminal(repo: RepoState, branchName: string | null): boolean {
  return !!branchName && repo.data.branches.some((branch) => branch.name === branchName && !!branch.worktreePath)
}
```

In `src/renderer/hooks/useKeyboard.ts`, replace local-only terminal visibility checks with:

```ts
!!selected?.worktreePath
```

- [ ] **Step 5: Run terminal UI tests and verify green**

Run:

```sh
bun run test "src/renderer/components/branch-detail/BranchDetailContent.ui.test.tsx" "src/renderer/stores/repos/selection.test.ts"
```

Expected: PASS.

## Task 8: Repo Toolbar Remote Worktree Creation

**Files:**

- Modify: `src/renderer/components/repo-toolbar/RepoToolbarActions.tsx`
- Modify: `src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx`

- [ ] **Step 1: Add failing toolbar test**

In `RepoToolbarActions.test.tsx`, assert remote repos show create worktree:

```ts
test('remote toolbar shows create worktree and read refresh actions', () => {
  const repo = remoteRepo()
  const { container } = render(<RepoToolbarActions repo={repo} />)

  expect(container.textContent).toContain('action.create-worktree')
  expect(container.textContent).toContain('action.refresh-remote')
})
```

- [ ] **Step 2: Run toolbar test and verify red**

Run:

```sh
bun run test "src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx"
```

Expected: FAIL because remote toolbar currently hides create worktree.

- [ ] **Step 3: Keep remote refresh and include create worktree**

In `RepoToolbarActions.tsx`, keep the remote refresh/diagnostics buttons and add the same create worktree button used for local repos:

```tsx
        <Tip label={createTip}>
          <span className="inline-flex">
            <Button
              variant="ghost"
              onClick={() => {
                if (!branchActionBusy) setCreateOpen(true)
              }}
              disabled={branchActionBusy}
              aria-label={createTip}
            >
              <FolderPlus />
              {t('action.create-worktree')}
            </Button>
          </span>
        </Tip>
        <CreateWorktreeDialog
          open={createOpen}
          repo={repo}
          onClose={() => setCreateOpen(false)}
          onCreate={(request) =>
            void runBranchAction(repo.id, {
              kind: 'createWorktree',
              worktreePath: request.worktreePath,
              newBranch: request.newBranch,
              baseBranch: request.baseBranch,
            })
          }
        />
```

- [ ] **Step 4: Run toolbar test and verify green**

Run:

```sh
bun run test "src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx"
```

Expected: PASS.

## Task 9: Remote GitHub And Branch Delete Completion

**Files:**

- Modify: `src/main/ssh/git.ts`
- Modify: `src/main/rpc.ts`
- Modify: `src/main/rpc.test.ts`

- [ ] **Step 1: Add failing tests for GitHub and delete branch**

In `src/main/ssh/git.test.ts`, add:

```ts
test('builds a remote GitHub pull request URL from origin', async () => {
  const { getRemoteGitHubUrl } = await import('#/main/ssh/git.ts')
  const run = vi.fn(async () => ({ ok: true, stderr: '', stdout: 'git@github.com:nano-props/goblin.git' }))

  await expect(getRemoteGitHubUrl(TARGET, 'feature/x', { run })).resolves.toBe(
    'https://github.com/nano-props/goblin/pull/new/feature/x',
  )
})

test('rejects deleting a protected remote branch', async () => {
  const { deleteRemoteBranch } = await import('#/main/ssh/git.ts')
  const run = vi.fn(async () => ({ ok: true, stderr: '', stdout: '' }))

  await expect(deleteRemoteBranch(TARGET, { branch: 'main', force: false, run })).resolves.toEqual({
    ok: false,
    message: 'error.cannot-delete-protected-branch',
  })
})
```

- [ ] **Step 2: Add remote URL helper and delete helper**

In `src/main/ssh/git.ts`, add:

```ts
function remoteUrlToHttps(url: string): string | null {
  const sshUrl = url.match(/^ssh:\/\/(?:[^@]+@)?([^:/]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/)
  if (sshUrl) return `https://${sshUrl[1]}/${sshUrl[2]}`
  const httpsUrl = url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/)
  if (httpsUrl) return `https://${httpsUrl[1]}/${httpsUrl[2]}`
  const scpUrl = url.match(/^(?:[^@]+@)?([^:/\s]+):([^/].*?)(?:\.git)?\/?$/)
  if (scpUrl) return `https://${scpUrl[1]}/${scpUrl[2]}`
  return null
}

export async function getRemoteGitHubUrl(
  target: RemoteRepoTarget,
  branch?: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<string | null> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitRemoteGetUrl', path: target.remotePath }, target, { signal: options.signal })
  if (!result.ok) return null
  const repoUrl = remoteUrlToHttps(result.stdout.trim())
  if (!repoUrl) return null
  if (!branch) return repoUrl
  const encoded = branch.split('/').map(encodeURIComponent).join('/')
  return `${repoUrl}/pull/new/${encoded}`
}
```

Add `deleteRemoteBranch` following the safety rules:

```ts
export async function deleteRemoteBranch(
  target: RemoteRepoTarget,
  input: { branch: string; force?: boolean; signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<ExecResult> {
  if (PROTECTED_BRANCHES.has(input.branch)) return { ok: false, message: 'error.cannot-delete-protected-branch' }
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const snapshot = await getRemoteSnapshot(target, { signal: input.signal, run })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (snapshot?.current === input.branch) return { ok: false, message: 'error.cannot-delete-current-branch' }
  if (snapshot?.branches.some((branch) => branch.name === input.branch && branch.worktreePath)) {
    return { ok: false, message: 'error.cannot-delete-checked-out-branch' }
  }
  const shouldForce = input.force === true
  const safelyDeletable = shouldForce || (await isRemoteSafelyDeletableBranch(target, input.branch, { signal: input.signal, run }))
  if (!safelyDeletable) return { ok: false, message: 'error.branch-not-fully-merged' }
  const result = await run(
    { type: 'gitBranchDelete', path: target.remotePath, branch: input.branch, force: shouldForce },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}
```

- [ ] **Step 3: Wire RPC handlers**

In `src/main/rpc.ts`, add:

```ts
      deleteBranch: async ({ target, branch, force }) => {
        if (!isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        return deleteRemoteBranch(normalizedRemoteTargetOrThrow(target), { branch, force, signal: currentRpcSignal() })
      },
      openGitHub: async ({ target, branch }) => {
        if (!isValidOptionalBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        const url = await getRemoteGitHubUrl(normalizedRemoteTargetOrThrow(target), branch, {
          signal: currentRpcSignal(),
        })
        if (!url) return { ok: false, message: 'error.open-github-no-origin' }
        if (!(await openHttpsExternal(url))) return { ok: false, message: 'error.invalid-url' }
        return { ok: true, message: url }
      },
```

- [ ] **Step 4: Run tests**

Run:

```sh
bun run test "src/main/ssh/git.test.ts" "src/main/rpc.test.ts"
```

Expected: PASS.

## Task 10: I18n And GSD Planning Boundary

**Files:**

- Modify: `src/main/i18n/en.ts`
- Modify: `src/main/i18n/zh.ts`
- Modify: `src/main/i18n/ja.ts`
- Modify: `src/main/i18n/ko.ts`
- Modify: `.planning/phases/02-remote-git-read-model/02-CONTEXT.md`
- Modify: `.planning/phases/02-remote-git-read-model/02-03-PLAN.md`
- Modify: `.planning/ROADMAP.md`

- [ ] **Step 1: Add missing error copy**

If these keys are absent, add them to each locale file:

```ts
'error.remote-terminal-unavailable': 'Remote terminal is unavailable for the selected terminal app',
'error.remote-editor-unavailable': 'Remote editor opening is unavailable for the selected editor',
```

Use localized Chinese in `zh.ts`:

```ts
'error.remote-terminal-unavailable': '所选终端应用不支持打开远端终端',
'error.remote-editor-unavailable': '所选编辑器不支持打开远端路径',
```

- [ ] **Step 2: Update Phase 2 context boundary**

In `.planning/phases/02-remote-git-read-model/02-CONTEXT.md`, replace the paragraph that says remote write operations and remote terminal sessions are not part of Phase 2 with:

```md
This follow-up expands the selected-branch action surface for remote repositories. Remote read resources remain Phase 2's foundation, but checkout, pull, push, worktree creation/removal, branch deletion, copy patch, editor opening, GitHub/PR opening, external terminal opening, and embedded Terminal tab support are now accepted scope when implemented through typed RPC, guarded SSH command primitives, and existing branch action resource semantics.
```

- [ ] **Step 3: Update Phase 2 UI plan success criteria**

In `.planning/phases/02-remote-git-read-model/02-03-PLAN.md`, replace acceptance criteria that say remote branch action menus do not render with:

```md
- Remote branch rows and detail toolbar render supported actions according to branch capability.
- Remote actions use typed `remote.*` RPC procedures and never local `repo.*` filesystem procedures.
- Remote Finder remains hidden because remote paths are not local paths.
- Remote destructive actions preserve local safety guards and confirmation behavior.
```

- [ ] **Step 4: Run typecheck for i18n key consistency**

Run:

```sh
bun run typecheck
```

Expected: PASS.

## Task 11: Full Verification

**Files:**

- No file edits.

- [ ] **Step 1: Run focused main tests**

Run:

```sh
bun run test "src/main/ssh/commands.test.ts" "src/main/ssh/git.test.ts" "src/main/rpc.test.ts"
```

Expected: PASS.

- [ ] **Step 2: Run focused renderer tests**

Run:

```sh
bun run test "src/renderer/stores/repos/branch-actions.test.ts" "src/renderer/hooks/branch-action-state.test.ts" "src/renderer/hooks/useBranchActionItems.test.tsx" "src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx" "src/renderer/components/branch-detail/BranchDetailContent.ui.test.tsx"
```

Expected: PASS.

- [ ] **Step 3: Run full project gates**

Run:

```sh
bun run test
bun run typecheck
```

Expected: both PASS.

- [ ] **Step 4: Manual verification checklist**

Use a configured SSH remote repo and verify:

- A remote worktree branch shows `Copy patch`, `Pull`, `Push`, `Open in terminal`, `Open in editor`, `GitHub/PR`, `Remove worktree`, and embedded `Terminal` tab.
- A remote plain branch shows `Checkout`, `Push`, `GitHub/PR`, and `Delete branch`.
- Finder/open-local-file actions are absent for remote branches.
- Protected branches do not show delete branch.
- Dirty remote worktree removal is rejected.
- External terminal opens a local terminal window that SSHes into the remote worktree.
- Embedded terminal opens inside the right-side Terminal tab.
- Local repository branch actions still behave as before.
