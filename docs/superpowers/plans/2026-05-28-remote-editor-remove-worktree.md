# Remote Editor And Worktree Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add remote editor opening and safe remote worktree removal for SSH remote repositories while reusing the local branch action UI.

**Architecture:** Keep `RepoState.kind === 'remote'` as the boundary. Renderer branch actions stay shared, but capabilities route local and remote actions differently. Main owns Remote SSH editor invocation, remote git command construction, validation, deletion safeguards, and cancellation through existing RPC request signals.

**Tech Stack:** TypeScript, React, Zustand, tRPC/valibot, Electron IPC, OpenSSH via `execa`, Vitest.

---

Project instruction override: `AGENTS.md` says not to plan or execute git commits unless the user explicitly asks. This plan intentionally omits commit steps even though the generic writing-plans skill recommends frequent commits.

## Scope Check

The feature touches three connected boundaries: remote git writes, remote editor opening, and branch action UI exposure. They are not independently shippable because the UI actions need the RPC/backend behavior to be safe, and the backend behavior needs renderer routing to be reachable. This plan keeps them as one vertical slice.

## File Structure

- Modify `src/main/ssh/commands.ts`: add structured remote git commands for worktree removal, branch deletion, upstream resolution, and ancestor checks.
- Modify `src/main/ssh/commands.test.ts`: verify shell quoting and command shapes for the new remote git commands.
- Modify `src/main/ssh/git.ts`: implement safe remote worktree removal and branch deletion checks.
- Modify `src/main/ssh/git.test.ts`: test remote removal happy paths and safety rejections using a fake remote runner.
- Modify `src/main/system/open-app.ts`: add Remote SSH editor CLI argument helpers and remote CLI invocation.
- Modify `src/main/system/vscode.ts`, `src/main/system/cursor.ts`, `src/main/system/windsurf.ts`: expose `openRemote*` functions using the shared CLI helper.
- Modify `src/main/system/editors.ts`: add optional remote opener support and `openRemoteInPreferredEditor`.
- Create `src/main/system/editors.test.ts`: verify remote editor authority, CLI args, missing backend behavior, and selected editor routing.
- Modify `src/shared/rpc.ts`: add `remote.openEditor` and `remote.removeWorktree` handler types and router schemas.
- Modify `src/main/rpc.ts`: wire remote RPC handlers to editor and remote git services.
- Modify `src/main/rpc.test.ts`: cover router acceptance/rejection for new remote procedures.
- Modify `src/renderer/stores/repos/branch-actions.ts`: route remote `removeWorktree` to `rpc.remote.removeWorktree` and keep other remote writes blocked.
- Modify `src/renderer/stores/repos/branch-actions.test.ts`: verify remote removal routing and blocked unsupported actions.
- Modify `src/renderer/hooks/branch-action-state.ts`: introduce branch-level action availability for local/remote rows and detail toolbar.
- Modify `src/renderer/hooks/branch-action-state.test.ts`: update remote availability expectations.
- Modify `src/renderer/hooks/useBranchActions.tsx`: make editor and remove-worktree actions remote-aware.
- Modify `src/renderer/hooks/useBranchActionItems.ts`: hide checkout/push/GitHub for remote by capability instead of unconditional visibility.
- Create `src/renderer/hooks/useBranchActionItems.test.tsx`: test remote action item visibility.
- Modify `src/renderer/components/BranchList.tsx`: use branch-level availability so remote rows without worktrees do not show an empty action menu.
- Modify `src/renderer/components/branch-detail/BranchDetailToolbar.tsx`: use branch-level availability for the detail action bar.
- Create `src/renderer/components/branch-list/BranchRow.test.tsx`: verify the row respects the `showActions` gate used by `BranchList`.
- Modify `src/main/i18n/en.ts`, `src/main/i18n/zh.ts`, `src/main/i18n/ja.ts`, `src/main/i18n/ko.ts`: add `error.remote-editor-unavailable`.

## Task 1: Remote SSH Git Command Primitives

**Files:**

- Modify: `src/main/ssh/commands.test.ts`
- Modify: `src/main/ssh/commands.ts`

- [ ] **Step 1: Add failing command builder tests**

Append these tests inside the existing `describe('remote ssh command runner', () => { ... })` block in `src/main/ssh/commands.test.ts`:

```ts
  test('builds remote worktree remove and branch delete commands with quoted args', async () => {
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
    const forceDelete = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitBranchDelete',
      path: '/srv/goblin',
      branch: 'feature/delete',
      force: true,
    })

    expect(remove.script).toBe("git -C '/srv/goblin' worktree remove -- '/srv/goblin-feature'\\''s'")
    expect(safeDelete.script).toBe("git -C '/srv/goblin' branch -d -- 'feature/delete'")
    expect(forceDelete.script).toBe("git -C '/srv/goblin' branch -D -- 'feature/delete'")
  })

  test('builds remote upstream and ancestor checks with quoted refs', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

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

    expect(upstream.script).toBe("git -C '/srv/goblin' rev-parse --abbrev-ref 'feature/quote'\\''s@{u}'")
    expect(ancestor.script).toBe(
      "git -C '/srv/goblin' merge-base --is-ancestor -- 'feature/quote'\\''s' 'origin/main'",
    )
  })
```

- [ ] **Step 2: Run the command test and verify red**

Run:

```sh
bun run test "src/main/ssh/commands.test.ts"
```

Expected: FAIL with TypeScript errors or assertion failures because `gitWorktreeRemove`, `gitBranchDelete`, `gitUpstream`, and `gitIsAncestor` are not implemented.

- [ ] **Step 3: Extend the remote command union**

In `src/main/ssh/commands.ts`, extend `RemoteCommandKind` with these variants:

```ts
  | { type: 'gitWorktreeRemove'; path: string; worktreePath: string }
  | { type: 'gitBranchDelete'; path: string; branch: string; force?: boolean }
  | { type: 'gitUpstream'; path: string; branch: string }
  | { type: 'gitIsAncestor'; path: string; ancestor: string; descendant: string }
```

- [ ] **Step 4: Add fixed script builders**

In `scriptForCommand` in `src/main/ssh/commands.ts`, add these cases before the exhaustive check:

```ts
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
```

- [ ] **Step 5: Run the command test and verify green**

