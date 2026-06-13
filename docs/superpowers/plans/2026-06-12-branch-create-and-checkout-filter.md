# Branch Create And Checkout Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add separate branch-row actions for creating local branches and tracking remote branches, and filter worktree checkout candidates to branches Git can safely switch to.

**Architecture:** Keep branch creation in the existing repo action pipeline: shared input normalization, system git helpers, local/remote repo backend methods, server routes, renderer client/store actions, and branch-row dialogs. Keep checkout filtering as a small pure renderer helper used by `CheckoutToDialog`.

**Tech Stack:** TypeScript strip-only Node mode, Bun, Vitest, React 19, Zustand, Hono server routes, existing SSH remote command runner.

---

## Notes For Implementers

The project AGENTS instructions say not to plan or execute git commits unless the user explicitly asks. This plan therefore uses "Checkpoint" steps instead of commit steps.

Run targeted tests after each task. Run the full verification suite at the end:

```bash
bun run typecheck
bun run test
bun run check:architecture
```

## File Structure

- Create `src/shared/branch-create.ts`: branch-create input type and normalization for local and remote-tracking branch creation.
- Create `src/shared/branch-create.test.ts`: unit coverage for branch-create normalization.
- Modify `src/shared/worktree-create.ts`: export `isRemoteTrackingRef` for reuse.
- Modify `src/shared/worktree-create.test.ts`: add direct coverage for exported `isRemoteTrackingRef`.
- Create `src/web/components/branch-list/checkout-candidates.ts`: pure checkout candidate filtering.
- Create `src/web/components/branch-list/checkout-candidates.test.ts`: candidate helper tests.
- Modify `src/system/git/branches.ts`: add local `createBranch` and `createTrackingBranch` helpers.
- Create `src/system/git/branches.test.ts`: argument and validation tests for branch helpers.
- Modify `src/system/ssh/commands.ts`: add remote branch create command kinds and scripts.
- Modify `src/system/ssh/commands.test.ts`: command script coverage.
- Modify `src/system/ssh/git.ts`: add remote branch create helpers.
- Modify `src/system/ssh/git.test.ts`: remote validation and command dispatch tests.
- Modify `src/server/modules/repo-backend.ts`: add `RepoBackend.createBranch`.
- Modify `src/server/modules/repo-write-paths.ts`: add write entry points for local and tracking branch creation.
- Modify `src/server/routes/repo.ts`: add `/api/repo/create-branch` and `/api/repo/track-remote-branch`.
- Modify `src/server/modules/repo.test.ts`: backend and invalidation coverage.
- Modify `src/web/repo-client.ts`: add client functions for both endpoints.
- Modify `src/web/repo-client.test.ts`: endpoint request body coverage.
- Modify `src/web/stores/repos/branch-action-types.ts`: add action variants.
- Modify `src/web/stores/repos/operations.ts`: add operation reasons.
- Modify `src/web/stores/repos/types.ts`: add event action variants.
- Modify `src/web/stores/repos/action-labels.ts`: add loading, queued, and success labels.
- Modify `src/web/stores/repos/branch-actions.ts`: schedule and dispatch new action kinds.
- Modify `src/web/stores/repos/branch-actions.test.ts`: store coverage.
- Modify `src/web/stores/repos/test-utils.ts`: fake server route mapping for new endpoints.
- Modify `src/web/hooks/branch-action-state.ts`: add branch action item ids and busy mapping.
- Modify `src/web/hooks/useBranchWriteActions.tsx`: add menu items, dialog state, submit handlers, and busy disabling.
- Modify `src/web/hooks/useBranchActionItems.test.tsx`: verify new menu item ids.
- Modify `src/web/components/branch-list/BranchWriteDialogs.tsx`: add `CreateBranchDialog`, `TrackRemoteBranchDialog`, and use checkout candidates.
- Create `src/web/components/branch-list/BranchWriteDialogs.test.tsx`: dialog behavior tests.
- Modify `src/shared/i18n/en.ts`, `src/shared/i18n/zh.ts`, `src/shared/i18n/ko.ts`, `src/shared/i18n/ja.ts`: add localized labels and validation copy.

### Naming Decisions

Use these identifiers consistently:

```ts
type CreateBranchInput =
  | { kind: 'local'; branch: string; baseBranch: string }
  | { kind: 'trackRemote'; localBranch: string; remoteRef: string }

type RepoBranchAction =
  | { kind: 'createBranch'; branch: string; baseBranch: string }
  | { kind: 'trackRemoteBranch'; localBranch: string; remoteRef: string }
```

Use these route names:

```text
/api/repo/create-branch
/api/repo/track-remote-branch
```

Use these client functions:

```ts
createRepositoryBranch(cwd, branch, baseBranch, signal?, sourceToken?)
trackRepositoryRemoteBranch(cwd, localBranch, remoteRef, signal?, sourceToken?)
```

Use these i18n keys:

```text
action.create-branch
action.create-branch-title
action.create-branch-base-label
action.create-branch-name-label
action.create-branch-placeholder
action.create-branch-invalid
action.create-branch-exists
action.create-branch-confirm
action.create-branch-creating-title
action.create-branch-queued-title
action.create-branch-created-title
action.track-remote-branch
action.track-remote-branch-title
action.track-remote-branch-label
action.track-remote-branch-placeholder
action.track-remote-branch-loading
action.track-remote-branch-empty
action.track-remote-branch-local-label
action.track-remote-branch-local-placeholder
action.track-remote-branch-invalid
action.track-remote-branch-exists
action.track-remote-branch-confirm
action.track-remote-branch-creating-title
action.track-remote-branch-queued-title
action.track-remote-branch-created-title
action.checkout-to-empty
```

## Task 1: Shared Branch Create Input And Checkout Candidate Helpers

**Files:**
- Create: `src/shared/branch-create.ts`
- Create: `src/shared/branch-create.test.ts`
- Modify: `src/shared/worktree-create.ts`
- Modify: `src/shared/worktree-create.test.ts`
- Create: `src/web/components/branch-list/checkout-candidates.ts`
- Create: `src/web/components/branch-list/checkout-candidates.test.ts`

- [ ] **Step 1: Export remote-tracking ref validation from the existing worktree helper**

In `src/shared/worktree-create.ts`, change the existing private helper:

```ts
function isRemoteTrackingRef(ref: string): boolean {
```

to:

```ts
export function isRemoteTrackingRef(ref: string): boolean {
```

No call sites need to change.

- [ ] **Step 2: Add direct tests for `isRemoteTrackingRef`**

Add these tests to `src/shared/worktree-create.test.ts`:

```ts
import { isRemoteTrackingRef } from '#/shared/worktree-create.ts'

describe('isRemoteTrackingRef', () => {
  test.each([
    ['origin/main'],
    ['origin/feature/test'],
    ['upstream/release/1.0'],
  ])('accepts %s', (ref) => {
    expect(isRemoteTrackingRef(ref)).toBe(true)
  })

  test.each([
    ['main'],
    ['origin/HEAD'],
    ['origin/'],
    ['/feature/test'],
    ['origin/-bad'],
    ['bad remote/feature'],
  ])('rejects %s', (ref) => {
    expect(isRemoteTrackingRef(ref)).toBe(false)
  })
})
```

If `worktree-create.test.ts` already imports from `worktree-create.ts`, merge `isRemoteTrackingRef` into the existing import instead of adding a duplicate import.

- [ ] **Step 3: Run the focused shared test and verify the export is covered**

Run:

```bash
bun run test -- src/shared/worktree-create.test.ts
```

Expected: the new `isRemoteTrackingRef` tests pass, or existing compile errors point to the import shape you just adjusted.

- [ ] **Step 4: Create branch-create normalization tests**

