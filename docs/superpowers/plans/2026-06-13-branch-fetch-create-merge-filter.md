# Branch Fetch, Create, And Merge Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit fetch-only branch action, add branch-only creation, and filter checkout/merge candidate lists to branches that are not already checked out in a worktree.

**Architecture:** Reuse the existing repository backend and branch action scheduler. Fetch-only is a new repository-scoped branch action that calls the existing `/api/repo/fetch` route and never merges. Branch creation is added through `RepoBackend` so local and SSH-backed repositories share the same renderer/store/server path. Candidate filtering is a pure renderer helper used by both checkout-to and merge dialogs.

**Tech Stack:** TypeScript strip-only mode, Vitest, Hono routes, Zustand store, React dialogs, lucide-react icons, existing `RepoBackend` and SSH command helpers.

**Git Safety:** Do not run or plan `git commit`, `git push`, branch checkout, reset, or destructive git commands for this work unless the user explicitly requests it.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/web/components/branch-list/branch-write-candidates.ts` | Pure checkout/merge candidate filtering |
| Create | `src/web/components/branch-list/branch-write-candidates.test.ts` | Candidate filtering tests |
| Modify | `src/web/components/branch-list/BranchWriteDialogs.tsx` | Use candidate helper; add create branch dialog |
| Modify | `src/web/hooks/useBranchWriteActions.tsx` | Add create branch menu item and dialog wiring |
| Modify | `src/web/hooks/useBranchActions.tsx` | Add fetch remote capability and action |
| Modify | `src/web/hooks/useBranchActionItems.ts` | Add fetch remote menu item |
| Modify | `src/web/hooks/branch-action-state.ts` | Add item ids and busy mapping |
| Modify | `src/web/stores/repos/branch-action-types.ts` | Add `fetchRemote` and `createBranch` action types |
| Modify | `src/web/stores/repos/operations.ts` | Add branch action reasons |
| Modify | `src/web/stores/repos/branch-action-scheduler.ts` | Treat fetch remote as network action |
| Modify | `src/web/stores/repos/branch-action-scheduler.test.ts` | Scheduler coverage for new action kinds |
| Modify | `src/web/stores/repos/action-labels.ts` | Toast/activity labels for new action kinds |
| Modify | `src/web/stores/repos/branch-actions.ts` | Dispatch fetch/create actions through existing lanes |
| Modify | `src/web/stores/repos/branch-actions.test.ts` | Store scheduling, RPC, refresh, and event coverage |
| Modify | `src/web/stores/repos/types.ts` | Add result event actions |
| Modify | `src/system/git/branches.ts` | Add local branch creation helper |
| Create | `src/system/git/branches-write.test.ts` | Local branch creation command tests |
| Modify | `src/system/ssh/commands.ts` | Add remote branch creation command |
| Modify | `src/system/ssh/commands.test.ts` | Remote command rendering coverage |
| Modify | `src/system/ssh/git.ts` | Add remote branch creation helper |
| Modify | `src/system/ssh/git.test.ts` | Remote branch creation helper tests |
| Modify | `src/server/modules/repo-backend.ts` | Add backend `createBranch` method for local and remote |
| Modify | `src/server/modules/repo-write-paths.ts` | Add `createRepositoryBranch` write path |
| Modify | `src/server/routes/repo.ts` | Add `/api/repo/create-branch` route |
| Modify | `src/server/modules/repo.test.ts` | Backend/write-path tests |
| Modify | `src/web/repo-client.ts` | Add `createRepositoryBranch` client |
| Modify | `src/web/repo-client.test.ts` | Client route body test |
| Modify | `src/web/stores/repos/test-utils.ts` | Add fake `/api/repo/create-branch` route mapping |
| Modify | `src/shared/i18n/en.ts` | English labels/errors |
| Modify | `src/shared/i18n/zh.ts` | Chinese labels/errors |
| Modify | `src/shared/i18n/ko.ts` | Korean labels/errors |
| Modify | `src/shared/i18n/ja.ts` | Japanese labels/errors |
| Modify | `src/shared/i18n/dictionaries.test.ts` | Existing key parity test should stay green |
| Modify | `src/web/hooks/useBranchActionItems.test.tsx` | Menu item grouping coverage |

## Task 1: Candidate Filtering Helper

**Files:**
- Create: `src/web/components/branch-list/branch-write-candidates.test.ts`
- Create: `src/web/components/branch-list/branch-write-candidates.ts`
- Modify: `src/web/components/branch-list/BranchWriteDialogs.tsx`

- [ ] **Step 1: Write the failing helper tests**

Create `src/web/components/branch-list/branch-write-candidates.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { branchWriteCandidates } from '#/web/components/branch-list/branch-write-candidates.ts'
import { createRepoBranch } from '#/web/stores/repos/test-utils.ts'