Run:

```sh
bun run test "src/main/ssh/commands.test.ts"
```

Expected: PASS.

## Task 2: Remote Worktree Removal Backend

**Files:**

- Modify: `src/main/ssh/git.test.ts`
- Modify: `src/main/ssh/git.ts`

- [ ] **Step 1: Add failing removal tests**

Append this `describe` block to `src/main/ssh/git.test.ts`:

```ts
describe('remote git worktree removal', () => {
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
    expect(run).toHaveBeenCalledWith(
      { type: 'gitWorktreeRemove', path: '/srv/goblin', worktreePath: '/srv/goblin-feature-x' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('removes a clean remote worktree and deletes the branch after safe ancestor check', async () => {
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
      if (command.type === 'gitUpstream') return { ok: true, stderr: '', stdout: 'origin/feature/x' }
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
    ).resolves.toEqual({ ok: true, message: 'ok' })

    expect(calls).toEqual(['gitWorktreeList', 'gitStatus', 'gitUpstream', 'gitIsAncestor', 'gitWorktreeRemove', 'gitBranchDelete'])
    expect(run).toHaveBeenCalledWith(
      { type: 'gitBranchDelete', path: '/srv/goblin', branch: 'feature/x', force: false },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('rejects unsafe remote worktree removal before running destructive commands', async () => {
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
        alsoDeleteBranch: false,
        forceDeleteBranch: false,
        run,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.cannot-remove-dirty-worktree' })

    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitWorktreeRemove' }), TARGET, expect.anything())
  })

  test.each([
    {
      name: 'primary worktree',
      list: ['worktree /srv/goblin', 'HEAD abc1234', 'branch refs/heads/main'].join('\n'),
      branch: 'main',
      worktreePath: '/srv/goblin',
      status: { ok: true, stderr: '', stdout: '' },
      message: 'error.cannot-remove-main-worktree',
    },
    {
      name: 'locked worktree',
      list: [
        'worktree /srv/goblin',
        'HEAD abc1234',
        'branch refs/heads/main',
        '',
        'worktree /srv/goblin-feature-x',
        'HEAD def5678',
        'branch refs/heads/feature/x',
        'locked',
      ].join('\n'),
      branch: 'feature/x',
      worktreePath: '/srv/goblin-feature-x',
      status: { ok: true, stderr: '', stdout: '' },
      message: 'error.cannot-remove-locked-worktree',
    },
    {
      name: 'missing worktree',
      list: ['worktree /srv/goblin', 'HEAD abc1234', 'branch refs/heads/main'].join('\n'),
      branch: 'feature/x',
      worktreePath: '/srv/goblin-feature-x',
      status: { ok: true, stderr: '', stdout: '' },
      message: 'error.worktree-not-found-for-branch',
    },
    {
      name: 'unknown dirty status',
      list: [
        'worktree /srv/goblin',
        'HEAD abc1234',
        'branch refs/heads/main',
        '',
        'worktree /srv/goblin-feature-x',
        'HEAD def5678',
        'branch refs/heads/feature/x',
      ].join('\n'),
      branch: 'feature/x',
      worktreePath: '/srv/goblin-feature-x',
      status: { ok: false, stderr: 'permission denied', stdout: '', message: 'permission denied' },
      message: 'error.cannot-remove-dirty-worktree',
    },
  ])('rejects $name before removal', async ({ list, branch, worktreePath, status, message }) => {
    const { removeRemoteWorktree } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async (command) => {
      if (command.type === 'gitWorktreeList') return { ok: true, stderr: '', stdout: list }
      if (command.type === 'gitStatus') return status
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(
      removeRemoteWorktree(TARGET, {
        branch,
        worktreePath,
        alsoDeleteBranch: false,
        forceDeleteBranch: false,
        run,
      }),
    ).resolves.toEqual({ ok: false, message })

    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitWorktreeRemove' }), TARGET, expect.anything())
  })

  test('returns force confirmation error when branch deletion is not safely allowed', async () => {
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
      if (command.type === 'gitUpstream') return { ok: true, stderr: '', stdout: '' }
      if (command.type === 'gitIsAncestor') return { ok: false, stderr: '', stdout: '', message: 'not ancestor' }
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
    ).resolves.toEqual({ ok: false, message: 'error.cannot-remove-unpushed-worktree' })

    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitWorktreeRemove' }), TARGET, expect.anything())
  })
})
```

- [ ] **Step 2: Run the remote git test and verify red**

Run:

```sh
bun run test "src/main/ssh/git.test.ts"
```

Expected: FAIL because `removeRemoteWorktree` is not exported and command kinds are missing until Task 1 is complete.

- [ ] **Step 3: Import protected branches and add input types**

In `src/main/ssh/git.ts`, update imports:

```ts
import { PROTECTED_BRANCHES, type BranchInfo, type ExecResult, type LogEntry, type WorktreeInfo, type WorktreeStatus } from '#/shared/git-types.ts'
```

Add this interface near the existing remote git interfaces:

```ts
interface RemoveRemoteWorktreeInput {
  branch: string
  worktreePath: string
  alsoDeleteBranch: boolean
  forceDeleteBranch?: boolean
  signal?: AbortSignal
  run?: RemoteGitRunner
}
```

- [ ] **Step 4: Add remote removal helper functions**

Add these helpers above `remoteExecResult` in `src/main/ssh/git.ts`:

```ts
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

async function getRemoteUpstream(
  target: RemoteRepoTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<string | null> {
  const result = await options.run({ type: 'gitUpstream', path: target.remotePath, branch }, target, {
    signal: options.signal,
  })
  if (!result.ok || options.signal?.aborted) return null
  return result.stdout.trim() || null
}

async function isRemoteAncestor(
  target: RemoteRepoTarget,
  ancestor: string,
  descendant: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<boolean> {
  const result = await options.run(
    { type: 'gitIsAncestor', path: target.remotePath, ancestor, descendant },
    target,
    { signal: options.signal },
  )
  return result.ok && !options.signal?.aborted
}

async function isRemoteSafelyDeletableBranch(
  target: RemoteRepoTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<boolean> {
  const upstream = await getRemoteUpstream(target, branch, options)
  if (options.signal?.aborted) return false
  return isRemoteAncestor(target, branch, upstream ?? 'HEAD', options)
}
```