Create `src/shared/branch-create.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { normalizeCreateBranchInput } from '#/shared/branch-create.ts'

describe('normalizeCreateBranchInput', () => {
  test('normalizes local branch creation input', () => {
    expect(
      normalizeCreateBranchInput({
        kind: 'local',
        branch: ' feature/new ',
        baseBranch: ' main ',
      }),
    ).toEqual({ kind: 'local', branch: 'feature/new', baseBranch: 'main' })
  })

  test('normalizes remote tracking branch creation input', () => {
    expect(
      normalizeCreateBranchInput({
        kind: 'trackRemote',
        localBranch: ' feature/remote ',
        remoteRef: ' origin/feature/remote ',
      }),
    ).toEqual({ kind: 'trackRemote', localBranch: 'feature/remote', remoteRef: 'origin/feature/remote' })
  })

  test.each([
    [null],
    [{}],
    [{ kind: 'local', branch: '', baseBranch: 'main' }],
    [{ kind: 'local', branch: '-bad', baseBranch: 'main' }],
    [{ kind: 'local', branch: 'feature/new', baseBranch: '-bad' }],
    [{ kind: 'trackRemote', localBranch: '', remoteRef: 'origin/main' }],
    [{ kind: 'trackRemote', localBranch: '-bad', remoteRef: 'origin/main' }],
    [{ kind: 'trackRemote', localBranch: 'feature/main', remoteRef: 'main' }],
    [{ kind: 'trackRemote', localBranch: 'feature/main', remoteRef: 'origin/HEAD' }],
  ])('rejects invalid input %#', (input) => {
    expect(normalizeCreateBranchInput(input)).toBeNull()
  })
})
```

- [ ] **Step 5: Run the new branch-create test and verify it fails because the module is missing**

Run:

```bash
bun run test -- src/shared/branch-create.test.ts
```

Expected: FAIL with an import/module error for `#/shared/branch-create.ts`.

- [ ] **Step 6: Implement `src/shared/branch-create.ts`**

Create `src/shared/branch-create.ts`:

```ts
import { isSafeBranchName } from '#/shared/refnames.ts'
import { isRemoteTrackingRef } from '#/shared/worktree-create.ts'

export type CreateBranchInput =
  | { kind: 'local'; branch: string; baseBranch: string }
  | { kind: 'trackRemote'; localBranch: string; remoteRef: string }

export function normalizeCreateBranchInput(input: unknown): CreateBranchInput | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  switch (raw.kind) {
    case 'local': {
      const branch = stringField(raw.branch)
      const baseBranch = stringField(raw.baseBranch)
      return branch && baseBranch && isSafeBranchName(branch) && isSafeBranchName(baseBranch)
        ? { kind: 'local', branch, baseBranch }
        : null
    }
    case 'trackRemote': {
      const localBranch = stringField(raw.localBranch)
      const remoteRef = stringField(raw.remoteRef)
      return localBranch && remoteRef && isSafeBranchName(localBranch) && isRemoteTrackingRef(remoteRef)
        ? { kind: 'trackRemote', localBranch, remoteRef }
        : null
    }
    default:
      return null
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
```

- [ ] **Step 7: Add checkout candidate helper tests**

Create `src/web/components/branch-list/checkout-candidates.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { checkoutBranchCandidates } from '#/web/components/branch-list/checkout-candidates.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

function branch(name: string, worktreePath?: string): RepoBranchState {
  return {
    name,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
    ...(worktreePath ? { worktree: { path: worktreePath } } : {}),
  }
}

describe('checkoutBranchCandidates', () => {
  test('excludes the target worktree current branch', () => {
    expect(checkoutBranchCandidates('feature/current', [branch('feature/current'), branch('feature/free')]).map((b) => b.name)).toEqual([
      'feature/free',
    ])
  })

  test('excludes branches checked out in any worktree', () => {
    const result = checkoutBranchCandidates('feature/current', [
      branch('feature/current', '/tmp/repo-current'),
      branch('feature/other-worktree', '/tmp/repo-other'),
      branch('feature/free'),
    ])

    expect(result.map((b) => b.name)).toEqual(['feature/free'])
  })

  test('does not mutate the source array', () => {
    const branches = [branch('feature/current', '/tmp/repo-current'), branch('feature/free')]
    const result = checkoutBranchCandidates('feature/current', branches)

    expect(result).not.toBe(branches)
    expect(branches.map((b) => b.name)).toEqual(['feature/current', 'feature/free'])
  })
})
```

- [ ] **Step 8: Run the checkout candidate test and verify it fails because the module is missing**

Run:

```bash
bun run test -- src/web/components/branch-list/checkout-candidates.test.ts
```

Expected: FAIL with an import/module error for `checkout-candidates.ts`.

- [ ] **Step 9: Implement checkout candidate helper**

Create `src/web/components/branch-list/checkout-candidates.ts`:

```ts
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

export function checkoutBranchCandidates(currentBranch: string, branches: RepoBranchState[]): RepoBranchState[] {
  return branches.filter((branch) => branch.name !== currentBranch && !branch.worktree?.path)
}
```

- [ ] **Step 10: Run shared and candidate tests**

Run:

```bash
bun run test -- src/shared/worktree-create.test.ts src/shared/branch-create.test.ts src/web/components/branch-list/checkout-candidates.test.ts
```

Expected: PASS.

- [ ] **Step 11: Checkpoint**

Confirm `git diff --stat` shows only shared helper and checkout candidate files from this task before moving on.

## Task 2: Local System Git Branch Creation Helpers

**Files:**
- Modify: `src/system/git/branches.ts`
- Create: `src/system/git/branches.test.ts`

- [ ] **Step 1: Write local git helper tests**

Create `src/system/git/branches.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createBranch, createTrackingBranch } from '#/system/git/branches.ts'

const gitResultWithOptionsMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/helper.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/helper.ts')>('#/system/git/helper.ts')
  return {
    ...actual,
    gitResultWithOptions: vi.fn((cwd: string, opts: unknown, ...args: string[]) => gitResultWithOptionsMock(cwd, opts, ...args)),
  }
})

describe('branch git operations', () => {
  beforeEach(() => {
    gitResultWithOptionsMock.mockReset()
    gitResultWithOptionsMock.mockResolvedValue({ ok: true, message: 'ok' })
  })

  test('creates a local branch from a base branch', async () => {
    const signal = new AbortController().signal

    const result = await createBranch('/tmp/repo', 'feature/new', 'main', signal)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/tmp/repo',
      { signal },
      'branch',
      '--',
      'feature/new',
      'main',
    )
  })

  test('creates a local tracking branch from a remote-tracking ref', async () => {
    const signal = new AbortController().signal

    const result = await createTrackingBranch('/tmp/repo', 'feature/remote', 'origin/feature/remote', signal)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/tmp/repo',
      { signal },
      'branch',
      '--track',
      'feature/remote',
      'origin/feature/remote',
    )
  })

  test.each([
    ['-bad', 'main'],
    ['feature/new', '-bad'],
  ])('rejects invalid createBranch input %#', async (branch, baseBranch) => {
    await expect(createBranch('/tmp/repo', branch, baseBranch)).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    expect(gitResultWithOptionsMock).not.toHaveBeenCalled()
  })

  test.each([
    ['-bad', 'origin/feature/remote'],
    ['feature/remote', 'main'],
    ['feature/remote', 'origin/HEAD'],
  ])('rejects invalid createTrackingBranch input %#', async (localBranch, remoteRef) => {
    await expect(createTrackingBranch('/tmp/repo', localBranch, remoteRef)).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    expect(gitResultWithOptionsMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the local git helper test and verify it fails**

Run:

```bash
bun run test -- src/system/git/branches.test.ts
```

Expected: FAIL because `createBranch` and `createTrackingBranch` are not exported.

- [ ] **Step 3: Implement local git helpers**

In `src/system/git/branches.ts`, add this import:

```ts
import { isRemoteTrackingRef } from '#/shared/worktree-create.ts'
```

Add these functions near `checkoutBranch` and `deleteBranch`:

```ts
export async function createBranch(
  cwd: string,
  name: string,
  baseBranch: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isSafeBranchName(name) || !isSafeBranchName(baseBranch)) return { ok: false, message: 'error.invalid-arguments' }
  return gitResultWithOptions(cwd, { signal }, 'branch', '--', name, baseBranch)
}

export async function createTrackingBranch(
  cwd: string,
  localBranch: string,
  remoteRef: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isSafeBranchName(localBranch) || !isRemoteTrackingRef(remoteRef)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  return gitResultWithOptions(cwd, { signal }, 'branch', '--track', localBranch, remoteRef)
}
```

- [ ] **Step 4: Run the local git helper test**

Run:

```bash
bun run test -- src/system/git/branches.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run:

```bash
bun run test -- src/shared/branch-create.test.ts src/system/git/branches.test.ts
```

Expected: PASS.

## Task 3: Remote SSH Branch Creation Helpers