describe('branchWriteCandidates', () => {
  test('excludes the current branch', () => {
    const branches = [
      createRepoBranch('main'),
      createRepoBranch('feature/a'),
      createRepoBranch('feature/b'),
    ]

    expect(branchWriteCandidates('feature/a', branches).map((branch) => branch.name)).toEqual(['main', 'feature/b'])
  })

  test('excludes branches already checked out in any worktree', () => {
    const branches = [
      createRepoBranch('main', { worktree: { path: '/repo' } }),
      createRepoBranch('feature/a'),
      createRepoBranch('feature/b', { worktree: { path: '/repo-b' } }),
      createRepoBranch('feature/c'),
    ]

    expect(branchWriteCandidates('feature/a', branches).map((branch) => branch.name)).toEqual(['feature/c'])
  })

  test('preserves eligible branch order and returns a new array', () => {
    const branches = [
      createRepoBranch('feature/c'),
      createRepoBranch('feature/a'),
      createRepoBranch('feature/b'),
    ]

    const result = branchWriteCandidates('main', branches)

    expect(result.map((branch) => branch.name)).toEqual(['feature/c', 'feature/a', 'feature/b'])
    expect(result).not.toBe(branches)
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
bun run test src/web/components/branch-list/branch-write-candidates.test.ts
```

Expected: fail with a missing module error for `branch-write-candidates.ts`.

- [ ] **Step 3: Implement the helper**

Create `src/web/components/branch-list/branch-write-candidates.ts`:

```ts
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

export function branchWriteCandidates(
  currentBranch: string,
  branches: RepoBranchState[],
): RepoBranchState[] {
  return branches.filter((branch) => branch.name !== currentBranch && !branch.worktree?.path)
}
```

- [ ] **Step 4: Wire the helper into checkout and merge dialogs**

In `src/web/components/branch-list/BranchWriteDialogs.tsx`, add the import:

```ts
import { branchWriteCandidates } from '#/web/components/branch-list/branch-write-candidates.ts'
```

Replace both local candidate expressions:

```ts
const candidates = allBranches.filter((b) => b.name !== branch.name)
```

with:

```ts
const candidates = branchWriteCandidates(branch.name, allBranches)
```

- [ ] **Step 5: Verify the helper tests pass**

Run:

```bash
bun run test src/web/components/branch-list/branch-write-candidates.test.ts
```

Expected: all tests pass.

## Task 2: Local Branch Creation Helper

**Files:**
- Create: `src/system/git/branches-write.test.ts`
- Modify: `src/system/git/branches.ts`

- [ ] **Step 1: Write failing local git tests**

Create `src/system/git/branches-write.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createBranch } from '#/system/git/branches.ts'

const gitResultWithOptionsMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/helper.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/helper.ts')>('#/system/git/helper.ts')
  return {
    ...actual,
    gitResultWithOptions: vi.fn((cwd: string, opts: unknown, ...args: string[]) =>
      gitResultWithOptionsMock(cwd, opts, ...args),
    ),
  }
})

describe('createBranch', () => {
  beforeEach(() => {
    gitResultWithOptionsMock.mockReset()
    gitResultWithOptionsMock.mockResolvedValue({ ok: true, message: 'ok' })
  })

  test('calls git branch with a new branch and base branch', async () => {
    const signal = new AbortController().signal

    const result = await createBranch('/repo', 'feature/new', 'main', signal)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/repo',
      { signal },
      'branch',
      '--',
      'feature/new',
      'main',
    )
  })

  test('rejects invalid new branch names before calling git', async () => {
    const result = await createBranch('/repo', '-bad', 'main')

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(gitResultWithOptionsMock).not.toHaveBeenCalled()
  })

  test('rejects invalid base branch names before calling git', async () => {
    const result = await createBranch('/repo', 'feature/new', '../bad')

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(gitResultWithOptionsMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
bun run test src/system/git/branches-write.test.ts
```

Expected: fail because `createBranch` is not exported.

- [ ] **Step 3: Implement local branch creation**

In `src/system/git/branches.ts`, add this export near `checkoutBranch`:

```ts
export async function createBranch(
  cwd: string,
  branch: string,
  baseBranch: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isSafeBranchName(branch) || !isSafeBranchName(baseBranch)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  return gitResultWithOptions(cwd, { signal }, 'branch', '--', branch, baseBranch)
}
```

- [ ] **Step 4: Verify local branch helper tests pass**

Run:

```bash
bun run test src/system/git/branches-write.test.ts
```

Expected: all tests pass.

## Task 3: Remote Branch Creation Helper

**Files:**
- Modify: `src/system/ssh/commands.ts`
- Modify: `src/system/ssh/commands.test.ts`
- Modify: `src/system/ssh/git.ts`
- Modify: `src/system/ssh/git.test.ts`

- [ ] **Step 1: Add failing remote command rendering test**

In `src/system/ssh/commands.test.ts`, append:

```ts
  test('renders branch create command with quoted branch names', () => {
    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitBranchCreate',
        path: '/srv/repo',
        branch: 'feature/new',
        baseBranch: 'release/1.0',
      }).script,
    ).toContain("git -C '/srv/repo' branch -- 'feature/new' 'release/1.0'")
  })
```

- [ ] **Step 2: Run the failing remote command test**

Run:

```bash
bun run test src/system/ssh/commands.test.ts
```

Expected: TypeScript/runtime failure because `gitBranchCreate` is not in `RemoteCommandKind`.

- [ ] **Step 3: Add the remote command kind and script**

In `src/system/ssh/commands.ts`, add this union member:

```ts
  | { type: 'gitBranchCreate'; path: string; branch: string; baseBranch: string }
```

Add this `scriptForCommand` case near `gitBranchDelete`:

```ts
    case 'gitBranchCreate':
      return `git -C ${shellQuote(command.path)} branch -- ${shellQuote(command.branch)} ${shellQuote(
        command.baseBranch,
      )}`
```

- [ ] **Step 4: Verify remote command rendering**

Run:

```bash
bun run test src/system/ssh/commands.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Add failing remote git helper tests**

In `src/system/ssh/git.test.ts`, update the import list:

```ts
  createRemoteBranch,
```

Append these tests inside `describe('remote git helpers', () => { ... })`:

```ts
  test('createRemoteBranch runs branch creation on the remote repository', async () => {
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

  test('createRemoteBranch rejects invalid refs before running remote commands', async () => {
    const run = vi.fn()

    const result = await createRemoteBranch(TARGET, {
      branch: '-bad',
      baseBranch: 'main',
      run: run as any,
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(run).not.toHaveBeenCalled()
  })
```

- [ ] **Step 6: Run the failing remote git helper tests**

Run:

```bash
bun run test src/system/ssh/git.test.ts
```

Expected: fail because `createRemoteBranch` is not exported.

- [ ] **Step 7: Implement the remote git helper**

In `src/system/ssh/git.ts`, add this export near `checkoutRemoteBranch`:

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
```

- [ ] **Step 8: Verify remote helper tests pass**

Run:

```bash
bun run test src/system/ssh/commands.test.ts src/system/ssh/git.test.ts
```

Expected: all tests pass.

## Task 4: Backend, Route, And Client Create Branch Path

**Files:**
- Modify: `src/server/modules/repo-backend.ts`
- Modify: `src/server/modules/repo-write-paths.ts`
- Modify: `src/server/routes/repo.ts`
- Modify: `src/server/modules/repo.test.ts`
- Modify: `src/web/repo-client.ts`
- Modify: `src/web/repo-client.test.ts`
- Modify: `src/web/stores/repos/test-utils.ts`

- [ ] **Step 1: Add failing backend/write-path tests**

In `src/server/modules/repo.test.ts`, extend the hoisted mocks:

```ts
  createBranch: vi.fn(),
```

Update the `#/system/git/branches.ts` mock:

```ts
  createBranch: mocks.createBranch,
```

Update `beforeEach`:

```ts
  mocks.createBranch.mockResolvedValue({ ok: true, message: 'ok' })
```

Append this test inside `describe('repo mutation invalidation publishing', () => { ... })`:

```ts
  test('createRepositoryBranch delegates to local git and publishes source-token invalidation', async () => {
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

  test('createRepositoryBranch does not publish invalidation after failure', async () => {
    mocks.createBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: branch exists' })
    const { createRepositoryBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepositoryBranch('/tmp/repo', 'feature/new', 'main')

    expect(result).toEqual({ ok: false, message: 'fatal: branch exists' })
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the failing backend test**

Run:

```bash
bun run test src/server/modules/repo.test.ts --testNamePattern=createRepositoryBranch
```

Expected: fail because `createRepositoryBranch` is not exported.

- [ ] **Step 3: Add `createBranch` to `RepoBackend`**

In `src/server/modules/repo-backend.ts`, import local and remote helpers:

```ts
  createBranch,
```

from `#/system/git/branches.ts`, and:

```ts
  createRemoteBranch,
```

from `#/system/ssh/git.ts`.

Add this method to `RepoBackend`:

```ts
  createBranch(branch: string, baseBranch: string, signal?: AbortSignal): Promise<ExecResult>
```

Add the local implementation:

```ts
    async createBranch(branch, baseBranch, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      return await createBranch(repoId, branch, baseBranch, signal)
    },
```

Add the remote implementation:

```ts
    async createBranch(branch, baseBranch, signal) {
      return await createRemoteBranch(target, { branch, baseBranch, signal })
    },
```

- [ ] **Step 4: Add the server write path**

In `src/server/modules/repo-write-paths.ts`, add:

```ts
export async function createRepositoryBranch(
  cwd: string,
  branch: string,
  baseBranch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await runWithRepoBackend(cwd, async (backend) => {
    return await publishSnapshotInvalidationAfterMutation(
      cwd,
      await backend.createBranch(branch, baseBranch, signal),
      sourceToken,
    )
  })
}
```

- [ ] **Step 5: Add the route**

In `src/server/routes/repo.ts`, import `createRepositoryBranch` from `repo-write-paths.ts`.

Add this route near `/create-worktree`:

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
```

- [ ] **Step 6: Add the client function and test utility route**

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
```

In `src/web/stores/repos/test-utils.ts`, add this fake fetch route:

```ts
        if (url.pathname === '/api/repo/create-branch') return call('repo.createBranch', body)
```

Place it next to `/api/repo/create-worktree`.

- [ ] **Step 7: Add a client route body test**

In `src/web/repo-client.test.ts`, append:

```ts
  test('creates repository branches through the embedded server', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'ok' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { createRepositoryBranch } = await import('#/web/repo-client.ts')
    const result = await createRepositoryBranch('/repo', 'feature/new', 'main', undefined, 'source_1')

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/create-branch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
        body: JSON.stringify({ cwd: '/repo', branch: 'feature/new', baseBranch: 'main', sourceToken: 'source_1' }),
      }),
    )
  })
```

- [ ] **Step 8: Verify backend and client tests pass**

Run:

```bash
bun run test src/server/modules/repo.test.ts src/web/repo-client.test.ts
```

Expected: all tests pass.

## Task 5: Store Actions For Fetch Remote And Create Branch

**Files:**
- Modify: `src/web/stores/repos/branch-action-types.ts`
- Modify: `src/web/stores/repos/operations.ts`
- Modify: `src/web/stores/repos/branch-action-scheduler.ts`
- Modify: `src/web/stores/repos/branch-action-scheduler.test.ts`
- Modify: `src/web/stores/repos/action-labels.ts`
- Modify: `src/web/stores/repos/types.ts`
- Modify: `src/web/stores/repos/branch-actions.ts`
- Modify: `src/web/stores/repos/branch-actions.test.ts`
- Modify: `src/web/hooks/branch-action-state.ts`

- [ ] **Step 1: Add failing scheduler coverage**

In `src/web/stores/repos/branch-action-scheduler.test.ts`, update:

```ts
const ACTIONS: RepoBranchActionKind[] = [
  'checkout',
  'fetchRemote',
  'pull',
  'push',
  'createBranch',
  'createWorktree',
  'deleteBranch',
  'removeWorktree',
]
```

Update the network test expectation:

```ts
    expect(ACTIONS.filter(isNetworkBranchActionKind)).toEqual(['fetchRemote', 'pull', 'push'])
```

- [ ] **Step 2: Run the failing scheduler tests**

Run:

```bash
bun run test src/web/stores/repos/branch-action-scheduler.test.ts
```

Expected: TypeScript failure because `fetchRemote` and `createBranch` are not valid action kinds.

- [ ] **Step 3: Add action and operation types**

In `src/web/stores/repos/branch-action-types.ts`, update `RepoBranchAction`:

```ts
export type RepoBranchAction =
  | { kind: 'checkout'; branch: string }
  | { kind: 'fetchRemote' }
  | { kind: 'pull'; branch: string; worktreePath?: string }
  | { kind: 'push'; branch: string }
  | { kind: 'createBranch'; branch: string; baseBranch: string }
  | { kind: 'createWorktree'; input: CreateWorktreeInput }
  | { kind: 'deleteBranch'; branch: string; force?: boolean; alsoDeleteUpstream?: boolean }
  | {
      kind: 'removeWorktree'
      branch: string
      worktreePath: string
      alsoDeleteBranch: boolean
      forceDeleteBranch?: boolean
      alsoDeleteUpstream?: boolean
    }
```

In `src/web/stores/repos/operations.ts`, update `RepoBranchActionReason`:

```ts
export type RepoBranchActionReason =
  | 'branch:checkout'
  | 'branch:fetchRemote'
  | 'branch:pull'
  | 'branch:push'
  | 'branch:createBranch'
  | 'branch:createWorktree'
  | 'branch:deleteBranch'
  | 'branch:removeWorktree'
```

In `src/web/stores/repos/branch-action-scheduler.ts`, update:

```ts
export function isNetworkBranchActionKind(kind: RepoBranchActionKind): boolean {
  return kind === 'fetchRemote' || kind === 'pull' || kind === 'push'
}
```

In `src/web/stores/repos/types.ts`, update `RepoEventAction`:

```ts
export type RepoEventAction =
  | { kind: 'checkout'; branch: string }
  | { kind: 'fetchRemote' }
  | { kind: 'pull'; branch: string }
  | { kind: 'push'; branch: string }
  | { kind: 'createBranch'; branch: string; baseBranch: string }
  | { kind: 'createWorktree'; branch: string; worktreePath: string }
  | { kind: 'deleteBranch'; branch: string }
  | { kind: 'removeWorktree'; branch: string; worktreePath: string; alsoDeleteBranch: boolean }
```

In `src/web/stores/repos/action-labels.ts`, update the strict records:

```ts
const BRANCH_ACTION_LOADING_LABEL_KEYS: Record<RepoBranchActionKind, string> = {
  checkout: 'action.checkout-loading',
  fetchRemote: 'action.fetch-remote-loading',
  pull: 'action.pull-loading',
  push: 'action.push-loading',
  createBranch: 'action.create-branch-creating-title',
  createWorktree: 'action.create-worktree-creating-title',
  deleteBranch: 'action.delete-branch-deleting-title',
  removeWorktree: 'action.remove-worktree-removing-title',
}

const BRANCH_ACTION_QUEUED_LABEL_KEYS: Record<RepoBranchActionKind, string> = {
  checkout: 'action.checkout-queued',
  fetchRemote: 'action.fetch-remote-queued',
  pull: 'action.pull-queued',
  push: 'action.push-queued',
  createBranch: 'action.create-branch-queued-title',
  createWorktree: 'action.create-worktree-queued-title',
  deleteBranch: 'action.delete-branch-queued-title',
  removeWorktree: 'action.remove-worktree-queued-title',
}
```

Update `repoEventActionSuccessLabel`:

```ts
    case 'createBranch':
      return { labelKey: 'action.create-branch-created-title', labelParams: { branch: action.branch } }
    case 'fetchRemote':
      return null
```

- [ ] **Step 4: Update branch state busy mapping**

In `src/web/hooks/branch-action-state.ts`, add item ids:

```ts
  | 'fetchRemote'
  | 'createBranch'
```

Update `branchActionItemIdFromKind`:

```ts
    case 'fetchRemote':
      return 'fetchRemote'
    case 'createBranch':
      return 'createBranch'
```

Update `branchActionBusyItemId` so repo-scoped fetch shows busy in any branch menu:

```ts
export function branchActionBusyItemId(repo: Pick<BranchActionRepo, 'operations'>, branchName: string): BranchActionItemId | null {
  const action = repo.operations.branchAction
  if (action.phase === 'idle' || !isBranchActionReason(action.reason)) return null
  if (action.reason === 'branch:fetchRemote') return 'fetchRemote'
  if (action.target !== branchName) return null
  return branchActionItemIdFromKind(branchActionKindFromReason(action.reason))
}
```

Update `branchActionDisplayPhase` for the same repo-scoped action:

```ts
export function branchActionDisplayPhase(repo: Pick<BranchActionRepo, 'operations'>, branchName: string): 'queued' | 'running' | null {
  const action = repo.operations.branchAction
  if (action.phase === 'idle') return null
  if (action.reason === 'branch:fetchRemote') return action.phase
  if (action.target !== branchName) return null
  return action.phase
}
```

- [ ] **Step 5: Add branch action dispatch**

In `src/web/stores/repos/branch-actions.ts`, import `createRepositoryBranch` and `fetchRepository`:

```ts
  createRepositoryBranch,
  fetchRepository,
```

Update reason mapping:

```ts
const BRANCH_ACTION_REASON_BY_KIND: Record<RepoBranchActionKind, RepoBranchActionReason> = {
  checkout: 'branch:checkout',
  fetchRemote: 'branch:fetchRemote',
  pull: 'branch:pull',
  push: 'branch:push',
  createBranch: 'branch:createBranch',
  createWorktree: 'branch:createWorktree',
  deleteBranch: 'branch:deleteBranch',
  removeWorktree: 'branch:removeWorktree',
}
```

Update network action types:

```ts
type NetworkRepoBranchAction = Extract<RepoBranchAction, { kind: 'fetchRemote' | 'pull' | 'push' }>
type NetworkFetchReason = Extract<RepoOperationReason, 'user-fetch' | 'pull' | 'push'>
const NETWORK_FETCH_REASON_BY_KIND: Record<NetworkRepoBranchAction['kind'], NetworkFetchReason> = {
  fetchRemote: 'user-fetch',
  pull: 'pull',
  push: 'push',
}
```

Update `branchActionOperationTarget`:

```ts
    case 'fetchRemote':
      return null
    case 'createBranch':
      return action.branch
```

Update `branchActionEventAction`:

```ts
    case 'fetchRemote':
      return { kind: 'fetchRemote' }
    case 'createBranch':
      return { kind: 'createBranch', branch: action.branch, baseBranch: action.baseBranch }
```

Update `runBranchActionRpc`:

```ts
    case 'fetchRemote':
      return fetchRepository(repoId, 'user', signal, sourceToken)
    case 'createBranch':
      return createRepositoryBranch(repoId, action.branch, action.baseBranch, signal, sourceToken)
```

- [ ] **Step 6: Add failing store tests**

In `src/web/stores/repos/branch-actions.test.ts`, append inside `describe('runBranchAction', () => { ... })`:

```ts
  test('runs fetchRemote through the fetch route without a branch target', async () => {
    let fetchBody: unknown = null
    installGoblinTestBridge({
      'repo.fetch': async (body) => {
        fetchBody = body
        return { ok: true, message: 'fetched' }
      },
      'repo.snapshot': async () => ({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }),
      'repo.status': async () => [],
      'repo.pullRequests': async () => [],
    })

    const result = await useReposStore.getState().runBranchAction(REPO_ID, { kind: 'fetchRemote' })

    expect(result).toEqual({ ok: true, message: 'fetched' })
    expect(fetchBody).toMatchObject({ cwd: REPO_ID, kind: 'user' })
    expect(useReposStore.getState().repos[REPO_ID]?.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: true, message: 'fetched' },
      action: { kind: 'fetchRemote' },
    })
  })

  test('runs createBranch through the write lane and refreshes after success', async () => {
    let createBody: unknown = null
    let snapshotCalls = 0
    installGoblinTestBridge({
      'repo.createBranch': async (body) => {
        createBody = body
        return { ok: true, message: 'created' }
      },
      'repo.snapshot': async () => {
        snapshotCalls += 1
        return {
          branches: [createBranchSnapshot('feature/a'), createBranchSnapshot('feature/new')],
          current: 'feature/a',
        }
      },
      'repo.status': async () => [],
      'repo.pullRequests': async () => [],
    })

    const result = await useReposStore.getState().runBranchAction(REPO_ID, {
      kind: 'createBranch',
      branch: 'feature/new',
      baseBranch: 'feature/a',
    })

    expect(result).toEqual({ ok: true, message: 'created' })
    expect(createBody).toMatchObject({ cwd: REPO_ID, branch: 'feature/new', baseBranch: 'feature/a' })
    expect(snapshotCalls).toBeGreaterThan(0)
    expect(useReposStore.getState().repos[REPO_ID]?.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: true, message: 'created' },
      action: { kind: 'createBranch', branch: 'feature/new', baseBranch: 'feature/a' },
    })
  })
```

- [ ] **Step 7: Verify store tests pass**

Run:

```bash
bun run test src/web/stores/repos/branch-action-scheduler.test.ts src/web/stores/repos/branch-actions.test.ts
```

Expected: all tests pass.

## Task 6: UI Menu Items And Create Branch Dialog

**Files:**
- Modify: `src/web/hooks/useBranchActions.tsx`
- Modify: `src/web/hooks/useBranchActionItems.ts`
- Modify: `src/web/hooks/useBranchActionItems.test.tsx`
- Modify: `src/web/hooks/useBranchWriteActions.tsx`
- Modify: `src/web/components/branch-list/BranchWriteDialogs.tsx`

- [ ] **Step 1: Add capabilities and fetch action**

In `src/web/hooks/useBranchActions.tsx`, add `canFetchRemote` to `BranchActionCapabilities`:

```ts
  canFetchRemote: boolean
```

Return it from `getBranchActionCapabilities`:

```ts
    canFetchRemote: repo.remote.hasRemotes === true,
```

Add this action function:

```ts
  function fetchRemote() {
    void runRepoAction({ kind: 'fetchRemote' })
  }
```

Add it to the returned `actions` object:

```ts
      fetchRemote,
```

- [ ] **Step 2: Add fetch menu item**

In `src/web/hooks/useBranchActionItems.ts`, add `CloudDownload` to the lucide import:

```ts
import { ArrowDown, ArrowUp, CloudDownload, ClipboardCopy, ExternalLink, FolderPlus, GitBranch, GitPullRequest, RefreshCw, Trash2 } from 'lucide-react'
```

Add this item before `pull`:

```ts
    {
      id: 'fetchRemote',
      label: branchActionLabel('fetchRemote', 'action.fetch-remote', 'action.fetch-remote-loading', 'action.fetch-remote-queued'),
      title: t('action.fetch-remote-title'),
      disabled,
      busy: busy('fetchRemote'),
      visible: capabilities.canFetchRemote,
      icon: createElement(CloudDownload),
      onSelect: actions.fetchRemote,
    },
```

- [ ] **Step 3: Add create branch dialog component**

In `src/web/components/branch-list/BranchWriteDialogs.tsx`, add imports:

```ts
import { Input } from '#/web/components/ui/input.tsx'
import { validateBranchName } from '#/shared/refnames.ts'
```

Add this component after `MergeDialog`:

```tsx
interface CreateBranchDialogProps {
  open: boolean
  baseBranch: RepoBranchState
  allBranches: RepoBranchState[]
  onClose: () => void
  onCreate: (branch: string, baseBranch: string) => Promise<void>
}

export function CreateBranchDialog({
  open,
  baseBranch,
  allBranches,
  onClose,
  onCreate,
}: CreateBranchDialogProps) {
  const t = useT()
  const [branchName, setBranchName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isPending, run } = useAsyncPending<'createBranch'>()
  const trimmed = branchName.trim()
  const existingBranches = new Set(allBranches.map((branch) => branch.name))
  const validationError =
    trimmed.length === 0
      ? null
      : !validateBranchName(trimmed).ok
        ? t('action.create-branch-invalid')
        : existingBranches.has(trimmed)
          ? t('action.create-branch-exists')
          : null

  useEffect(() => {
    if (!open) {
      setBranchName('')
      setError(null)
    }
  }, [open])

  async function handleConfirm() {
    if (!trimmed || validationError) return
    setError(null)
    await run('createBranch', async () => {
      try {
        await onCreate(trimmed, baseBranch.name)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isPending) onClose()
      }}
      title={t('action.create-branch-title')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleConfirm()
        }}
        className="space-y-4"
      >
        <Field>
          <FieldLabel>{t('action.create-branch-base-label')}</FieldLabel>
          <div className="rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground">
            {baseBranch.name}
          </div>
        </Field>
        <Field>
          <FieldLabel htmlFor="create-branch-name">{t('action.create-branch-name-label')}</FieldLabel>
          <Input
            id="create-branch-name"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder={t('action.create-branch-name-placeholder')}
            disabled={isPending}
          />
        </Field>
        {validationError && <DialogError>{validationError}</DialogError>}
        {error && <DialogError>{error}</DialogError>}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!trimmed || !!validationError || isPending}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('action.create-branch-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}
```

- [ ] **Step 4: Wire create branch into branch write actions**

In `src/web/hooks/useBranchWriteActions.tsx`, update imports:

```ts
import { GitBranch, GitBranchPlus, GitMerge, RotateCcw, SendHorizontal } from 'lucide-react'
```

Import `CreateBranchDialog`:

```ts
  CreateBranchDialog,
```

Read `submitBranchAction`:

```ts
  const submitBranchAction = useReposStore((s) => s.submitBranchAction)
```

Add dialog state:

```ts
  const createBranchDialog = useRetainedDialogState<string>()
```

Add handler:

```ts
  async function handleCreateBranch(newBranch: string, baseBranch: string) {
    submitBranchAction(
      repo.id,
      { kind: 'createBranch', branch: newBranch, baseBranch },
      { token: repo.instanceToken, refreshOnError: false },
    )
    createBranchDialog.close()
  }
```

Add item before checkout-to:

```ts
    {
      id: 'createBranch',
      label: t('action.create-branch'),
      title: t('action.create-branch-title'),
      disabled: false,
      visible: true,
      icon: createElement(GitBranchPlus),
      onSelect: () => createBranchDialog.openWith(''),
    },
```

Render dialog:

```tsx
      <CreateBranchDialog
        open={createBranchDialog.open}
        baseBranch={branch}
        allBranches={allBranches}
        onClose={createBranchDialog.close}
        onCreate={handleCreateBranch}
      />
```

- [ ] **Step 5: Update menu grouping test**

In `src/web/hooks/useBranchActionItems.test.tsx`, add `canFetchRemote: true` to mocked capabilities in the test that expects remote actions.

Update the expected visible main item list:

```ts
    expect(groups.mainItems.filter((item) => item.visible).map((item) => item.id)).toEqual([
      'fetchRemote',
      'pull',
      'push',
      'createWorktree',
      'sync',
      'createBranch',
      'checkoutTo',
      'merge',
      'commit',
    ])
```

Add a focused test:

```ts
  test('hides fetch remote when the repository has no remotes', async () => {
    mocks.useBranchActions.mockReturnValue({
      blocked: false,
      busyAction: null,
      capabilities: {
        isCurrent: false,
        checkedOutInAnotherWorktree: false,
        canRemoveWorktree: false,
        isRegularBranch: true,
        canCopyPatch: false,
        canFetchRemote: false,
        canPull: false,
        canPush: false,
        canOpenRemote: false,
        canOpenTerminal: false,
        canOpenEditor: false,
      },
      actions: {
        copyPatch: vi.fn(),
        checkout: vi.fn(),
        fetchRemote: vi.fn(),
        pull: vi.fn(),
        push: vi.fn(),
        openTerminal: vi.fn(),
        openEditor: vi.fn(),
        openRemote: vi.fn(),
        requestDeleteBranch: vi.fn(),
        requestRemoveWorktree: vi.fn(),
      },
      dialogs: null,
    })
    const branch = createRepoBranch('feature/local')
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [branch],
      remote: { hasRemotes: false, hasBrowserRemote: false, hasGitHubRemote: false },
    })

    const { useBranchActionItems: useItems } = await import('#/web/hooks/useBranchActionItems.ts')
    const itemIds = await renderItems(useItems, repo, branch)

    expect(itemIds).not.toContain('fetchRemote')
  })
```

Also update every `mocks.useBranchActions.mockReturnValue` capabilities object to include `canFetchRemote`, and every actions object to include `fetchRemote`.

- [ ] **Step 6: Verify UI tests pass**

Run:

```bash
bun run test src/web/hooks/useBranchActionItems.test.tsx src/web/components/branch-list/branch-write-candidates.test.ts
```

Expected: all tests pass.

## Task 7: I18n Keys

**Files:**
- Modify: `src/shared/i18n/en.ts`
- Modify: `src/shared/i18n/zh.ts`
- Modify: `src/shared/i18n/ko.ts`
- Modify: `src/shared/i18n/ja.ts`
- Test: `src/shared/i18n/dictionaries.test.ts`

- [ ] **Step 1: Add English keys**

In `src/shared/i18n/en.ts`, add near the existing action keys:

```ts
  'action.fetch-remote': 'Fetch Remote',
  'action.fetch-remote-title': 'Fetch remote refs without merging',
  'action.fetch-remote-loading': 'Fetching…',
  'action.fetch-remote-queued': 'Waiting to fetch…',
  'action.create-branch': 'Create Branch',
  'action.create-branch-title': 'Create branch',
  'action.create-branch-creating-title': 'Creating branch…',
  'action.create-branch-queued-title': 'Waiting to create branch…',
  'action.create-branch-created-title': 'Created branch {branch}',
  'action.create-branch-base-label': 'Base branch',
  'action.create-branch-name-label': 'New branch name',
  'action.create-branch-name-placeholder': 'feature/name',
  'action.create-branch-invalid': 'Use a valid git branch name.',
  'action.create-branch-exists': 'A branch with this name already exists.',
  'action.create-branch-confirm': 'Create branch',
```

- [ ] **Step 2: Add Chinese keys**

In `src/shared/i18n/zh.ts`, add matching keys:

```ts
  'action.fetch-remote': '获取远程',
  'action.fetch-remote-title': '获取远程引用，不合并',
  'action.fetch-remote-loading': '正在获取…',
  'action.fetch-remote-queued': '等待获取…',
  'action.create-branch': '新建分支',
  'action.create-branch-title': '新建分支',
  'action.create-branch-creating-title': '正在新建分支…',
  'action.create-branch-queued-title': '等待新建分支…',
  'action.create-branch-created-title': '已新建分支 {branch}',
  'action.create-branch-base-label': '基础分支',
  'action.create-branch-name-label': '新分支名',
  'action.create-branch-name-placeholder': 'feature/name',
  'action.create-branch-invalid': '请输入有效的 Git 分支名。',
  'action.create-branch-exists': '同名分支已存在。',
  'action.create-branch-confirm': '新建分支',
```

- [ ] **Step 3: Add Korean keys**

In `src/shared/i18n/ko.ts`, add matching keys:

```ts
  'action.fetch-remote': '원격 가져오기',
  'action.fetch-remote-title': '병합 없이 원격 참조 가져오기',
  'action.fetch-remote-loading': '가져오는 중…',
  'action.fetch-remote-queued': '가져오기 대기 중…',
  'action.create-branch': '브랜치 만들기',
  'action.create-branch-title': '브랜치 만들기',
  'action.create-branch-creating-title': '브랜치 만드는 중…',
  'action.create-branch-queued-title': '브랜치 만들기 대기 중…',
  'action.create-branch-created-title': '{branch} 브랜치를 만들었습니다',
  'action.create-branch-base-label': '기준 브랜치',
  'action.create-branch-name-label': '새 브랜치 이름',
  'action.create-branch-name-placeholder': 'feature/name',
  'action.create-branch-invalid': '올바른 Git 브랜치 이름을 입력하세요.',
  'action.create-branch-exists': '같은 이름의 브랜치가 이미 있습니다.',
  'action.create-branch-confirm': '브랜치 만들기',
```

- [ ] **Step 4: Add Japanese keys**

In `src/shared/i18n/ja.ts`, add matching keys:

```ts
  'action.fetch-remote': 'リモートを取得',
  'action.fetch-remote-title': 'マージせずにリモート参照を取得',
  'action.fetch-remote-loading': '取得中…',
  'action.fetch-remote-queued': '取得待ち…',
  'action.create-branch': 'ブランチを作成',
  'action.create-branch-title': 'ブランチを作成',
  'action.create-branch-creating-title': 'ブランチを作成中…',
  'action.create-branch-queued-title': 'ブランチ作成を待機中…',
  'action.create-branch-created-title': 'ブランチ {branch} を作成しました',
  'action.create-branch-base-label': 'ベースブランチ',
  'action.create-branch-name-label': '新しいブランチ名',
  'action.create-branch-name-placeholder': 'feature/name',
  'action.create-branch-invalid': '有効な Git ブランチ名を入力してください。',
  'action.create-branch-exists': '同じ名前のブランチがすでに存在します。',
  'action.create-branch-confirm': 'ブランチを作成',
```

- [ ] **Step 5: Verify dictionary parity**

Run:

```bash
bun run test src/shared/i18n/dictionaries.test.ts
```

Expected: all tests pass.

## Task 8: Full Verification

**Files:**
- No new files

- [ ] **Step 1: Run focused test set**

Run:

```bash
bun run test src/system/git/branches-write.test.ts src/system/ssh/commands.test.ts src/system/ssh/git.test.ts src/server/modules/repo.test.ts src/web/repo-client.test.ts src/web/stores/repos/branch-action-scheduler.test.ts src/web/stores/repos/branch-actions.test.ts src/web/hooks/useBranchActionItems.test.tsx src/web/components/branch-list/branch-write-candidates.test.ts src/shared/i18n/dictionaries.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run architecture guard**

Run:

```bash
bun run check:architecture
```

Expected: architecture guard passes.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: typecheck passes.

- [ ] **Step 4: Run full test suite**

Run:

```bash
bun run test
```

Expected: full test suite passes.

- [ ] **Step 5: Manual verification**

Manual checks:

```text
1. Open a repository with a configured remote.
2. Open a branch row menu and run Fetch Remote.
3. Confirm the branch list refreshes and the active worktree does not change branch or file contents.
4. Open the same branch row menu and create a branch named feature/manual-check.
5. Confirm the new branch appears after refresh and the current checkout remains unchanged.
6. In a repository with multiple worktrees, open Checkout To and Merge.
7. Confirm the current branch and all worktree-checked-out branches are absent from both selectors.
```

Expected: fetch does not merge, create branch does not checkout, and unsafe candidates are not selectable.