- [ ] **Step 5: Implement `removeRemoteWorktree`**

Add this exported function after `createRemoteWorktree` in `src/main/ssh/git.ts`:

```ts
export async function removeRemoteWorktree(
  target: RemoteRepoTarget,
  input: RemoveRemoteWorktreeInput,
): Promise<ExecResult> {
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }

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
  if (!status.ok) return { ok: false, message: 'error.cannot-remove-dirty-worktree' }
  if (parseStatus(status.stdout).length > 0) return { ok: false, message: 'error.cannot-remove-dirty-worktree' }

  const shouldForceDeleteBranch = input.forceDeleteBranch === true
  if (input.alsoDeleteBranch) {
    if (PROTECTED_BRANCHES.has(input.branch)) return { ok: false, message: 'error.cannot-delete-protected-branch' }
    const safelyDeletable =
      shouldForceDeleteBranch ||
      (await isRemoteSafelyDeletableBranch(target, input.branch, { signal: input.signal, run }))
    if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
    if (!safelyDeletable) return { ok: false, message: 'error.cannot-remove-unpushed-worktree' }
  }

  const removeResult = await run(
    { type: 'gitWorktreeRemove', path: target.remotePath, worktreePath: resolved.path },
    target,
    { signal: input.signal, timeoutMs: REMOTE_WORKTREE_OP_TIMEOUT_MS },
  )
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!removeResult.ok) return remoteExecResult(removeResult)

  if (!input.alsoDeleteBranch) return remoteExecResult(removeResult)

  const deleteResult = await run(
    { type: 'gitBranchDelete', path: target.remotePath, branch: input.branch, force: shouldForceDeleteBranch },
    target,
    { signal: input.signal, timeoutMs: REMOTE_WORKTREE_OP_TIMEOUT_MS },
  )
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  return remoteExecResult(deleteResult)
}
```

- [ ] **Step 6: Run the remote git test and verify green**

Run:

```sh
bun run test "src/main/ssh/git.test.ts"
```

Expected: PASS.

## Task 3: Remote Editor Backend

**Files:**

- Create: `src/main/system/editors.test.ts`
- Modify: `src/main/system/open-app.ts`
- Modify: `src/main/system/vscode.ts`
- Modify: `src/main/system/cursor.ts`
- Modify: `src/main/system/windsurf.ts`
- Modify: `src/main/system/editors.ts`

- [ ] **Step 1: Create failing remote editor tests**

Create `src/main/system/editors.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const execaMock = vi.hoisted(() => vi.fn())
const existsSyncMock = vi.hoisted(() => vi.fn(() => true))
const statSyncMock = vi.hoisted(() => vi.fn(() => ({ isDirectory: () => true })))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/Users/test'),
  },
}))

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  statSync: statSyncMock,
}))

vi.mock('execa', () => ({
  execa: execaMock,
}))

const TARGET: RemoteRepoTarget = {
  id: 'ssh://deploy@prod.example.com:22/srv/goblin',
  alias: 'prod',
  host: 'prod.example.com',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

afterEach(() => {
  execaMock.mockReset()
  existsSyncMock.mockReset()
  existsSyncMock.mockReturnValue(true)
  statSyncMock.mockReset()
  statSyncMock.mockReturnValue({ isDirectory: () => true })
  vi.resetModules()
})

describe('remote editor opening', () => {
  test('builds VS Code-compatible remote SSH args with alias authority', async () => {
    const { remoteEditorArgs } = await import('#/main/system/open-app.ts')

    expect(remoteEditorArgs(TARGET, '/srv/goblin-feature-x')).toEqual([
      '--remote',
      'ssh-remote+prod',
      '/srv/goblin-feature-x',
    ])
  })

  test('falls back to user at host authority when no alias exists', async () => {
    const { remoteEditorArgs } = await import('#/main/system/open-app.ts')

    expect(remoteEditorArgs({ ...TARGET, alias: null }, '/srv/goblin-feature-x')).toEqual([
      '--remote',
      'ssh-remote+deploy@prod.example.com',
      '/srv/goblin-feature-x',
    ])
  })

  test('routes preferred remote editor through the resolved backend', async () => {
    execaMock.mockResolvedValue({ failed: false, stderr: '', shortMessage: '', message: '' })
    const { openRemoteInPreferredEditor } = await import('#/main/system/editors.ts')

    const result = openRemoteInPreferredEditor(TARGET, '/srv/goblin-feature-x', 'vscode')

    expect(result).not.toBeNull()
    await expect(result).resolves.toEqual({
      ok: true,
      message: '/srv/goblin-feature-x',
    })

    expect(execaMock).toHaveBeenCalledWith(
      expect.stringContaining('Visual Studio Code.app/Contents/Resources/app/bin/code'),
      ['--remote', 'ssh-remote+prod', '/srv/goblin-feature-x'],
      expect.objectContaining({ timeout: 10_000, reject: false }),
    )
  })

  test.each([
    ['cursor' as const, 'Cursor.app/Contents/Resources/app/bin/cursor'],
    ['windsurf' as const, 'Windsurf.app/Contents/Resources/app/bin/windsurf'],
  ])('routes %s remote editor through its app CLI', async (pref, cliSuffix) => {
    execaMock.mockResolvedValue({ failed: false, stderr: '', shortMessage: '', message: '' })
    const { openRemoteInPreferredEditor } = await import('#/main/system/editors.ts')

    const result = openRemoteInPreferredEditor(TARGET, '/srv/goblin-feature-x', pref)

    expect(result).not.toBeNull()
    await expect(result).resolves.toEqual({ ok: true, message: '/srv/goblin-feature-x' })
    expect(execaMock).toHaveBeenCalledWith(
      expect.stringContaining(cliSuffix),
      ['--remote', 'ssh-remote+prod', '/srv/goblin-feature-x'],
      expect.objectContaining({ timeout: 10_000, reject: false }),
    )
  })

  test('returns invalid path before invoking the editor for malformed remote paths', async () => {
    const { openRemoteInPreferredEditor } = await import('#/main/system/editors.ts')

    const result = openRemoteInPreferredEditor(TARGET, 'relative/path', 'vscode')

    expect(result).not.toBeNull()
    await expect(result).resolves.toEqual({
      ok: false,
      message: 'error.invalid-path',
    })
    expect(execaMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the editor test and verify red**

Run:

```sh
bun run test "src/main/system/editors.test.ts"
```

Expected: FAIL because `remoteEditorArgs` and `openRemoteInPreferredEditor` do not exist.

- [ ] **Step 3: Add remote CLI helpers**

In `src/main/system/open-app.ts`, import the remote type:

```ts
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
```

Add these helpers below `openByAppCli`:

```ts
function isUsableRemoteDirectory(p: string): boolean {
  return p.length > 0 && p.length <= 4096 && p.startsWith('/') && !p.includes('\0')
}