**Files:**
- Modify: `src/system/ssh/commands.ts`
- Modify: `src/system/ssh/commands.test.ts`
- Modify: `src/system/ssh/git.ts`
- Modify: `src/system/ssh/git.test.ts`

- [ ] **Step 1: Add remote command script tests**

Add these tests to `src/system/ssh/commands.test.ts`:

```ts
  test('renders branch create commands', () => {
    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitBranchCreate',
        path: '/srv/repo',
        branch: 'feature/new',
        baseBranch: 'main',
      }).script,
    ).toContain("git -C '/srv/repo' branch -- 'feature/new' 'main'")

    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitBranchTrackRemote',
        path: '/srv/repo',
        localBranch: 'feature/remote',
        remoteRef: 'origin/feature/remote',
      }).script,
    ).toContain("git -C '/srv/repo' branch --track 'feature/remote' 'origin/feature/remote'")
  })
```

- [ ] **Step 2: Run command tests and verify they fail**

Run:

```bash
bun run test -- src/system/ssh/commands.test.ts
```

Expected: FAIL because `RemoteCommandKind` does not contain `gitBranchCreate` or `gitBranchTrackRemote`.

- [ ] **Step 3: Add command kinds and scripts**

In `src/system/ssh/commands.ts`, extend `RemoteCommandKind`:

```ts
  | { type: 'gitBranchCreate'; path: string; branch: string; baseBranch: string }
  | { type: 'gitBranchTrackRemote'; path: string; localBranch: string; remoteRef: string }
```

Add cases in `scriptForCommand` near `gitBranchDelete`:

```ts
    case 'gitBranchCreate':
      return `git -C ${shellQuote(command.path)} branch -- ${shellQuote(command.branch)} ${shellQuote(command.baseBranch)}`
    case 'gitBranchTrackRemote':
      return `git -C ${shellQuote(command.path)} branch --track ${shellQuote(command.localBranch)} ${shellQuote(command.remoteRef)}`
```

- [ ] **Step 4: Add remote git helper tests**

Update the import from `src/system/ssh/git.ts` in `src/system/ssh/git.test.ts` to include:

```ts
  createRemoteBranch,
  createRemoteTrackingBranch,
```

Add these tests in `describe('remote git helpers', () => { ... })`:

```ts
  test('createRemoteBranch dispatches a validated remote branch create command', async () => {
    const run = vi.fn(async () => okRemoteResult('created'))

    const result = await createRemoteBranch(TARGET, {
      branch: 'feature/new',
      baseBranch: 'main',
      run: run as any,
    })

    expect(result).toEqual({ ok: true, message: 'created' })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitBranchCreate', path: '/srv/repo', branch: 'feature/new', baseBranch: 'main' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('createRemoteTrackingBranch dispatches a validated remote tracking command', async () => {
    const run = vi.fn(async () => okRemoteResult('created'))

    const result = await createRemoteTrackingBranch(TARGET, {
      localBranch: 'feature/remote',
      remoteRef: 'origin/feature/remote',
      run: run as any,
    })

    expect(result).toEqual({ ok: true, message: 'created' })
    expect(run).toHaveBeenCalledWith(
      {
        type: 'gitBranchTrackRemote',
        path: '/srv/repo',
        localBranch: 'feature/remote',
        remoteRef: 'origin/feature/remote',
      },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('remote branch create helpers reject invalid refs before running commands', async () => {
    const run = vi.fn()

    await expect(createRemoteBranch(TARGET, { branch: '-bad', baseBranch: 'main', run: run as any })).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(
      createRemoteTrackingBranch(TARGET, {
        localBranch: 'feature/remote',
        remoteRef: 'origin/HEAD',
        run: run as any,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(run).not.toHaveBeenCalled()
  })
```

- [ ] **Step 5: Run remote git tests and verify they fail**

Run:

```bash
bun run test -- src/system/ssh/commands.test.ts src/system/ssh/git.test.ts
```

Expected: FAIL because remote git helper exports do not exist yet.

- [ ] **Step 6: Implement remote git helpers**

In `src/system/ssh/git.ts`, update the import from `src/shared/worktree-create.ts`:

```ts
import { isRemoteTrackingRef, parseRemoteTrackingRefs, type CreateWorktreeInput } from '#/shared/worktree-create.ts'
```

Add these functions near `createRemoteWorktree` or `deleteRemoteBranch`:

```ts
export async function createRemoteBranch(
  target: RemoteRepoTarget,
  input: { branch: string; baseBranch: string; signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<ExecResult> {
  if (!isSafeBranchName(input.branch) || !isSafeBranchName(input.baseBranch)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    { type: 'gitBranchCreate', path: target.remotePath, branch: input.branch, baseBranch: input.baseBranch },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}

export async function createRemoteTrackingBranch(
  target: RemoteRepoTarget,
  input: { localBranch: string; remoteRef: string; signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<ExecResult> {
  if (!isSafeBranchName(input.localBranch) || !isRemoteTrackingRef(input.remoteRef)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    {
      type: 'gitBranchTrackRemote',
      path: target.remotePath,
      localBranch: input.localBranch,
      remoteRef: input.remoteRef,
    },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}
```

- [ ] **Step 7: Run remote tests**

Run:

```bash
bun run test -- src/system/ssh/commands.test.ts src/system/ssh/git.test.ts
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

Run:

```bash
bun run test -- src/system/git/branches.test.ts src/system/ssh/commands.test.ts src/system/ssh/git.test.ts
```

Expected: PASS.

## Task 4: Server Backend, Routes, And Renderer Client

**Files:**
- Modify: `src/server/modules/repo-backend.ts`
- Modify: `src/server/modules/repo-write-paths.ts`
- Modify: `src/server/routes/repo.ts`
- Modify: `src/server/modules/repo.test.ts`
- Modify: `src/web/repo-client.ts`
- Modify: `src/web/repo-client.test.ts`
- Modify: `src/web/stores/repos/test-utils.ts`

- [ ] **Step 1: Extend server module mocks for branch creation**

In `src/server/modules/repo.test.ts`, add these entries to the hoisted `mocks` object:

```ts
  createBranch: vi.fn(),
  createTrackingBranch: vi.fn(),
  createRemoteBranch: vi.fn(),
  createRemoteTrackingBranch: vi.fn(),
```

Update the `vi.mock('#/system/git/branches.ts', ...)` return value:

```ts
  createBranch: mocks.createBranch,
  createTrackingBranch: mocks.createTrackingBranch,
```

Update the `vi.mock('#/system/ssh/git.ts', ...)` return value:

```ts
  createRemoteBranch: mocks.createRemoteBranch,
  createRemoteTrackingBranch: mocks.createRemoteTrackingBranch,
```

In `beforeEach`, add:

```ts
  mocks.createBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.createTrackingBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.createRemoteBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.createRemoteTrackingBranch.mockResolvedValue({ ok: true, message: 'ok' })
```

- [ ] **Step 2: Add server write-path tests**

Add these tests inside `describe('repo mutation invalidation publishing', () => { ... })`:

```ts
  test('createRepositoryBranch delegates to backend and publishes source-token invalidation', async () => {
    const { createRepositoryBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepositoryBranch('/tmp/repo', 'feature/new', 'main', undefined, 'repo_branch_test')

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.createBranch).toHaveBeenCalledWith('/tmp/repo', 'feature/new', 'main', undefined)
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
      sourceToken: 'repo_branch_test',
    })
  })

  test('trackRepositoryRemoteBranch delegates to backend and publishes source-token invalidation', async () => {
    const { trackRepositoryRemoteBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await trackRepositoryRemoteBranch(
      '/tmp/repo',
      'feature/remote',
      'origin/feature/remote',
      undefined,
      'repo_branch_test',
    )

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.createTrackingBranch).toHaveBeenCalledWith(
      '/tmp/repo',
      'feature/remote',
      'origin/feature/remote',
      undefined,
    )
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
      sourceToken: 'repo_branch_test',
    })
  })

  test.each([
    [
      'createRepositoryBranch',
      () => mocks.createBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: branch exists' }),
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.createRepositoryBranch('/tmp/repo', 'feature/new', 'main'),
    ],
    [
      'trackRepositoryRemoteBranch',
      () => mocks.createTrackingBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: branch exists' }),
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.trackRepositoryRemoteBranch('/tmp/repo', 'feature/remote', 'origin/feature/remote'),
    ],
  ])('%s does not publish snapshot invalidation after failure', async (_name, setup, run) => {
    setup()
    const repo = await import('#/server/modules/repo-write-paths.ts')

    await run(repo)

    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })
```

- [ ] **Step 3: Run server tests and verify they fail**

Run:

```bash
bun run test -- src/server/modules/repo.test.ts
```

Expected: FAIL because server write functions and backend methods are not implemented.

- [ ] **Step 4: Extend `RepoBackend`**

In `src/server/modules/repo-backend.ts`, add imports:

```ts
import { createBranch, createTrackingBranch } from '#/system/git/branches.ts'
import { createRemoteBranch, createRemoteTrackingBranch } from '#/system/ssh/git.ts'
import type { CreateBranchInput } from '#/shared/branch-create.ts'
```

If `branches.ts` and `ssh/git.ts` imports already exist, merge these symbols into existing import blocks.

Add to `RepoBackend`:

```ts
  createBranch(input: CreateBranchInput, signal?: AbortSignal): Promise<ExecResult>
```

Add to the local backend object:

```ts
    async createBranch(input, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      return input.kind === 'local'
        ? await createBranch(repoId, input.branch, input.baseBranch, signal)
        : await createTrackingBranch(repoId, input.localBranch, input.remoteRef, signal)
    },
```

Add to the remote backend object:

```ts
    async createBranch(input, signal) {
      return input.kind === 'local'
        ? await createRemoteBranch(target, { branch: input.branch, baseBranch: input.baseBranch, signal })
        : await createRemoteTrackingBranch(target, {
            localBranch: input.localBranch,
            remoteRef: input.remoteRef,
            signal,
          })
    },
```

- [ ] **Step 5: Implement server write paths**

In `src/server/modules/repo-write-paths.ts`, add:

```ts
import { normalizeCreateBranchInput } from '#/shared/branch-create.ts'
```

Add these functions near `createRepositoryWorktree`:

```ts
export async function createRepositoryBranch(
  cwd: string,
  branch: string,
  baseBranch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  if (!isValidRepoLocator(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  const input = normalizeCreateBranchInput({ kind: 'local', branch, baseBranch })
  if (!input) return { ok: false, message: 'error.invalid-arguments' }
  return await runWithRepoBackend(cwd, async (backend) => {
    return await publishSnapshotInvalidationAfterMutation(cwd, await backend.createBranch(input, signal), sourceToken)
  })
}

export async function trackRepositoryRemoteBranch(
  cwd: string,
  localBranch: string,
  remoteRef: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  if (!isValidRepoLocator(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  const input = normalizeCreateBranchInput({ kind: 'trackRemote', localBranch, remoteRef })
  if (!input) return { ok: false, message: 'error.invalid-arguments' }
  return await runWithRepoBackend(cwd, async (backend) => {
    return await publishSnapshotInvalidationAfterMutation(cwd, await backend.createBranch(input, signal), sourceToken)
  })
}
```

- [ ] **Step 6: Add server routes**

In `src/server/routes/repo.ts`, add imports:

```ts
  createRepositoryBranch,
  trackRepositoryRemoteBranch,
```

Add routes near `/create-worktree`:

```ts
  app.post('/create-branch', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const branch = typeof body?.branch === 'string' ? body.branch : ''
    const baseBranch = typeof body?.baseBranch === 'string' ? body.baseBranch : ''
    const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
    return c.json(
      await jsonOr(
        () => createRepositoryBranch(cwd, branch, baseBranch, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'create-branch',
      ),
    )
  })

  app.post('/track-remote-branch', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const localBranch = typeof body?.localBranch === 'string' ? body.localBranch : ''
    const remoteRef = typeof body?.remoteRef === 'string' ? body.remoteRef : ''
    const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
    return c.json(
      await jsonOr(
        () => trackRepositoryRemoteBranch(cwd, localBranch, remoteRef, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'track-remote-branch',
      ),
    )
  })
```

- [ ] **Step 7: Add renderer client tests**

Add this test to `src/web/repo-client.test.ts`:

```ts
  test('posts branch creation requests through embedded server routes', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'created' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'tracked' }) })
    vi.stubGlobal('fetch', fetchMock)

    const { createRepositoryBranch, trackRepositoryRemoteBranch } = await import('#/web/repo-client.ts')

    await expect(createRepositoryBranch('/tmp/repo', 'feature/new', 'main')).resolves.toEqual({
      ok: true,
      message: 'created',
    })
    await expect(trackRepositoryRemoteBranch('/tmp/repo', 'feature/remote', 'origin/feature/remote')).resolves.toEqual({
      ok: true,
      message: 'tracked',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:32100/api/repo/create-branch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
        body: JSON.stringify({ cwd: '/tmp/repo', branch: 'feature/new', baseBranch: 'main' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:32100/api/repo/track-remote-branch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
        body: JSON.stringify({ cwd: '/tmp/repo', localBranch: 'feature/remote', remoteRef: 'origin/feature/remote' }),
      }),
    )
  })
```

- [ ] **Step 8: Run client test and verify it fails**

Run:

```bash
bun run test -- src/web/repo-client.test.ts
```

Expected: FAIL because client functions do not exist.

- [ ] **Step 9: Implement renderer client functions**

In `src/web/repo-client.ts`, add:

```ts
export async function createRepositoryBranch(
  cwd: string,
  branch: string,
  baseBranch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/create-branch', { cwd, branch, baseBranch, sourceToken }, { signal })
}

export async function trackRepositoryRemoteBranch(
  cwd: string,
  localBranch: string,
  remoteRef: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/track-remote-branch', { cwd, localBranch, remoteRef, sourceToken }, { signal })
}
```

- [ ] **Step 10: Add fake server route mapping**

In `src/web/stores/repos/test-utils.ts`, add route mappings near `/api/repo/create-worktree`:

```ts
        if (url.pathname === '/api/repo/create-branch') return call('repo.createBranch', body)
        if (url.pathname === '/api/repo/track-remote-branch') return call('repo.trackRemoteBranch', body)
```

- [ ] **Step 11: Run server and client tests**

Run:

```bash
bun run test -- src/server/modules/repo.test.ts src/web/repo-client.test.ts
```

Expected: PASS.

- [ ] **Step 12: Checkpoint**

Run:

```bash
bun run check:architecture
```

Expected: PASS. This confirms no renderer/server/main boundary was crossed incorrectly.

## Task 5: Repo Store Action Wiring And Activity Labels

**Files:**
- Modify: `src/web/stores/repos/branch-action-types.ts`
- Modify: `src/web/stores/repos/operations.ts`
- Modify: `src/web/stores/repos/types.ts`
- Modify: `src/web/stores/repos/action-labels.ts`
- Modify: `src/web/stores/repos/branch-actions.ts`
- Modify: `src/web/stores/repos/branch-actions.test.ts`
- Modify: `src/web/hooks/branch-action-state.ts`

- [ ] **Step 1: Add store tests for new action dispatch and metadata**

In `src/web/stores/repos/branch-actions.test.ts`, add this test in `describe('runBranchAction', ...)`:

```ts
  test.each([
    [
      'createBranch',
      { kind: 'createBranch' as const, branch: 'feature/new', baseBranch: 'main' },
      'repo.createBranch',
      { cwd: REPO_ID, branch: 'feature/new', baseBranch: 'main', sourceToken: expect.any(String) },
      { kind: 'createBranch', branch: 'feature/new', baseBranch: 'main' },
    ],
    [
      'trackRemoteBranch',
      { kind: 'trackRemoteBranch' as const, localBranch: 'feature/remote', remoteRef: 'origin/feature/remote' },
      'repo.trackRemoteBranch',
      { cwd: REPO_ID, localBranch: 'feature/remote', remoteRef: 'origin/feature/remote', sourceToken: expect.any(String) },
      { kind: 'trackRemoteBranch', branch: 'feature/remote', remoteRef: 'origin/feature/remote' },
    ],
  ])('dispatches %s and records result metadata', async (_label, action, rpcPath, expectedPayload, expectedEventAction) => {
    let payload: unknown = null
    installGoblinTestBridge({
      [rpcPath]: async (input) => {
        payload = input
        return { ok: true, message: 'ok' }
      },
      'repo.snapshot': async () => ({
        branches: [createBranchSnapshot('feature/a'), createBranchSnapshot('feature/new')],
        current: 'feature/a',
      }),
      'repo.status': async () => [],
      'repo.pullRequests': async () => [],
    })

    const result = await useReposStore.getState().runBranchAction(REPO_ID, action)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(payload).toMatchObject(expectedPayload)
    expect(useReposStore.getState().repos[REPO_ID]?.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: true, message: 'ok' },
      action: expectedEventAction,
    })
  })