export function remoteEditorAuthority(target: RemoteRepoTarget): string {
  return target.alias ?? `${target.user}@${target.host}`
}

export function remoteEditorArgs(target: RemoteRepoTarget, dir: string): string[] {
  return ['--remote', `ssh-remote+${remoteEditorAuthority(target)}`, dir]
}

export function openRemoteByAppCli(
  appName: string,
  cliName: string,
  target: RemoteRepoTarget,
  dir: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isUsableRemoteDirectory(dir)) return Promise.resolve({ ok: false, message: 'error.invalid-path' })

  const cli = resolveAppCli(appName, cliName)
  if (!cli) return Promise.resolve({ ok: false, message: 'error.editor-not-installed' })

  return execa(cli, remoteEditorArgs(target, dir), {
    timeout: OPEN_TIMEOUT_MS,
    forceKillAfterDelay: 500,
    reject: false,
  }).then((result) => {
    if (result.failed) {
      const message = result.stderr?.trim() || result.shortMessage || result.message || 'error.remote-editor-unavailable'
      return { ok: false, message }
    }
    return { ok: true, message: dir }
  })
}
```

- [ ] **Step 4: Add remote editor functions for each backend**

Update `src/main/system/vscode.ts`:

```ts
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { hasAppCli, openByAppCli, openRemoteByAppCli } from '#/main/system/open-app.ts'

const APP_NAME = 'Visual Studio Code'
const CLI_NAME = 'code'

export function isVSCodeInstalled(): boolean {
  return hasAppCli(APP_NAME, CLI_NAME)
}

export function openInVSCode(p: string): Promise<{ ok: boolean; message: string }> {
  return openByAppCli(APP_NAME, CLI_NAME, p)
}

export function openRemoteInVSCode(
  target: RemoteRepoTarget,
  p: string,
): Promise<{ ok: boolean; message: string }> {
  return openRemoteByAppCli(APP_NAME, CLI_NAME, target, p)
}
```

Update `src/main/system/cursor.ts`:

```ts
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { hasAppCli, openByAppCli, openRemoteByAppCli } from '#/main/system/open-app.ts'

const APP_NAME = 'Cursor'
const CLI_NAME = 'cursor'

export function isCursorInstalled(): boolean {
  return hasAppCli(APP_NAME, CLI_NAME)
}

export function openInCursor(p: string): Promise<{ ok: boolean; message: string }> {
  return openByAppCli(APP_NAME, CLI_NAME, p)
}

export function openRemoteInCursor(
  target: RemoteRepoTarget,
  p: string,
): Promise<{ ok: boolean; message: string }> {
  return openRemoteByAppCli(APP_NAME, CLI_NAME, target, p)
}
```

Update `src/main/system/windsurf.ts`:

```ts
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { hasAppCli, openByAppCli, openRemoteByAppCli } from '#/main/system/open-app.ts'

const APP_NAME = 'Windsurf'
const CLI_NAME = 'windsurf'

export function isWindsurfInstalled(): boolean {
  return hasAppCli(APP_NAME, CLI_NAME)
}

export function openInWindsurf(p: string): Promise<{ ok: boolean; message: string }> {
  return openByAppCli(APP_NAME, CLI_NAME, p)
}

export function openRemoteInWindsurf(
  target: RemoteRepoTarget,
  p: string,
): Promise<{ ok: boolean; message: string }> {
  return openRemoteByAppCli(APP_NAME, CLI_NAME, target, p)
}
```

- [ ] **Step 5: Extend the editor registry**

In `src/main/system/editors.ts`, update imports and the interface:

```ts
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { isVSCodeInstalled, openInVSCode, openRemoteInVSCode } from '#/main/system/vscode.ts'
import { isCursorInstalled, openInCursor, openRemoteInCursor } from '#/main/system/cursor.ts'
import { isWindsurfInstalled, openInWindsurf, openRemoteInWindsurf } from '#/main/system/windsurf.ts'

export interface EditorBackend {
  isInstalled: () => boolean
  open: (path: string) => Promise<{ ok: boolean; message: string }>
  openRemote?: (target: RemoteRepoTarget, path: string) => Promise<{ ok: boolean; message: string }>
}
```

Replace the backend map:

```ts
const backends: Record<ResolvedEditorApp, EditorBackend> = {
  vscode: { isInstalled: isVSCodeInstalled, open: openInVSCode, openRemote: openRemoteInVSCode },
  cursor: { isInstalled: isCursorInstalled, open: openInCursor, openRemote: openRemoteInCursor },
  windsurf: { isInstalled: isWindsurfInstalled, open: openInWindsurf, openRemote: openRemoteInWindsurf },
}
```

Add this export below `openInPreferredEditor`:

```ts
export function openRemoteInPreferredEditor(
  target: RemoteRepoTarget,
  path: string,
  pref: EditorPref,
): Promise<{ ok: boolean; message: string }> | null {
  const resolved = resolveEditorApp(pref)
  if (!resolved) return null
  const opener = backends[resolved].openRemote
  return opener ? opener(target, path) : Promise.resolve({ ok: false, message: 'error.remote-editor-unavailable' })
}
```

- [ ] **Step 6: Run the editor test and verify green**

Run:

```sh
bun run test "src/main/system/editors.test.ts"
```

Expected: PASS.

## Task 4: Shared RPC Contract And Main RPC Wiring

**Files:**

- Modify: `src/shared/rpc.ts`
- Modify: `src/main/rpc.ts`
- Modify: `src/main/rpc.test.ts`

- [ ] **Step 1: Add failing main RPC tests**

In `src/main/rpc.test.ts`, update the `#/main/system/editors.ts` mock:

```ts
vi.mock('#/main/system/editors.ts', () => ({
  getResolvedEditorApp: vi.fn(() => null),
  openInPreferredEditor: vi.fn(),
  openRemoteInPreferredEditor: vi.fn(() => ({ ok: true, message: 'ok' })),
}))
```

Update the `#/main/ssh/git.ts` mock:

```ts
vi.mock('#/main/ssh/git.ts', () => ({
  createRemoteWorktree: vi.fn(() => ({ ok: true, message: 'ok' })),
  fetchRemoteRepository: vi.fn(() => ({ ok: true, message: 'ok' })),
  getRemoteLog: vi.fn(() => []),
  getRemoteSnapshot: vi.fn(() => ({ branches: [], current: '' })),
  getRemoteStatus: vi.fn(() => []),
  removeRemoteWorktree: vi.fn(() => ({ ok: true, message: 'ok' })),
}))
```

Extend the existing remote procedure acceptance test:

```ts
    await expect(
      invokeRpc('remote.openEditor', {
        target: REMOTE_TARGET,
        path: '/srv/goblin-feature-x',
      }),
    ).resolves.toMatchObject({ ok: true, data: { ok: true, message: 'ok' } })
    await expect(
      invokeRpc('remote.removeWorktree', {
        target: REMOTE_TARGET,
        branch: 'feature/x',
        worktreePath: '/srv/goblin-feature-x',
        alsoDeleteBranch: true,
        forceDeleteBranch: false,
      }),
    ).resolves.toMatchObject({ ok: true, data: { ok: true, message: 'ok' } })
```

Add a router rejection test:

```ts
  test('rejects invalid remote editor and remove worktree paths at the router boundary', async () => {
    await expect(
      invokeRpc('remote.openEditor', {
        target: REMOTE_TARGET,
        path: 'relative/path',
      }),
    ).resolves.toMatchObject({ ok: false })

    await expect(
      invokeRpc('remote.removeWorktree', {
        target: REMOTE_TARGET,
        branch: 'feature/x',
        worktreePath: 'relative/path',
        alsoDeleteBranch: false,
      }),
    ).resolves.toMatchObject({ ok: false })
  })
```

- [ ] **Step 2: Run the main RPC test and verify red**

Run:

```sh
bun run test "src/main/rpc.test.ts"
```

Expected: FAIL because `remote.openEditor` and `remote.removeWorktree` are not in the shared router or handlers.

- [ ] **Step 3: Extend shared handler types**

In `src/shared/rpc.ts`, add these entries to `AppRpcHandlers['remote']`:

```ts
    openEditor: (input: { target: RemoteRepoTarget; path: string }) => Promise<ExecResult>
    removeWorktree: (input: {
      target: RemoteRepoTarget
      branch: string
      worktreePath: string
      alsoDeleteBranch: boolean
      forceDeleteBranch?: boolean
    }) => Promise<ExecResult>
```

- [ ] **Step 4: Extend the remote router**

In `createAppRouter()` in `src/shared/rpc.ts`, add these procedures inside `remote: t.router({ ... })`:

```ts
      openEditor: p
        .input(v.object({ target: RemoteTargetSchema, path: RemoteAbsolutePath }))
        .mutation(({ input }) => handlers.remote.openEditor(input)),
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
```

- [ ] **Step 5: Wire main RPC handlers**

In `src/main/rpc.ts`, import the new functions:

```ts
import { getResolvedEditorApp, openInPreferredEditor, openRemoteInPreferredEditor } from '#/main/system/editors.ts'
```

Update the SSH git import:

```ts
import {
  createRemoteWorktree,
  fetchRemoteRepository,
  getRemoteLog,
  getRemoteSnapshot,
  getRemoteStatus,
  removeRemoteWorktree,
} from '#/main/ssh/git.ts'
```

Add these handlers inside the existing `remote` handler object:

```ts
      openEditor: async ({ target, path }) => {
        if (!isValidRemoteAbsolutePath(path)) return { ok: false, message: 'error.invalid-path' }
        return (
          openRemoteInPreferredEditor(normalizedRemoteTargetOrThrow(target), path, getEditorApp()) ?? {
            ok: false,
            message: 'error.editor-not-installed',
          }
        )
      },
      removeWorktree: async ({ target, branch, worktreePath, alsoDeleteBranch, forceDeleteBranch }) => {
        if (
          !isValidRemoteAbsolutePath(worktreePath) ||
          !isValidBranch(branch) ||
          typeof alsoDeleteBranch !== 'boolean' ||
          (forceDeleteBranch !== undefined && typeof forceDeleteBranch !== 'boolean')
        ) {
          return { ok: false, message: 'error.invalid-arguments' }
        }
        return removeRemoteWorktree(normalizedRemoteTargetOrThrow(target), {
          branch,
          worktreePath,
          alsoDeleteBranch,
          forceDeleteBranch,
          signal: currentRpcSignal(),
        })
      },
```

- [ ] **Step 6: Run the main RPC test and verify green**

Run:

```sh
bun run test "src/main/rpc.test.ts"
```

Expected: PASS.

## Task 5: Renderer Store Routing For Remote Removal

**Files:**

- Modify: `src/renderer/stores/repos/branch-actions.test.ts`
- Modify: `src/renderer/stores/repos/branch-actions.ts`

- [ ] **Step 1: Replace the remote blocked-action test and add remote removal routing test**

In `src/renderer/stores/repos/branch-actions.test.ts`, replace the existing `keeps non-create remote branch actions unavailable` test with:

```ts
  test('allows remote remove worktree and refreshes remote snapshot/status', async () => {
    resetReposStore()
    const remote = emptyRepo(REMOTE_TARGET.id, REMOTE_TARGET.displayName, {
      kind: 'remote',
      remoteTarget: REMOTE_TARGET,
    })
    useReposStore.setState({
      repos: { [REMOTE_TARGET.id]: remote },
      order: [REMOTE_TARGET.id],
      activeId: REMOTE_TARGET.id,
      sessionReady: true,
    })
    const calls: string[] = []
    installGoblinTestBridge({
      'remote.removeWorktree': async ({ target, branch, worktreePath, alsoDeleteBranch, forceDeleteBranch }: any) => {
        calls.push(`${target.id}:${branch}:${worktreePath}:${alsoDeleteBranch}:${forceDeleteBranch}`)
        return { ok: true, message: 'ok' }
      },
      'remote.snapshot': async () => ({ branches: [], current: '' }),
      'remote.status': async () => [],
      'repo.abort': async () => false,
    })

    const result = await useReposStore.getState().runBranchAction(REMOTE_TARGET.id, {
      kind: 'removeWorktree',
      branch: 'feature/x',
      worktreePath: '/srv/goblin-feature-x',
      alsoDeleteBranch: true,
      forceDeleteBranch: false,
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(calls).toEqual([`${REMOTE_TARGET.id}:feature/x:/srv/goblin-feature-x:true:false`])
  })

  test('keeps unsupported remote branch actions unavailable', async () => {
    resetReposStore()
    const remote = emptyRepo(REMOTE_TARGET.id, REMOTE_TARGET.displayName, {
      kind: 'remote',
      remoteTarget: REMOTE_TARGET,
    })
    useReposStore.setState({
      repos: { [REMOTE_TARGET.id]: remote },
      order: [REMOTE_TARGET.id],
      activeId: REMOTE_TARGET.id,
      sessionReady: true,
    })

    const result = await useReposStore.getState().runBranchAction(REMOTE_TARGET.id, {
      kind: 'push',
      branch: 'feature/x',
    })

    expect(result).toEqual({ ok: false, message: 'error.remote-unavailable' })
  })
```

- [ ] **Step 2: Run the branch actions store test and verify red**

Run:

```sh
bun run test "src/renderer/stores/repos/branch-actions.test.ts"
```

Expected: FAIL because remote `removeWorktree` is still blocked and not routed to `rpc.remote.removeWorktree`.

- [ ] **Step 3: Allow only remote create and remove actions**

In `src/renderer/stores/repos/branch-actions.ts`, add:

```ts
const REMOTE_BRANCH_ACTIONS = new Set<RepoBranchActionKind>(['createWorktree', 'removeWorktree'])
```

Replace `canStartBranchAction` with:

```ts
function canStartBranchAction(repo: RepoState, action: RepoBranchAction): boolean {
  if (repo.kind === 'remote') return REMOTE_BRANCH_ACTIONS.has(action.kind) && canStartManualFetch(repo)
  return canStartRemoteFetch(repo)
}
```

- [ ] **Step 4: Route remote removal RPC**

In `runBranchActionRpc`, replace the remote branch with:

```ts
  if (repo.kind === 'remote') {
    if (!repo.remoteTarget || !REMOTE_BRANCH_ACTIONS.has(action.kind)) {
      return Promise.resolve({ ok: false, message: 'error.remote-unavailable' })
    }
    if (action.kind === 'createWorktree') {
      return rpc.remote.createWorktree.mutate(
        {
          target: repo.remoteTarget,
          worktreePath: action.worktreePath,
          newBranch: action.newBranch,
          baseBranch: action.baseBranch,
        },
        { signal },
      )
    }
    if (action.kind === 'removeWorktree') {
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
    return Promise.resolve({ ok: false, message: 'error.remote-unavailable' })
  }
```

In `runBranchAction`, replace this guard:

```ts
      if (repoBefore.kind === 'remote' && action.kind !== 'createWorktree') {
        return { ok: false, message: 'error.remote-unavailable' }
      }
```

with:

```ts
      if (repoBefore.kind === 'remote' && !REMOTE_BRANCH_ACTIONS.has(action.kind)) {
        return { ok: false, message: 'error.remote-unavailable' }
      }
```

- [ ] **Step 5: Run the branch actions store test and verify green**

Run:

```sh
bun run test "src/renderer/stores/repos/branch-actions.test.ts"
```

Expected: PASS.

## Task 6: Renderer Branch Action Capability And Item Visibility

**Files:**

- Modify: `src/renderer/hooks/branch-action-state.test.ts`
- Modify: `src/renderer/hooks/branch-action-state.ts`
- Create: `src/renderer/hooks/useBranchActionItems.test.tsx`
- Modify: `src/renderer/hooks/useBranchActions.tsx`
- Modify: `src/renderer/hooks/useBranchActionItems.ts`

- [ ] **Step 1: Update branch action availability tests**

In `src/renderer/hooks/branch-action-state.test.ts`, update imports:

```ts
import {
  branchActionItemIdFromOperation,
  branchActionsAvailable,
  isBranchActionBlocked,
  repoBranchActionsAvailable,
} from '#/renderer/hooks/branch-action-state.ts'
import { createBranch } from '#/renderer/stores/repos/test-utils.ts'
```

Replace the `repoBranchActionsAvailable` test with:

```ts
  test('keeps local branch actions available and enables remote repos with targets', () => {
    const local = emptyRepo('/tmp/gbl-branch-action-local', 'repo')
    const remote = emptyRepo('ssh://deploy@prod:22/srv/goblin', 'prod:goblin', {
      kind: 'remote',
      remoteTarget: {
        id: 'ssh://deploy@prod:22/srv/goblin',
        alias: 'prod',
        host: 'prod',
        user: 'deploy',
        port: 22,
        remotePath: '/srv/goblin',
        displayName: 'prod:goblin',
      },
    })
    const remoteMissingTarget = emptyRepo('ssh://deploy@prod:22/srv/missing', 'prod:missing', { kind: 'remote' })

    expect(repoBranchActionsAvailable(local)).toBe(true)
    expect(repoBranchActionsAvailable(remote)).toBe(true)
    expect(repoBranchActionsAvailable(remoteMissingTarget)).toBe(false)
  })

  test('uses branch-level availability for remote worktree rows', () => {
    const remote = emptyRepo('ssh://deploy@prod:22/srv/goblin', 'prod:goblin', {
      kind: 'remote',
      remoteTarget: {
        id: 'ssh://deploy@prod:22/srv/goblin',
        alias: 'prod',
        host: 'prod',
        user: 'deploy',
        port: 22,
        remotePath: '/srv/goblin',
        displayName: 'prod:goblin',
      },
    })

    expect(branchActionsAvailable(remote, createBranch('feature/x'))).toBe(false)
    expect(branchActionsAvailable(remote, createBranch('feature/x', { worktreePath: '/srv/goblin-feature-x' }))).toBe(
      true,
    )
  })
```