```

Extend the existing `test.each([...])('waits for core refresh reads before running queued %s actions', ...)` table with:

```ts
    ['createBranch', { kind: 'createBranch', branch: 'feature/new', baseBranch: 'main' }, 'repo.createBranch'],
    [
      'trackRemoteBranch',
      { kind: 'trackRemoteBranch', localBranch: 'feature/remote', remoteRef: 'origin/feature/remote' },
      'repo.trackRemoteBranch',
    ],
```

- [ ] **Step 2: Run store tests and verify they fail**

Run:

```bash
bun run test -- src/web/stores/repos/branch-actions.test.ts
```

Expected: FAIL because action types and dispatch are missing.

- [ ] **Step 3: Extend branch action union**

In `src/web/stores/repos/branch-action-types.ts`, add:

```ts
  | { kind: 'createBranch'; branch: string; baseBranch: string }
  | { kind: 'trackRemoteBranch'; localBranch: string; remoteRef: string }
```

- [ ] **Step 4: Extend operation reasons**

In `src/web/stores/repos/operations.ts`, add to `RepoBranchActionReason`:

```ts
  | 'branch:createBranch'
  | 'branch:trackRemoteBranch'
```

- [ ] **Step 5: Extend event action variants**

In `src/web/stores/repos/types.ts`, add to `RepoEventAction`:

```ts
  | { kind: 'createBranch'; branch: string; baseBranch: string }
  | { kind: 'trackRemoteBranch'; branch: string; remoteRef: string }
```

- [ ] **Step 6: Extend action labels**

In `src/web/stores/repos/action-labels.ts`, add to `BRANCH_ACTION_LOADING_LABEL_KEYS`:

```ts
  createBranch: 'action.create-branch-creating-title',
  trackRemoteBranch: 'action.track-remote-branch-creating-title',
```

Add to `BRANCH_ACTION_QUEUED_LABEL_KEYS`:

```ts
  createBranch: 'action.create-branch-queued-title',
  trackRemoteBranch: 'action.track-remote-branch-queued-title',
```

Add cases in `repoEventActionSuccessLabel`:

```ts
    case 'createBranch':
      return { labelKey: 'action.create-branch-created-title' }
    case 'trackRemoteBranch':
      return { labelKey: 'action.track-remote-branch-created-title' }
```

- [ ] **Step 7: Extend branch action state mapping**

In `src/web/hooks/branch-action-state.ts`, add item ids:

```ts
  | 'createBranch'
  | 'trackRemoteBranch'
```

Add cases to `branchActionItemIdFromKind`:

```ts
    case 'createBranch':
      return 'createBranch'
    case 'trackRemoteBranch':
      return 'trackRemoteBranch'
```

- [ ] **Step 8: Wire store dispatch**

In `src/web/stores/repos/branch-actions.ts`, import the new client functions:

```ts
  createRepositoryBranch,
  trackRepositoryRemoteBranch,
```

Extend `BRANCH_ACTION_REASON_BY_KIND`:

```ts
  createBranch: 'branch:createBranch',
  trackRemoteBranch: 'branch:trackRemoteBranch',
```

Extend `branchActionOperationTarget`:

```ts
    case 'createBranch':
      return action.branch
    case 'trackRemoteBranch':
      return action.localBranch
```

Extend `branchActionEventAction`:

```ts
    case 'createBranch':
      return { kind: action.kind, branch: action.branch, baseBranch: action.baseBranch }
    case 'trackRemoteBranch':
      return { kind: action.kind, branch: action.localBranch, remoteRef: action.remoteRef }
```

Extend `runBranchActionRpc`:

```ts
    case 'createBranch':
      return createRepositoryBranch(repoId, action.branch, action.baseBranch, signal, sourceToken)
    case 'trackRemoteBranch':
      return trackRepositoryRemoteBranch(repoId, action.localBranch, action.remoteRef, signal, sourceToken)
```

- [ ] **Step 9: Run store tests**

Run:

```bash
bun run test -- src/web/stores/repos/branch-actions.test.ts
```

Expected: PASS.

- [ ] **Step 10: Checkpoint**

Run:

```bash
bun run test -- src/web/stores/repos/branch-actions.test.ts src/server/modules/repo.test.ts src/web/repo-client.test.ts
```

Expected: PASS.

## Task 6: Branch Write Dialogs And Menu Items

**Files:**
- Modify: `src/web/components/branch-list/BranchWriteDialogs.tsx`
- Create: `src/web/components/branch-list/BranchWriteDialogs.test.tsx`
- Modify: `src/web/hooks/useBranchWriteActions.tsx`
- Modify: `src/web/hooks/useBranchActionItems.test.tsx`

- [ ] **Step 1: Add dialog and checkout filtering tests**

Create `src/web/components/branch-list/BranchWriteDialogs.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  CheckoutToDialog,
  CreateBranchDialog,
  TrackRemoteBranchDialog,
} from '#/web/components/branch-list/BranchWriteDialogs.tsx'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('BranchWriteDialogs', () => {
  test('CheckoutToDialog hides current and checked-out branches', () => {
    render(
      <CheckoutToDialog
        open
        branch={branch('feature/current', '/tmp/repo-current')}
        allBranches={[
          branch('feature/current', '/tmp/repo-current'),
          branch('feature/other', '/tmp/repo-other'),
          branch('feature/free'),
        ]}
        onClose={vi.fn()}
        onCheckout={vi.fn(async () => {})}
      />,
    )

    expect(document.body.textContent).not.toContain('feature/current')
    expect(document.body.textContent).not.toContain('feature/other')
    expect(document.body.textContent).toContain('feature/free')
  })

  test('CreateBranchDialog submits a new branch based on the selected row branch', async () => {
    const onCreate = vi.fn(async () => {})
    const onClose = vi.fn()
    render(
      <CreateBranchDialog
        open
        branch={branch('feature/base')}
        allBranches={[branch('feature/base')]}
        branchActionBusy={false}
        onClose={onClose}
        onCreate={onCreate}
      />,
    )

    setInputValue('#create-branch-name', 'feature/new')
    click('button[type="submit"]')
    await flush()

    expect(onCreate).toHaveBeenCalledWith('feature/new', 'feature/base')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('CreateBranchDialog blocks duplicate branch names', () => {
    const onCreate = vi.fn(async () => {})
    render(
      <CreateBranchDialog
        open
        branch={branch('feature/base')}
        allBranches={[branch('feature/base'), branch('feature/new')]}
        branchActionBusy={false}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    )

    setInputValue('#create-branch-name', 'feature/new')

    expect(button('button[type="submit"]').disabled).toBe(true)
    expect(onCreate).not.toHaveBeenCalled()
  })

  test('TrackRemoteBranchDialog derives a local branch name from the first remote ref', async () => {
    const onTrack = vi.fn(async () => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ['origin/feature/remote'] })),
    )
    Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
      configurable: true,
      value: { initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } },
    })

    render(
      <TrackRemoteBranchDialog
        open
        repoId="/tmp/repo"
        allBranches={[branch('main')]}
        branchActionBusy={false}
        onClose={vi.fn()}
        onTrack={onTrack}
      />,
    )

    await waitForAssertion(() => {
      expect(input('#track-remote-local-branch').placeholder).toBe('feature/remote')
    })
    click('button[type="submit"]')
    await flush()

    expect(onTrack).toHaveBeenCalledWith('feature/remote', 'origin/feature/remote')
  })
})

function branch(name: string, worktreePath?: string): RepoBranchState {
  return {
    name,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
    ...(worktreePath ? { worktree: { path: worktreePath } } : {}),
  }
}

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}

function input(selector: string): HTMLInputElement {
  const element = document.body.querySelector(selector)
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input: ${selector}`)
  return element
}

function button(selector: string): HTMLButtonElement {
  const element = document.body.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`)
  return element
}