- [ ] **Step 2: Run branch action state tests and verify red**

Run:

```sh
bun run test "src/renderer/hooks/branch-action-state.test.ts"
```

Expected: FAIL because `branchActionsAvailable` does not exist and remote repo availability is false.

- [ ] **Step 3: Implement repo and branch availability helpers**

In `src/renderer/hooks/branch-action-state.ts`, import the branch type:

```ts
import type { BranchInfo } from '#/renderer/types.ts'
```

Replace `repoBranchActionsAvailable` and add `branchActionsAvailable`:

```ts
export function repoBranchActionsAvailable(repo: RepoState): boolean {
  return repo.kind !== 'remote' || !!repo.remoteTarget
}

export function branchActionsAvailable(repo: RepoState, branch: BranchInfo | null | undefined): boolean {
  if (!branch || !repoBranchActionsAvailable(repo)) return false
  if (repo.kind !== 'remote') return true
  return !!branch.worktreePath
}
```

- [ ] **Step 4: Run branch action state tests and verify green**

Run:

```sh
bun run test "src/renderer/hooks/branch-action-state.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Add remote action item visibility tests**

Create `src/renderer/hooks/useBranchActionItems.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { useBranchActionItems } from '#/renderer/hooks/useBranchActionItems.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { createBranch } from '#/renderer/stores/repos/test-utils.ts'
import type { BranchInfo } from '#/renderer/types.ts'

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

vi.mock('#/renderer/stores/settings.ts', () => ({
  useSettingsStore: (selector: any) =>
    selector({
      terminalApp: 'auto',
      resolvedTerminalApp: 'terminal',
      terminalAvailable: true,
      editorApp: 'auto',
      resolvedEditorApp: 'vscode',
      editorAvailable: true,
    }),
}))

vi.mock('#/renderer/stores/repos/store.ts', () => ({
  useReposStore: (selector: any) =>
    selector({
      setLastResult: vi.fn(),
      runBranchAction: vi.fn(),
    }),
}))

const REMOTE_TARGET = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: 'prod',
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

function visibleIds(repo = remoteRepo(), branch = createBranch('feature/x', { worktreePath: '/srv/goblin-feature-x' })) {
  const html = renderToStaticMarkup(<ActionItemProbe repo={repo} branch={branch} />)
  const encoded = html.match(/data-visible="([^"]*)"/)?.[1] ?? ''
  return encoded ? encoded.split(',') : []
}

function ActionItemProbe({ repo, branch }: { repo: RepoState; branch: BranchInfo }) {
  const groups = useBranchActionItems(repo, branch)
  const ids = [...groups.patchItems, ...groups.mainItems, ...groups.destructiveItems]
    .filter((item) => item.visible)
    .map((item) => item.id)
    .join(',')
  return <span data-visible={ids} />
}

function remoteRepo() {
  return emptyRepo(REMOTE_TARGET.id, REMOTE_TARGET.displayName, {
    kind: 'remote',
    remoteTarget: REMOTE_TARGET,
  })
}

describe('useBranchActionItems remote visibility', () => {
  test('shows only editor and remove worktree for remote linked worktrees', () => {
    expect(visibleIds()).toEqual(['editor', 'removeWorktree'])
  })

  test('shows only editor for the primary remote worktree', () => {
    expect(
      visibleIds(remoteRepo(), createBranch('main', { worktreePath: '/srv/goblin', worktreeIsPrimary: true })),
    ).toEqual(['editor'])
  })

  test('shows no remote actions when there is no worktree path', () => {
    expect(visibleIds(remoteRepo(), createBranch('feature/x'))).toEqual([])
  })
})
```

- [ ] **Step 6: Run action item tests and verify red**

Run:

```sh
bun run test "src/renderer/hooks/useBranchActionItems.test.tsx"
```

Expected: FAIL because remote capabilities still expose hidden state incorrectly and checkout/push/GitHub have unconditional visibility.

- [ ] **Step 7: Make `useBranchActions` remote-aware**

In `src/renderer/hooks/useBranchActions.tsx`, change the local action type:

```ts
type UiOnlyBranchActionItemId = 'copyPatch' | 'github' | 'terminal' | 'editor'
```

Update the `useAsyncPending` call and `runUiAction` parameter from `LocalBranchActionItemId` to `UiOnlyBranchActionItemId`.

Replace `openEditor` with:

```ts
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
```

Replace the capability calculation block with:

```ts
  const isCurrent = branch.name === repo.data.currentBranch
  const checkedOutInAnotherWorktree = !!branch.worktreePath && !isCurrent
  const canRemoveWorktree = checkedOutInAnotherWorktree && !branch.worktreeIsPrimary
  const isProtected = PROTECTED_BRANCHES.has(branch.name)
  const isRegularBranch = repo.kind !== 'remote' && !isCurrent && !branch.worktreePath && !isProtected
  const changedStatus = branch.worktreePath ? repo.data.status.find((wt) => wt.path === branch.worktreePath) : null
  const canCopyPatch = repo.kind !== 'remote' && !!branch.worktreePath && (changedStatus?.entries.length ?? 0) > 0
  const removeConfirmProtected = removeConfirm ? PROTECTED_BRANCHES.has(removeConfirm.branch) : false
  const remoteReady = repo.kind === 'remote' && !!repo.remoteTarget
```

Replace the returned capabilities object with:

```ts
    capabilities: {
      isCurrent,
      checkedOutInAnotherWorktree,
      canCheckout: repo.kind !== 'remote' && !isCurrent && !checkedOutInAnotherWorktree,
      canRemoveWorktree: repo.kind === 'remote' ? remoteReady && canRemoveWorktree : canRemoveWorktree,
      isRegularBranch,
      canCopyPatch,
      canPull: repo.kind !== 'remote' && !!branch.tracking,
      canPush: repo.kind !== 'remote',
      canOpenTerminal: repo.kind !== 'remote' && !!branch.worktreePath,
      canOpenEditor: repo.kind === 'remote' ? remoteReady && !!branch.worktreePath : !!branch.worktreePath,
      canOpenGitHub: repo.kind !== 'remote',
    },
```

- [ ] **Step 8: Make `useBranchActionItems` visibility capability-driven**

In `src/renderer/hooks/useBranchActionItems.ts`, change the `checkout`, `push`, and `github` entries:

```ts
    {
      id: 'checkout',
      label: t('action.checkout'),
      disabled,
      busy: busy('checkout'),
      visible: capabilities.canCheckout,
      shortcut: '↩',
      icon: createElement(GitBranch),
      onSelect: actions.checkout,
    },
```

```ts
    {
      id: 'push',
      label: t('action.push'),
      disabled,
      busy: busy('push'),
      visible: capabilities.canPush,
      shortcut: '⇧P',
      icon: createElement(ArrowUp),
      onSelect: actions.push,
    },
```

```ts
    {
      id: 'github',
      label: pullRequest ? t('action.github-pr', { n: pullRequest.number }) : t('action.github'),
      disabled,
      busy: busy('github'),
      visible: capabilities.canOpenGitHub,
      shortcut: '⇧G',
      icon: createElement(githubIcon),
      onSelect: actions.openGitHub,
    },
```

- [ ] **Step 9: Run action item tests and verify green**

Run:

```sh
bun run test "src/renderer/hooks/useBranchActionItems.test.tsx"
```

Expected: PASS.

## Task 7: UI Action Surface For Remote Rows And Detail Toolbar

**Files:**

- Modify: `src/renderer/components/BranchList.tsx`
- Modify: `src/renderer/components/branch-detail/BranchDetailToolbar.tsx`
- Create: `src/renderer/components/branch-list/BranchRow.test.tsx`
- Test: `src/renderer/hooks/branch-action-state.test.ts`
- Test: `src/renderer/hooks/useBranchActionItems.test.tsx`

- [ ] **Step 1: Use branch-level action availability in the branch list**

In `src/renderer/components/BranchList.tsx`, replace the import:

```ts
import { branchActionsAvailable } from '#/renderer/hooks/branch-action-state.ts'
```

Remove this line:

```ts
  const rowActionsVisible = showActions && repoBranchActionsAvailable(repo)
```

In the `BranchRow` props, replace:

```tsx
            showActions={rowActionsVisible}
```

with:

```tsx
            showActions={showActions && branchActionsAvailable(repo, branch)}
```

- [ ] **Step 2: Use branch-level action availability in the detail toolbar**

In `src/renderer/components/branch-detail/BranchDetailToolbar.tsx`, replace the import:

```ts
import { branchActionsAvailable } from '#/renderer/hooks/branch-action-state.ts'
```

Replace the action bar condition:

```tsx
      {branchActionsAvailable(repo, detail.branch) && (
        <BranchActionBar
          key={`${repo.id}:${detail.branch.name}`}
          repo={repo}
          branch={detail.branch}
          variant={behavior.detailActionVariant}
        />
      )}
```

- [ ] **Step 3: Add a row action gate component test**

Create `src/renderer/components/branch-list/BranchRow.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { BranchRow } from '#/renderer/components/branch-list/BranchRow.tsx'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { createBranch } from '#/renderer/stores/repos/test-utils.ts'

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

vi.mock('#/renderer/components/BranchActionsMenu.tsx', () => ({
  BranchActionsMenu: () => <span data-actions="branch-actions" />,
}))

describe('BranchRow action gate', () => {
  test('renders row actions only when showActions is true', () => {
    const repo = emptyRepo('/repo', 'repo')
    const branch = createBranch('feature/x', { worktreePath: '/repo-feature-x' })
    const selectedRef = { current: null }

    const withActions = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={branch}
        selected="feature/x"
        current="main"
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
        showActions
      />,
    )
    const withoutActions = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={branch}
        selected="feature/x"
        current="main"
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
        showActions={false}
      />,
    )

    expect(withActions).toContain('data-actions="branch-actions"')
    expect(withoutActions).not.toContain('data-actions="branch-actions"')
  })
})
```

- [ ] **Step 4: Run focused renderer tests**

Run:

```sh
bun run test "src/renderer/hooks/branch-action-state.test.ts" "src/renderer/hooks/useBranchActionItems.test.tsx" "src/renderer/components/branch-list/BranchRow.test.tsx"
```

Expected: PASS.

## Task 8: i18n Error Copy

**Files:**

- Modify: `src/main/i18n/en.ts`
- Modify: `src/main/i18n/zh.ts`
- Modify: `src/main/i18n/ja.ts`
- Modify: `src/main/i18n/ko.ts`

- [ ] **Step 1: Add remote editor unavailable copy**

Add the same key near the existing editor/terminal error keys.

In `src/main/i18n/en.ts`:

```ts
  'error.remote-editor-unavailable': 'Remote editor opening is not available for the selected editor',
```

In `src/main/i18n/zh.ts`:

```ts
  'error.remote-editor-unavailable': '当前选择的编辑器不支持打开远程目录',
```

In `src/main/i18n/ja.ts`:

```ts
  'error.remote-editor-unavailable': '選択したエディターではリモートディレクトリを開けません',
```

In `src/main/i18n/ko.ts`:

```ts
  'error.remote-editor-unavailable': '선택한 에디터에서는 원격 디렉터리를 열 수 없습니다',
```

- [ ] **Step 2: Run typecheck for i18n syntax coverage**

Run:

```sh
bun run typecheck
```

Expected: PASS. If this fails, fix only syntax/type errors introduced by this plan.

## Task 9: Final Verification

**Files:**

- Verify all changed files.

- [ ] **Step 1: Run focused tests**

Run:

```sh
bun run test "src/main/ssh/commands.test.ts" "src/main/ssh/git.test.ts" "src/main/system/editors.test.ts" "src/main/rpc.test.ts" "src/renderer/stores/repos/branch-actions.test.ts" "src/renderer/hooks/branch-action-state.test.ts" "src/renderer/hooks/useBranchActionItems.test.tsx" "src/renderer/components/branch-list/BranchRow.test.tsx"
```

Expected: PASS.

- [ ] **Step 2: Run full unit test suite**

Run:

```sh
bun run test
```

Expected: PASS.

- [ ] **Step 3: Run full typecheck**

Run:

```sh
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect changed files**

Run:

```sh
git status --short
```

Expected: changed files are limited to the files listed in this plan plus the previously approved spec/plan docs. Do not commit unless the user explicitly asks.