function setInputValue(selector: string, value: string) {
  const element = input(selector)
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(element, value)
  act(() => {
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function click(selector: string) {
  const element = button(selector)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function waitForAssertion(assertion: () => void) {
  let lastError: unknown
  for (let i = 0; i < 10; i += 1) {
    try {
      assertion()
      return
    } catch (err) {
      lastError = err
      await flush()
    }
  }
  throw lastError
}
```

If jsdom cannot interact with the Radix select item text directly, keep the tests focused on initial render, derived local name, disabled states, and callback payloads.

- [ ] **Step 2: Run dialog tests and verify they fail**

Run:

```bash
bun run test -- src/web/components/branch-list/BranchWriteDialogs.test.tsx
```

Expected: FAIL because the new dialog exports do not exist and checkout filtering is not applied.

- [ ] **Step 3: Use the checkout candidate helper in `CheckoutToDialog`**

In `src/web/components/branch-list/BranchWriteDialogs.tsx`, add:

```ts
import { checkoutBranchCandidates } from '#/web/components/branch-list/checkout-candidates.ts'
```

Replace:

```ts
  const candidates = allBranches.filter((b) => b.name !== branch.name)
```

with:

```ts
  const candidates = checkoutBranchCandidates(branch.name, allBranches)
```

Inside `<SelectContent>`, after the candidates map, add:

```tsx
              {candidates.length === 0 && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">{t('action.checkout-to-empty')}</div>
              )}
```

The existing submit button already disables on `!selected`.

- [ ] **Step 4: Add `CreateBranchDialog`**

In `src/web/components/branch-list/BranchWriteDialogs.tsx`, add:

```tsx
interface CreateBranchDialogProps {
  open: boolean
  branch: RepoBranchState
  allBranches: RepoBranchState[]
  branchActionBusy: boolean
  onClose: () => void
  onCreate: (branch: string, baseBranch: string) => Promise<void>
}

export function CreateBranchDialog({
  open,
  branch,
  allBranches,
  branchActionBusy,
  onClose,
  onCreate,
}: CreateBranchDialogProps) {
  const t = useT()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isPending, run } = useAsyncPending<'createBranch'>()
  const trimmed = name.trim()
  const branchExists = !!trimmed && allBranches.some((item) => item.name === trimmed)
  const invalid = !!trimmed && !validateBranchName(trimmed).ok
  const validationError = invalid
    ? t('action.create-branch-invalid')
    : branchExists
      ? t('action.create-branch-exists')
      : ''
  const canSubmit = !!trimmed && !validationError && !branchActionBusy && !isPending

  useEffect(() => {
    if (!open) {
      setName('')
      setError(null)
    }
  }, [open])

  async function handleConfirm() {
    if (!canSubmit) return
    setError(null)
    await run('createBranch', async () => {
      try {
        await onCreate(trimmed, branch.name)
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isPending) onClose()
      }}
      title={t('action.create-branch-title')}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleConfirm()
        }}
        className="space-y-4"
      >
        <Field>
          <FieldLabel>{t('action.create-branch-base-label')}</FieldLabel>
          <div className="break-all rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-xs">
            {branch.name}
          </div>
        </Field>
        <Field data-invalid={validationError ? true : undefined}>
          <FieldLabel htmlFor="create-branch-name">{t('action.create-branch-name-label')}</FieldLabel>
          <Input
            id="create-branch-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('action.create-branch-placeholder')}
            aria-invalid={!!validationError}
            aria-describedby={validationError ? 'create-branch-error' : undefined}
          />
          <FieldError id="create-branch-error" reserveHeight aria-live="polite" aria-atomic="true">
            {validationError}
          </FieldError>
        </Field>
        {error && <DialogError>{error}</DialogError>}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('action.create-branch-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}
```

Also add imports if missing:

```ts
import { Input } from '#/web/components/ui/input.tsx'
import { FieldError } from '#/web/components/ui/field.tsx'
import { validateBranchName } from '#/shared/refnames.ts'
```

Merge `FieldError` into the existing `Field` import from `#/web/components/ui/field.tsx`.

- [ ] **Step 5: Add `TrackRemoteBranchDialog`**

In `src/web/components/branch-list/BranchWriteDialogs.tsx`, add:

```tsx
interface TrackRemoteBranchDialogProps {
  open: boolean
  repoId: string
  allBranches: RepoBranchState[]
  branchActionBusy: boolean
  onClose: () => void
  onTrack: (localBranch: string, remoteRef: string) => Promise<void>
}

export function TrackRemoteBranchDialog({
  open,
  repoId,
  allBranches,
  branchActionBusy,
  onClose,
  onTrack,
}: TrackRemoteBranchDialogProps) {
  const t = useT()
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [remoteBranchesLoading, setRemoteBranchesLoading] = useState(false)
  const [remoteRef, setRemoteRef] = useState('')
  const [localBranch, setLocalBranch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isPending, run } = useAsyncPending<'trackRemoteBranch'>()

  useEffect(() => {
    if (!open) {
      setRemoteBranches([])
      setRemoteBranchesLoading(false)
      setRemoteRef('')
      setLocalBranch('')
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!open || remoteBranches.length > 0) return
    const ctrl = new AbortController()
    setRemoteBranchesLoading(true)
    void getRepositoryRemoteBranches(repoId, ctrl.signal)
      .then((branches) => {
        if (ctrl.signal.aborted) return
        setRemoteBranches(branches)
        setRemoteRef(branches[0] ?? '')
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setRemoteBranches([])
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setRemoteBranchesLoading(false)
      })
    return () => ctrl.abort()
  }, [open, remoteBranches.length, repoId])

  const selectedRemoteRef = remoteRef || remoteBranches[0] || ''
  const derivedLocalBranch = deriveLocalBranchFromRemoteRef(selectedRemoteRef) ?? ''
  const effectiveLocalBranch = localBranch.trim() || derivedLocalBranch
  const localBranchExists = !!effectiveLocalBranch && allBranches.some((item) => item.name === effectiveLocalBranch)
  const invalidLocalBranch = !!effectiveLocalBranch && !validateBranchName(effectiveLocalBranch).ok
  const validationError = invalidLocalBranch
    ? t('action.track-remote-branch-invalid')
    : localBranchExists
      ? t('action.track-remote-branch-exists')
      : ''
  const canSubmit =
    !!selectedRemoteRef && !!effectiveLocalBranch && !validationError && !branchActionBusy && !isPending

  async function handleConfirm() {
    if (!canSubmit) return
    setError(null)
    await run('trackRemoteBranch', async () => {
      try {
        await onTrack(effectiveLocalBranch, selectedRemoteRef)
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isPending) onClose()
      }}
      title={t('action.track-remote-branch-title')}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleConfirm()
        }}
        className="space-y-4"
      >
        <Field>
          <FieldLabel htmlFor="track-remote-ref">{t('action.track-remote-branch-label')}</FieldLabel>
          <Select
            value={selectedRemoteRef}
            onValueChange={(next) => {
              setRemoteRef(next)
              setLocalBranch('')
            }}
            disabled={remoteBranches.length === 0 || remoteBranchesLoading}
          >
            <SelectTrigger id="track-remote-ref" className="w-full">
              <SelectValue placeholder={t('action.track-remote-branch-placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {remoteBranches.map((ref) => (
                <SelectItem key={ref} value={ref} textValue={ref}>
                  <span className="truncate">{ref}</span>
                </SelectItem>
              ))}
              {remoteBranches.length === 0 && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  {remoteBranchesLoading
                    ? t('action.track-remote-branch-loading')
                    : t('action.track-remote-branch-empty')}
                </div>
              )}
            </SelectContent>
          </Select>
        </Field>
        <Field data-invalid={validationError ? true : undefined}>
          <FieldLabel htmlFor="track-remote-local-branch">{t('action.track-remote-branch-local-label')}</FieldLabel>
          <Input
            id="track-remote-local-branch"
            value={localBranch}
            onChange={(event) => setLocalBranch(event.target.value)}
            placeholder={derivedLocalBranch || t('action.track-remote-branch-local-placeholder')}
            aria-invalid={!!validationError}
            aria-describedby={validationError ? 'track-remote-local-branch-error' : undefined}
          />
          <FieldError id="track-remote-local-branch-error" reserveHeight aria-live="polite" aria-atomic="true">
            {validationError}
          </FieldError>
        </Field>
        {error && <DialogError>{error}</DialogError>}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('action.track-remote-branch-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}
```

Add imports:

```ts
import { getRepositoryRemoteBranches } from '#/web/repo-client.ts'
import { deriveLocalBranchFromRemoteRef } from '#/shared/worktree-create.ts'
```

- [ ] **Step 6: Wire dialogs and menu items in `useBranchWriteActions`**

In `src/web/hooks/useBranchWriteActions.tsx`, update imports:

```ts
import { GitBranch, GitBranchPlus, GitMerge, RadioTower, RotateCcw, SendHorizontal } from 'lucide-react'
```

Add dialog imports:

```ts
  CreateBranchDialog,
  TrackRemoteBranchDialog,
```

Add store action:

```ts
  const runBranchAction = useReposStore((s) => s.runBranchAction)
```

Add state:

```ts
  const createBranchDialog = useRetainedDialogState<string>()
  const trackRemoteBranchDialog = useRetainedDialogState<string>()
  const branchActionBusy = repo.operations.branchAction.phase !== 'idle'
```

Add handlers:

```ts
  async function handleCreateBranch(newBranch: string, baseBranch: string) {
    const result = await runBranchAction(repo.id, { kind: 'createBranch', branch: newBranch, baseBranch }, {
      token: repo.instanceToken,
    })
    if (!result) return
    if (!result.ok) throw new Error(result.message)
    createBranchDialog.close()
  }

  async function handleTrackRemoteBranch(localBranch: string, remoteRef: string) {
    const result = await runBranchAction(repo.id, { kind: 'trackRemoteBranch', localBranch, remoteRef }, {
      token: repo.instanceToken,
    })
    if (!result) return
    if (!result.ok) throw new Error(result.message)
    trackRemoteBranchDialog.close()
  }
```

Add two menu items before `checkoutTo`:

```ts
    {
      id: 'createBranch',
      label: t('action.create-branch'),
      title: t('action.create-branch-title'),
      disabled: branchActionBusy,
      visible: true,
      icon: createElement(GitBranchPlus),
      onSelect: () => createBranchDialog.openWith(branch.name),
    },
    {
      id: 'trackRemoteBranch',
      label: t('action.track-remote-branch'),
      title: t('action.track-remote-branch-title'),
      disabled: branchActionBusy,
      visible: repo.remote.hasRemotes === true,
      icon: createElement(RadioTower),
      onSelect: () => trackRemoteBranchDialog.openWith(''),
    },
```

Also set existing worktree write items to `disabled: branchActionBusy` instead of `disabled: false`.

Add dialogs before `CheckoutToDialog`:

```tsx
      <CreateBranchDialog
        open={createBranchDialog.open}
        branch={branch}
        allBranches={allBranches}
        branchActionBusy={branchActionBusy}
        onClose={createBranchDialog.close}
        onCreate={handleCreateBranch}
      />
      <TrackRemoteBranchDialog
        open={trackRemoteBranchDialog.open}
        repoId={repo.id}
        allBranches={allBranches}
        branchActionBusy={branchActionBusy}
        onClose={trackRemoteBranchDialog.close}
        onTrack={handleTrackRemoteBranch}
      />
```

- [ ] **Step 7: Update hook item test**

In `src/web/hooks/useBranchActionItems.test.tsx`, add a test:

```tsx
  test('includes branch creation write actions', async () => {
    const branch = createRepoBranch('feature/base')
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [branch],
      remote: { hasRemotes: true },
    })

    let itemIds: string[] = []
    root = createRoot(container)
    const { useBranchActionItems: useItems } = await import('#/web/hooks/useBranchActionItems.ts')
    await act(async () => {
      root!.render(<ItemsHarness useItems={useItems} repo={repo} branch={branch} onReady={(ids) => (itemIds = ids)} />)
    })

    expect(itemIds).toContain('createBranch')
    expect(itemIds).toContain('trackRemoteBranch')
  })
```

Ensure `REPO_ID` exists at file scope:

```ts
const REPO_ID = '/tmp/gbl-branch-action-items-test-repo'
```

If the file already has a repo id constant by the time you edit, reuse it.

- [ ] **Step 8: Run dialog and hook tests**

Run:

```bash
bun run test -- src/web/components/branch-list/BranchWriteDialogs.test.tsx src/web/hooks/useBranchActionItems.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Checkpoint**

Run:

```bash
bun run test -- src/web/components/branch-list/checkout-candidates.test.ts src/web/components/branch-list/BranchWriteDialogs.test.tsx src/web/hooks/useBranchActionItems.test.tsx
```

Expected: PASS.

## Task 7: I18n Dictionaries

**Files:**
- Modify: `src/shared/i18n/en.ts`
- Modify: `src/shared/i18n/zh.ts`
- Modify: `src/shared/i18n/ko.ts`
- Modify: `src/shared/i18n/ja.ts`
- Modify: `src/shared/i18n/dictionaries.test.ts` only if key alignment tests need one focused expectation.

- [ ] **Step 1: Add English copy**

In `src/shared/i18n/en.ts`, add these keys near the repo action keys:

```ts
  'action.create-branch': 'New branch',
  'action.create-branch-title': 'Create branch',
  'action.create-branch-base-label': 'Base branch',
  'action.create-branch-name-label': 'New branch name',
  'action.create-branch-placeholder': 'feat/feature-name',
  'action.create-branch-invalid': 'Use a valid git branch name.',
  'action.create-branch-exists': 'A branch with this name already exists.',
  'action.create-branch-confirm': 'Create branch',
  'action.create-branch-creating-title': 'Creating branch...',
  'action.create-branch-queued-title': 'Waiting to create branch...',
  'action.create-branch-created-title': 'Created branch',
  'action.track-remote-branch': 'Track remote branch',
  'action.track-remote-branch-title': 'Track remote branch',
  'action.track-remote-branch-label': 'Remote branch',
  'action.track-remote-branch-placeholder': 'Pick a remote branch',
  'action.track-remote-branch-loading': 'Loading remote branches...',
  'action.track-remote-branch-empty': 'No remote branches found.',
  'action.track-remote-branch-local-label': 'Local branch name',
  'action.track-remote-branch-local-placeholder': 'feature/name',
  'action.track-remote-branch-invalid': 'Use a valid git branch name.',
  'action.track-remote-branch-exists': 'A branch with this name already exists.',
  'action.track-remote-branch-confirm': 'Track branch',
  'action.track-remote-branch-creating-title': 'Tracking remote branch...',
  'action.track-remote-branch-queued-title': 'Waiting to track remote branch...',
  'action.track-remote-branch-created-title': 'Tracked remote branch',
  'action.checkout-to-empty': 'No available branches.',
```

Use three dots instead of a Unicode ellipsis to keep this edit ASCII.

- [ ] **Step 2: Add Chinese copy**

In `src/shared/i18n/zh.ts`, add:

```ts
  'action.create-branch': '新建分支',
  'action.create-branch-title': '新建分支',
  'action.create-branch-base-label': '基础分支',
  'action.create-branch-name-label': '新分支名',
  'action.create-branch-placeholder': 'feat/feature-name',
  'action.create-branch-invalid': '请输入有效的 Git 分支名。',
  'action.create-branch-exists': '同名分支已存在。',
  'action.create-branch-confirm': '新建分支',
  'action.create-branch-creating-title': '正在新建分支...',
  'action.create-branch-queued-title': '等待新建分支...',
  'action.create-branch-created-title': '已新建分支',
  'action.track-remote-branch': '拉取远程分支到本地',
  'action.track-remote-branch-title': '拉取远程分支到本地',
  'action.track-remote-branch-label': '远程分支',
  'action.track-remote-branch-placeholder': '选择远程分支',
  'action.track-remote-branch-loading': '正在加载远程分支...',
  'action.track-remote-branch-empty': '没有找到远程分支。',
  'action.track-remote-branch-local-label': '本地分支名',
  'action.track-remote-branch-local-placeholder': 'feature/name',
  'action.track-remote-branch-invalid': '请输入有效的 Git 分支名。',
  'action.track-remote-branch-exists': '同名本地分支已存在。',
  'action.track-remote-branch-confirm': '拉取到本地',
  'action.track-remote-branch-creating-title': '正在拉取远程分支到本地...',
  'action.track-remote-branch-queued-title': '等待拉取远程分支到本地...',
  'action.track-remote-branch-created-title': '已拉取远程分支到本地',
  'action.checkout-to-empty': '没有可切换的分支。',
```

- [ ] **Step 3: Add Korean and Japanese copy**

In `src/shared/i18n/ko.ts`, add:

```ts
  'action.create-branch': '새 브랜치',
  'action.create-branch-title': '브랜치 만들기',
  'action.create-branch-base-label': '기준 브랜치',
  'action.create-branch-name-label': '새 브랜치 이름',
  'action.create-branch-placeholder': 'feat/feature-name',
  'action.create-branch-invalid': '올바른 Git 브랜치 이름을 입력하세요.',
  'action.create-branch-exists': '같은 이름의 브랜치가 이미 있습니다.',
  'action.create-branch-confirm': '브랜치 만들기',
  'action.create-branch-creating-title': '브랜치를 만드는 중...',
  'action.create-branch-queued-title': '브랜치 만들기 대기 중...',
  'action.create-branch-created-title': '브랜치를 만들었습니다',
  'action.track-remote-branch': '원격 브랜치 가져오기',
  'action.track-remote-branch-title': '원격 브랜치 가져오기',
  'action.track-remote-branch-label': '원격 브랜치',
  'action.track-remote-branch-placeholder': '원격 브랜치 선택',
  'action.track-remote-branch-loading': '원격 브랜치를 불러오는 중...',
  'action.track-remote-branch-empty': '원격 브랜치를 찾을 수 없습니다.',
  'action.track-remote-branch-local-label': '로컬 브랜치 이름',
  'action.track-remote-branch-local-placeholder': 'feature/name',
  'action.track-remote-branch-invalid': '올바른 Git 브랜치 이름을 입력하세요.',
  'action.track-remote-branch-exists': '같은 이름의 로컬 브랜치가 이미 있습니다.',
  'action.track-remote-branch-confirm': '가져오기',
  'action.track-remote-branch-creating-title': '원격 브랜치를 가져오는 중...',
  'action.track-remote-branch-queued-title': '원격 브랜치 가져오기 대기 중...',
  'action.track-remote-branch-created-title': '원격 브랜치를 가져왔습니다',
  'action.checkout-to-empty': '전환할 수 있는 브랜치가 없습니다.',
```

In `src/shared/i18n/ja.ts`, add:

```ts
  'action.create-branch': '新しいブランチ',
  'action.create-branch-title': 'ブランチを作成',
  'action.create-branch-base-label': '元のブランチ',
  'action.create-branch-name-label': '新しいブランチ名',
  'action.create-branch-placeholder': 'feat/feature-name',
  'action.create-branch-invalid': '有効な Git ブランチ名を入力してください。',
  'action.create-branch-exists': '同じ名前のブランチがすでに存在します。',
  'action.create-branch-confirm': 'ブランチを作成',
  'action.create-branch-creating-title': 'ブランチを作成中...',
  'action.create-branch-queued-title': 'ブランチ作成待機中...',
  'action.create-branch-created-title': 'ブランチを作成しました',
  'action.track-remote-branch': 'リモートブランチを取り込む',
  'action.track-remote-branch-title': 'リモートブランチを取り込む',
  'action.track-remote-branch-label': 'リモートブランチ',
  'action.track-remote-branch-placeholder': 'リモートブランチを選択',
  'action.track-remote-branch-loading': 'リモートブランチを読み込み中...',
  'action.track-remote-branch-empty': 'リモートブランチが見つかりません。',
  'action.track-remote-branch-local-label': 'ローカルブランチ名',
  'action.track-remote-branch-local-placeholder': 'feature/name',
  'action.track-remote-branch-invalid': '有効な Git ブランチ名を入力してください。',
  'action.track-remote-branch-exists': '同じ名前のローカルブランチがすでに存在します。',
  'action.track-remote-branch-confirm': '取り込む',
  'action.track-remote-branch-creating-title': 'リモートブランチを取り込み中...',
  'action.track-remote-branch-queued-title': 'リモートブランチ取り込み待機中...',
  'action.track-remote-branch-created-title': 'リモートブランチを取り込みました',
  'action.checkout-to-empty': '切り替え可能なブランチがありません。',
```

- [ ] **Step 4: Run dictionary tests**

Run:

```bash
bun run test -- src/shared/i18n/dictionaries.test.ts
```

Expected: PASS. If a key is missing in one dictionary, add the same key to that dictionary with matching placeholders.

- [ ] **Step 5: Checkpoint**

Run:

```bash
bun run test -- src/shared/i18n/dictionaries.test.ts src/web/stores/repos/branch-actions.test.ts
```

Expected: PASS.

## Task 8: Integration Polish And Full Targeted Test Pass

**Files:**
- Modify only files touched by prior tasks.

- [ ] **Step 1: Run all focused tests introduced or touched by this plan**

Run:

```bash
bun run test -- \
  src/shared/worktree-create.test.ts \
  src/shared/branch-create.test.ts \
  src/web/components/branch-list/checkout-candidates.test.ts \
  src/system/git/branches.test.ts \
  src/system/ssh/commands.test.ts \
  src/system/ssh/git.test.ts \
  src/server/modules/repo.test.ts \
  src/web/repo-client.test.ts \
  src/web/stores/repos/branch-actions.test.ts \
  src/web/components/branch-list/BranchWriteDialogs.test.tsx \
  src/web/hooks/useBranchActionItems.test.tsx \
  src/shared/i18n/dictionaries.test.ts
```

Expected: PASS.

- [ ] **Step 2: Fix TypeScript exhaustiveness errors from new action kinds**

If the focused test run reports TypeScript or runtime exhaustiveness failures, check these exact files first:

```text
src/web/stores/repos/action-labels.ts
src/web/stores/repos/branch-actions.ts
src/web/hooks/branch-action-state.ts
src/server/modules/repo-backend.ts
src/system/ssh/commands.ts
```

Every `switch` over `RepoBranchActionKind`, `RepoBranchAction`, `RepoEventAction`, or `RemoteCommandKind` must contain explicit cases for:

```ts
'createBranch'
'trackRemoteBranch'
'gitBranchCreate'
'gitBranchTrackRemote'
```

- [ ] **Step 3: Run architecture check**

Run:

```bash
bun run check:architecture
```

Expected: PASS. If it fails, remove any import that crosses these boundaries:

```text
src/main/** must not import src/web/** or src/server/**
src/web/** must not import src/main/**
src/server/** and src/shared/** must not import electron
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 6: Manual verification**

Open the app and verify these flows:

```text
1. On a branch row, choose New branch.
2. Enter feature/local-created.
3. Confirm the branch appears after refresh.
4. Confirm current checkout and selected worktree do not change.
5. On a branch row, choose Track remote branch.
6. Pick origin/feature/remote when available.
7. Confirm local feature/remote appears after refresh and current checkout does not change.
8. Open Switch Branch on a worktree row.
9. Confirm the current worktree branch is absent.
10. Confirm every branch already linked to a worktree is absent.
11. Confirm a local branch without a worktree remains available.
```

- [ ] **Step 7: Final working tree review**

Run:

```bash
git status --short
git diff --stat
```

Expected: changed files match this plan. There should be no generated artifacts, dependency lockfile changes, or unrelated formatting churn.

## Self-Review

Spec coverage:

- Separate `Create Branch` menu item: Task 6.
- Separate `Track Remote Branch` menu item: Task 6.
- Local branch creation from selected row branch: Tasks 4, 5, 6.
- Remote-tracking branch creation without checkout: Tasks 3, 4, 5, 6.
- Checkout candidate filtering: Tasks 1 and 6.
- Local and SSH-backed remote support: Tasks 2, 3, 4.
- Focused validation and tests: all tasks include targeted tests.
- No push, delete, reset, checkout after create, or worktree create: covered by route/action choices and manual verification.

Placeholder scan:

- No `TBD`, `TODO`, empty steps, or unnamed files.
- Test commands and expected outcomes are explicit.
- The plan avoids git commit steps to comply with AGENTS.md.

Type consistency:

- Shared input kind is `trackRemote`.
- Store action kind is `trackRemoteBranch`.
- Route path is `/api/repo/track-remote-branch`.
- Client function is `trackRepositoryRemoteBranch`.
- Remote command kind is `gitBranchTrackRemote`.
