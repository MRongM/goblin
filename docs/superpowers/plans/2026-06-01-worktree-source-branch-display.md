# Worktree Source Branch Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show exact or inferred source branch badges on left branch-list rows for worktree branches.

**Architecture:** Keep Git snapshot data and Goblin-owned source metadata separate. Exact source metadata is recorded in the renderer store after successful Goblin worktree creation; inferred source metadata is read best-effort from reflog through local and remote RPC and never overwrites exact metadata.

**Tech Stack:** TypeScript, Electron main/renderer split, tRPC, Zustand persist, Valibot, Vitest, React, shadcn-style UI primitives.

---

## Project Constraint

The project instructions say not to plan or execute git commits unless the user explicitly asks. This plan intentionally omits commit steps from the `superpowers:writing-plans` template.

## File Structure

- Create `src/shared/worktree-source.ts`
  - Owns source metadata types, key construction, reflog parsing, and source validation.
- Create `src/shared/worktree-source.test.ts`
  - Unit tests for keying and reflog parsing.
- Modify `src/main/git/branches.ts`
  - Adds local reflog inference helper.
- Modify `src/main/git/branches.test.ts`
  - Covers local inference from a real Git reflog.
- Modify `src/main/ssh/commands.ts`
  - Adds a remote command for branch reflog messages.
- Modify `src/main/ssh/commands.test.ts`
  - Verifies the remote command quotes path and branch safely.
- Modify `src/main/ssh/git.ts`
  - Adds remote source inference helper.
- Modify `src/main/ssh/git.test.ts`
  - Covers remote inference behavior.
- Modify `src/shared/rpc.ts`
  - Adds local and remote inference RPC contracts and Valibot schemas.
- Modify `src/main/rpc.ts`
  - Wires handlers for local and remote source inference.
- Modify `src/main/rpc.test.ts`
  - Covers RPC validation/routing for inference endpoints.
- Create `src/renderer/stores/repos/worktree-sources.ts`
  - Owns renderer source metadata normalization, lookup, record, merge, prune, and inference refresh orchestration.
- Modify `src/renderer/stores/repos/types.ts`
  - Adds persisted source map and source metadata type imports to store state.
- Modify `src/renderer/stores/repos/store.ts`
  - Adds persisted `worktreeSourcesByRepo`.
- Modify `src/renderer/stores/repos/persistence.ts`
  - Adds normalization for persisted source metadata.
- Modify `src/renderer/stores/repos/persistence.test.ts`
  - Covers source metadata persistence normalization and hydration.
- Modify `src/renderer/stores/repos/test-utils.ts`
  - Resets and seeds `worktreeSourcesByRepo` for tests.
- Modify `src/renderer/stores/repos/branch-actions.ts`
  - Records exact source metadata after successful `createWorktree`.
- Modify `src/renderer/stores/repos/branch-actions.test.ts`
  - Covers exact source record success and failure.
- Modify `src/renderer/stores/repos/refresh.ts`
  - Prunes stale source metadata and launches silent reflog inference after snapshot success.
- Modify `src/renderer/stores/repos/refresh.test.ts`
  - Covers inferred merge and stale prune.
- Modify `src/renderer/components/BranchList.tsx`
  - Selects source metadata and passes per-row source data.
- Modify `src/renderer/components/branch-list/BranchRow.tsx`
  - Renders exact/inferred source badge and includes it in title text.
- Modify `src/renderer/components/branch-list/BranchRow.test.tsx`
  - Covers exact, inferred, and non-worktree rendering.
- Modify `src/main/i18n/en.ts`, `src/main/i18n/zh.ts`, `src/main/i18n/ja.ts`, `src/main/i18n/ko.ts`
  - Adds source badge labels.
- Modify `src/main/i18n/dictionaries.test.ts`
  - Verifies every dictionary still has the same key set after adding source labels.

## Task 1: Shared Source Metadata and Reflog Parser

**Files:**
- Create: `src/shared/worktree-source.ts`
- Create: `src/shared/worktree-source.test.ts`

- [ ] **Step 1: Write failing shared tests**

Add `src/shared/worktree-source.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  parseWorktreeSourceFromReflog,
  worktreeSourceKey,
  validWorktreeSourceInfo,
} from '#/shared/worktree-source.ts'

describe('worktree source metadata', () => {
  test('keys source entries by branch and worktree path', () => {
    expect(worktreeSourceKey('feature/a', '/repo-feature-a')).toBe('feature/a\0/repo-feature-a')
  })

  test('parses the first safe Created from reflog message', () => {
    const output = [
      'commit: keep working',
      'branch: Created from main',
      'branch: Created from -bad',
    ].join('\n')

    expect(parseWorktreeSourceFromReflog(output, 'feature/a')).toBe('main')
  })

  test('ignores malformed, self-referential, and unsafe reflog messages', () => {
    expect(parseWorktreeSourceFromReflog('branch: Created from feature/a', 'feature/a')).toBeNull()
    expect(parseWorktreeSourceFromReflog('checkout: moving from main to feature/a', 'feature/a')).toBeNull()
    expect(parseWorktreeSourceFromReflog('branch: Created from -bad', 'feature/a')).toBeNull()
  })

  test('validates persisted source entries', () => {
    expect(
      validWorktreeSourceInfo({
        branch: 'feature/a',
        worktreePath: '/repo-feature-a',
        sourceBranch: 'main',
        confidence: 'exact',
        updatedAt: 100,
      }),
    ).toBe(true)
    expect(
      validWorktreeSourceInfo({
        branch: 'feature/a',
        worktreePath: '',
        sourceBranch: 'main',
        confidence: 'exact',
        updatedAt: 100,
      }),
    ).toBe(false)
    expect(
      validWorktreeSourceInfo({
        branch: 'feature/a',
        worktreePath: '/repo-feature-a',
        sourceBranch: 'feature/a',
        confidence: 'inferred',
        updatedAt: 100,
      }),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run the failing shared test**

Run: `bun run test src/shared/worktree-source.test.ts`

Expected: FAIL because `src/shared/worktree-source.ts` does not exist.

- [ ] **Step 3: Add shared implementation**

Create `src/shared/worktree-source.ts`:

```ts
import { isSafeBranchName } from '#/shared/refnames.ts'

export type WorktreeSourceConfidence = 'exact' | 'inferred'

export interface WorktreeSourceInfo {
  branch: string
  worktreePath: string
  sourceBranch: string
  confidence: WorktreeSourceConfidence
  updatedAt: number
}

export interface WorktreeSourceInference {
  branch: string
  sourceBranch: string
  confidence: 'inferred'
}

const CREATED_FROM_RE = /^branch: Created from (.+)$/

export function worktreeSourceKey(branch: string, worktreePath: string): string {
  return `${branch}\0${worktreePath}`
}

export function validWorktreeSourceValue(branch: string, sourceBranch: string): boolean {
  return isSafeBranchName(branch) && isSafeBranchName(sourceBranch) && sourceBranch !== branch
}

export function parseWorktreeSourceFromReflog(output: string, branch: string): string | null {
  if (!isSafeBranchName(branch)) return null
  for (const line of output.split('\n')) {
    const match = CREATED_FROM_RE.exec(line.trim())
    if (!match) continue
    const sourceBranch = match[1]?.trim() ?? ''
    if (validWorktreeSourceValue(branch, sourceBranch)) return sourceBranch
  }
  return null
}

export function validWorktreeSourceInfo(value: unknown): value is WorktreeSourceInfo {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<WorktreeSourceInfo>
  return (
    typeof item.branch === 'string' &&
    typeof item.worktreePath === 'string' &&
    item.worktreePath.length > 0 &&
    !item.worktreePath.includes('\0') &&
    typeof item.sourceBranch === 'string' &&
    (item.confidence === 'exact' || item.confidence === 'inferred') &&
    typeof item.updatedAt === 'number' &&
    Number.isFinite(item.updatedAt) &&
    validWorktreeSourceValue(item.branch, item.sourceBranch)
  )
}
```

- [ ] **Step 4: Run shared tests**

Run: `bun run test src/shared/worktree-source.test.ts`

Expected: PASS.

## Task 2: Local Git Reflog Inference and Local RPC

**Files:**
- Modify: `src/main/git/branches.ts`
- Modify: `src/main/git/branches.test.ts`
- Modify: `src/shared/rpc.ts`
- Modify: `src/main/rpc.ts`
- Modify: `src/main/rpc.test.ts`

- [ ] **Step 1: Write failing local Git helper tests**

In `src/main/git/branches.test.ts`, extend the import:

```ts
import {
  checkoutBranch,
  checkoutRemoteTrackingBranch,
  deleteBranch,
  getBranches,
  getLog,
  getUpstream,
  inferWorktreeSources,
  isAncestor,
  markDefaultBranch,
  markMergedToDefault,
  prioritizeDefaultBranch,
} from '#/main/git/branches.ts'
```

Add this test block near the branch operation tests:

```ts
describe('worktree source inference', () => {
  test('infers source branch from a worktree branch reflog', async () => {
    const repo = createRepo()
    const worktreePath = path.join(path.dirname(repo), 'repo-feature-source')
    runGit(repo, ['worktree', 'add', '-b', 'feature/source', '--', worktreePath, 'main'])

    const sources = await inferWorktreeSources(repo, ['feature/source'])

    expect(sources).toEqual([
      {
        branch: 'feature/source',
        sourceBranch: 'main',
        confidence: 'inferred',
      },
    ])
  })

  test('ignores invalid branches and missing reflog entries', async () => {
    const repo = createRepo()

    const sources = await inferWorktreeSources(repo, ['-bad', 'feature/missing'])

    expect(sources).toEqual([])
  })

  test('returns empty when source inference is already aborted', async () => {
    const repo = createRepo()

    const sources = await inferWorktreeSources(repo, ['main'], abortedSignal())

    expect(sources).toEqual([])
  })
})
```

- [ ] **Step 2: Run failing local Git helper tests**

Run: `bun run test src/main/git/branches.test.ts -t "worktree source inference"`

Expected: FAIL because `inferWorktreeSources` is not exported.

- [ ] **Step 3: Implement local Git helper**

In `src/main/git/branches.ts`, add imports:

```ts
import {
  parseWorktreeSourceFromReflog,
  type WorktreeSourceInference,
} from '#/shared/worktree-source.ts'
```

Add this function after `getLog`:

```ts
export async function inferWorktreeSources(
  cwd: string,
  branches: string[],
  signal?: AbortSignal,
): Promise<WorktreeSourceInference[]> {
  if (signal?.aborted) return []
  const uniqueBranches = Array.from(new Set(branches.filter(isSafeBranchName)))
  const results = await Promise.all(
    uniqueBranches.map(async (branch): Promise<WorktreeSourceInference | null> => {
      if (signal?.aborted) return null
      try {
        const output = await git(cwd, ['reflog', 'show', '--format=%gs', branch], { signal })
        const sourceBranch = parseWorktreeSourceFromReflog(output, branch)
        return sourceBranch ? { branch, sourceBranch, confidence: 'inferred' } : null
      } catch {
        return null
      }
    }),
  )
  return signal?.aborted ? [] : results.filter((entry): entry is WorktreeSourceInference => entry !== null)
}
```

- [ ] **Step 4: Run local Git helper tests**

Run: `bun run test src/main/git/branches.test.ts -t "worktree source inference"`

Expected: PASS.

- [ ] **Step 5: Add failing local RPC contract tests**

In `src/main/rpc.test.ts`, extend the import from `#/main/git/branches.ts`:

```ts
import {
  checkoutRemoteTrackingBranch,
  getDefaultBranch,
  inferWorktreeSources,
  isAncestor,
  getCurrentBranch,
  getUpstream,
  isGitRepo,
} from '#/main/git/branches.ts'
```

Extend the `vi.mock('#/main/git/branches.ts', ...)` object:

```ts
inferWorktreeSources: vi.fn(() => [{ branch: 'feature/a', sourceBranch: 'main', confidence: 'inferred' }]),
```

Add this test near `routes local remote tracking checkout through typed repo RPC`:

```ts
test('routes local worktree source inference through typed repo RPC', async () => {
  const result = await invokeRpc('repo.inferWorktreeSources', {
    cwd: '/repo',
    branches: ['feature/a', 'bad branch'],
  })

  expect(result).toEqual({
    ok: true,
    data: [{ branch: 'feature/a', sourceBranch: 'main', confidence: 'inferred' }],
  })
  expect(inferWorktreeSources).toHaveBeenCalledWith('/repo', ['feature/a'], expect.any(AbortSignal))
})
```

- [ ] **Step 6: Add RPC types and router procedure**

In `src/shared/rpc.ts`, import the inference type:

```ts
import type { WorktreeSourceInference } from '#/shared/worktree-source.ts'
```

Add to `AppRpcHandlers.repo`:

```ts
inferWorktreeSources: (input: { cwd: string; branches: string[] }) => Promise<WorktreeSourceInference[]>
```

Add a router procedure under `repo` after `snapshot`:

```ts
inferWorktreeSources: p
  .input(v.object({ cwd: v.string(), branches: v.array(v.string()) }))
  .query(({ input }) => handlers.repo.inferWorktreeSources(input)),
```

- [ ] **Step 7: Wire main local RPC handler**

In `src/main/rpc.ts`, add `inferWorktreeSources` to the import from `#/main/git/branches.ts`.

Add this handler in `repo` after `snapshot`:

```ts
inferWorktreeSources: async ({ cwd, branches }) => {
  if (!isValidCwd(cwd)) return []
  if (!Array.isArray(branches)) return []
  const safeBranches = branches.filter(isValidBranch)
  if (safeBranches.length === 0) return []
  return inferWorktreeSources(cwd, safeBranches, currentRpcSignal())
},
```

- [ ] **Step 8: Run local RPC tests**

Run: `bun run test src/main/rpc.test.ts -t "worktree source inference"`

Expected: PASS.

## Task 3: Remote Reflog Inference and Remote RPC

**Files:**
- Modify: `src/main/ssh/commands.ts`
- Modify: `src/main/ssh/commands.test.ts`
- Modify: `src/main/ssh/git.ts`
- Modify: `src/main/ssh/git.test.ts`
- Modify: `src/shared/rpc.ts`
- Modify: `src/main/rpc.ts`
- Modify: `src/main/rpc.test.ts`

- [ ] **Step 1: Write failing remote command test**

In `src/main/ssh/commands.test.ts`, add:

```ts
test('builds quoted remote reflog command for source inference', () => {
  const invocation = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitReflogMessages',
    path: '/srv/goblin repo',
    branch: 'feature/source',
  })

  expect(invocation.script).toContain("git -C '/srv/goblin repo' reflog show --format='%gs' 'feature/source'")
})
```

- [ ] **Step 2: Run failing remote command test**

Run: `bun run test src/main/ssh/commands.test.ts -t "remote reflog"`

Expected: FAIL because `gitReflogMessages` is not part of `RemoteCommandKind`.

- [ ] **Step 3: Add remote command**

In `src/main/ssh/commands.ts`, add this union member:

```ts
| { type: 'gitReflogMessages'; path: string; branch: string }
```

Add this `scriptForCommand` case near `gitLog`:

```ts
case 'gitReflogMessages':
  return `git -C ${shellQuote(command.path)} reflog show --format=${shellQuote('%gs')} ${shellQuote(command.branch)}`
```

- [ ] **Step 4: Run remote command test**

Run: `bun run test src/main/ssh/commands.test.ts -t "remote reflog"`

Expected: PASS.

- [ ] **Step 5: Write failing remote Git helper tests**

In `src/main/ssh/git.test.ts`, add `inferRemoteWorktreeSources` to the import from `#/main/ssh/git.ts`.

Add:

```ts
test('infers remote worktree source branches from reflog messages', async () => {
  const calls: unknown[] = []
  const result = await inferRemoteWorktreeSources(TARGET, ['feature/source', '-bad'], {
    run: async (command) => {
      calls.push(command)
      return {
        ok: true,
        stdout: 'commit: work\nbranch: Created from main',
        stderr: '',
      }
    },
  })

  expect(result).toEqual([{ branch: 'feature/source', sourceBranch: 'main', confidence: 'inferred' }])
  expect(calls).toEqual([{ type: 'gitReflogMessages', path: TARGET.remotePath, branch: 'feature/source' }])
})

test('ignores failed remote source inference commands', async () => {
  const result = await inferRemoteWorktreeSources(TARGET, ['feature/source'], {
    run: async () => ({ ok: false, stdout: '', stderr: 'missing reflog', message: 'missing reflog' }),
  })

  expect(result).toEqual([])
})
```

Use existing remote target and runner types from `src/main/ssh/git.test.ts`.

- [ ] **Step 6: Implement remote Git helper**

In `src/main/ssh/git.ts`, extend the shared import:

```ts
import {
  parseWorktreeSourceFromReflog,
  type WorktreeSourceInference,
} from '#/shared/worktree-source.ts'
```

Add this function after `getRemoteLog`:

```ts
export async function inferRemoteWorktreeSources(
  target: RemoteRepoTarget,
  branches: string[],
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<WorktreeSourceInference[]> {
  if (options.signal?.aborted) return []
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const uniqueBranches = Array.from(new Set(branches.filter(isSafeBranchName)))
  const results = await mapWithConcurrency(
    uniqueBranches,
    REMOTE_WORKTREE_STATUS_CONCURRENCY,
    async (branch): Promise<WorktreeSourceInference | null> => {
      const result = await run({ type: 'gitReflogMessages', path: target.remotePath, branch }, target, {
        signal: options.signal,
      })
      if (!result.ok || options.signal?.aborted) return null
      const sourceBranch = parseWorktreeSourceFromReflog(result.stdout, branch)
      return sourceBranch ? { branch, sourceBranch, confidence: 'inferred' } : null
    },
    options.signal,
  )
  return options.signal?.aborted
    ? []
    : results.filter((entry): entry is WorktreeSourceInference => entry !== null)
}
```

- [ ] **Step 7: Run remote Git helper tests**

Run: `bun run test src/main/ssh/git.test.ts -t "remote worktree source"`

Expected: PASS.

- [ ] **Step 8: Add remote RPC contract and handler**

In `src/shared/rpc.ts`, add to `AppRpcHandlers.remote`:

```ts
inferWorktreeSources: (input: {
  target: RemoteRepoTarget
  branches: string[]
}) => Promise<WorktreeSourceInference[]>
```

Add this remote router procedure after `snapshot`:

```ts
inferWorktreeSources: p
  .input(v.object({ target: RemoteTargetSchema, branches: v.array(v.string()) }))
  .query(({ input }) => handlers.remote.inferWorktreeSources(input)),
```

In `src/main/rpc.ts`, import `inferRemoteWorktreeSources` from `#/main/ssh/git.ts`.

Add this remote handler after `snapshot`:

```ts
inferWorktreeSources: async ({ target, branches }) => {
  if (!Array.isArray(branches)) return []
  const safeBranches = branches.filter(isValidBranch)
  if (safeBranches.length === 0) return []
  return inferRemoteWorktreeSources(normalizedRemoteTargetOrThrow(target), safeBranches, { signal: currentRpcSignal() })
},
```

- [ ] **Step 9: Add and run remote RPC routing tests**

In `src/main/rpc.test.ts`, extend the import from `#/main/ssh/git.ts`:

```ts
import {
  checkoutRemoteBranch,
  checkoutRemoteTrackingBranchOnRemote,
  createRemoteWorktree,
  deleteRemoteBranch,
  fetchRemoteRepository,
  getRemoteCommitDetail,
  getRemoteGitHubUrl,
  getRemoteLog,
  inferRemoteWorktreeSources,
  pushRemoteBranch,
} from '#/main/ssh/git.ts'
```

Extend the `vi.mock('#/main/ssh/git.ts', ...)` object:

```ts
inferRemoteWorktreeSources: vi.fn(() => [{ branch: 'feature/a', sourceBranch: 'main', confidence: 'inferred' }]),
```

Add this test near the other typed remote read procedure tests:

```ts
test('routes remote worktree source inference through typed remote RPC', async () => {
  const result = await invokeRpc('remote.inferWorktreeSources', {
    target: REMOTE_TARGET,
    branches: ['feature/a', 'bad branch'],
  })

  expect(result).toEqual({
    ok: true,
    data: [{ branch: 'feature/a', sourceBranch: 'main', confidence: 'inferred' }],
  })
  expect(inferRemoteWorktreeSources).toHaveBeenCalledWith(
    expect.objectContaining({ id: REMOTE_TARGET.id }),
    ['feature/a'],
    { signal: undefined },
  )
})
```

Run: `bun run test src/main/rpc.test.ts -t "worktree source inference"`

Expected: PASS for local and remote inference RPC tests.

## Task 4: Renderer Source Persistence and Store Helpers

**Files:**
- Create: `src/renderer/stores/repos/worktree-sources.ts`
- Modify: `src/renderer/stores/repos/types.ts`
- Modify: `src/renderer/stores/repos/store.ts`
- Modify: `src/renderer/stores/repos/persistence.ts`
- Modify: `src/renderer/stores/repos/persistence.test.ts`
- Modify: `src/renderer/stores/repos/test-utils.ts`

- [ ] **Step 1: Write failing persistence tests**

In `src/renderer/stores/repos/persistence.test.ts`, extend the persistence import:

```ts
import {
  hydrateCachedRepo,
  normalizeRepoCache,
  normalizeWorktreeSourcesByRepo,
  persistRepoCache,
} from '#/renderer/stores/repos/persistence.ts'
```

Add:

```ts
describe('normalizeWorktreeSourcesByRepo', () => {
  test('keeps valid source entries and drops malformed entries', () => {
    const normalized = normalizeWorktreeSourcesByRepo({
      '/repo': {
        good: {
          branch: 'feature/a',
          worktreePath: '/repo-feature-a',
          sourceBranch: 'main',
          confidence: 'exact',
          updatedAt: 100,
        },
        badPath: {
          branch: 'feature/b',
          worktreePath: '',
          sourceBranch: 'main',
          confidence: 'exact',
          updatedAt: 100,
        },
        badSource: {
          branch: 'feature/c',
          worktreePath: '/repo-feature-c',
          sourceBranch: '-bad',
          confidence: 'inferred',
          updatedAt: 100,
        },
      },
    })

    expect(normalized).toEqual({
      '/repo': {
        'feature/a\0/repo-feature-a': {
          branch: 'feature/a',
          worktreePath: '/repo-feature-a',
          sourceBranch: 'main',
          confidence: 'exact',
          updatedAt: 100,
        },
      },
    })
  })
})
```

In the `repo store persistence` describe block, add a localStorage rehydrate assertion:

```ts
test('rehydrates worktree source metadata from local storage', async () => {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
    },
  })
  storage.set(
    'goblin.repo-store.v1',
    JSON.stringify({
      state: {
        repoCache: {},
        branchOrdersByRepo: {},
        remotePortConfigsByRepo: {},
        worktreeSourcesByRepo: {
          '/repo': {
            'feature/a\0/repo-feature-a': {
              branch: 'feature/a',
              worktreePath: '/repo-feature-a',
              sourceBranch: 'main',
              confidence: 'exact',
              updatedAt: 100,
            },
          },
        },
      },
      version: 0,
    }),
  )

  await useReposStore.persist.rehydrate()

  expect(useReposStore.getState().worktreeSourcesByRepo['/repo']).toEqual({
    'feature/a\0/repo-feature-a': {
      branch: 'feature/a',
      worktreePath: '/repo-feature-a',
      sourceBranch: 'main',
      confidence: 'exact',
      updatedAt: 100,
    },
  })
})
```

- [ ] **Step 2: Run failing persistence tests**

Run: `bun run test src/renderer/stores/repos/persistence.test.ts -t "worktree source|worktree source metadata"`

Expected: FAIL because source persistence helpers and store state do not exist.

- [ ] **Step 3: Add renderer source helper module**

Create `src/renderer/stores/repos/worktree-sources.ts`:

```ts
import { rpc } from '#/renderer/rpc.ts'
import type { ReposGet, ReposSet, RepoBranchState, RepoState } from '#/renderer/stores/repos/types.ts'
import {
  validWorktreeSourceInfo,
  worktreeSourceKey,
  type WorktreeSourceInfo,
  type WorktreeSourceInference,
} from '#/shared/worktree-source.ts'

export function sourceForBranch(
  sources: Record<string, WorktreeSourceInfo> | undefined,
  branch: RepoBranchState,
): WorktreeSourceInfo | null {
  if (!branch.worktree?.path) return null
  return sources?.[worktreeSourceKey(branch.name, branch.worktree.path)] ?? null
}

export function liveWorktreeSourceKeys(branches: RepoBranchState[]): Set<string> {
  return new Set(
    branches
      .filter((branch) => !!branch.worktree?.path)
      .map((branch) => worktreeSourceKey(branch.name, branch.worktree!.path)),
  )
}

export function recordExactWorktreeSource(
  set: ReposSet,
  input: { repoId: string; token: number; branch: string; worktreePath: string; sourceBranch: string; now?: number },
): void {
  const entry: WorktreeSourceInfo = {
    branch: input.branch,
    worktreePath: input.worktreePath,
    sourceBranch: input.sourceBranch,
    confidence: 'exact',
    updatedAt: input.now ?? Date.now(),
  }
  if (!validWorktreeSourceInfo(entry)) return
  const key = worktreeSourceKey(entry.branch, entry.worktreePath)
  set((s) => {
    if (s.repos[input.repoId]?.instanceToken !== input.token) return s
    return {
      worktreeSourcesByRepo: {
        ...s.worktreeSourcesByRepo,
        [input.repoId]: {
          ...(s.worktreeSourcesByRepo[input.repoId] ?? {}),
          [key]: entry,
        },
      },
    }
  })
}

export function pruneWorktreeSourcesForRepo(set: ReposSet, input: { repoId: string; token: number }): void {
  set((s) => {
    const repo = s.repos[input.repoId]
    if (!repo || repo.instanceToken !== input.token) return s
    const existing = s.worktreeSourcesByRepo[input.repoId]
    if (!existing) return s
    const liveKeys = liveWorktreeSourceKeys(repo.data.branches)
    const next = Object.fromEntries(Object.entries(existing).filter(([key]) => liveKeys.has(key)))
    if (Object.keys(next).length === Object.keys(existing).length) return s
    const worktreeSourcesByRepo = { ...s.worktreeSourcesByRepo }
    if (Object.keys(next).length === 0) delete worktreeSourcesByRepo[input.repoId]
    else worktreeSourcesByRepo[input.repoId] = next
    return { worktreeSourcesByRepo }
  })
}

export function mergeInferredWorktreeSources(
  set: ReposSet,
  input: { repoId: string; token: number; inferences: WorktreeSourceInference[]; now?: number },
): void {
  set((s) => {
    const repo = s.repos[input.repoId]
    if (!repo || repo.instanceToken !== input.token || input.inferences.length === 0) return s
    const currentSources = s.worktreeSourcesByRepo[input.repoId] ?? {}
    const next = { ...currentSources }
    let changed = false
    for (const inference of input.inferences) {
      const branch = repo.data.branches.find((item) => item.name === inference.branch)
      if (!branch?.worktree?.path) continue
      const key = worktreeSourceKey(branch.name, branch.worktree.path)
      if (next[key]?.confidence === 'exact') continue
      const entry: WorktreeSourceInfo = {
        branch: branch.name,
        worktreePath: branch.worktree.path,
        sourceBranch: inference.sourceBranch,
        confidence: 'inferred',
        updatedAt: input.now ?? Date.now(),
      }
      if (!validWorktreeSourceInfo(entry)) continue
      next[key] = entry
      changed = true
    }
    return changed
      ? { worktreeSourcesByRepo: { ...s.worktreeSourcesByRepo, [input.repoId]: next } }
      : s
  })
}

export function missingSourceBranches(repo: RepoState, sources: Record<string, WorktreeSourceInfo> | undefined): string[] {
  return repo.data.branches
    .filter((branch) => !!branch.worktree?.path && !sourceForBranch(sources, branch))
    .map((branch) => branch.name)
}

export async function refreshWorktreeSourceInferences(
  set: ReposSet,
  get: ReposGet,
  input: { repoId: string; token: number },
): Promise<void> {
  const repo = get().repos[input.repoId]
  if (!repo || repo.instanceToken !== input.token) return
  const branches = missingSourceBranches(repo, get().worktreeSourcesByRepo[input.repoId])
  if (branches.length === 0) return
  try {
    const inferences =
      repo.kind === 'remote'
        ? repo.remoteTarget
          ? await rpc.remote.inferWorktreeSources.query({ target: repo.remoteTarget, branches })
          : []
        : await rpc.repo.inferWorktreeSources.query({ cwd: repo.id, branches })
    mergeInferredWorktreeSources(set, { repoId: input.repoId, token: input.token, inferences })
  } catch {
    return
  }
}
```

- [ ] **Step 4: Add store state and persistence normalization**

In `src/renderer/stores/repos/types.ts`, import type:

```ts
import type { WorktreeSourceInfo } from '#/shared/worktree-source.ts'
```

Add to `ReposStore`:

```ts
worktreeSourcesByRepo: Record<string, Record<string, WorktreeSourceInfo>>
```

In `src/renderer/stores/repos/store.ts`, import `WorktreeSourceInfo` if needed for the persisted interface, add to `PersistedReposStore` and `RawPersistedReposStore`:

```ts
worktreeSourcesByRepo: Record<string, Record<string, WorktreeSourceInfo>>
worktreeSourcesByRepo?: unknown
```

Add initial state:

```ts
worktreeSourcesByRepo: {},
```

Include in `repoStorage.getItem`, `partialize`, and `merge`:

```ts
const worktreeSourcesByRepo = normalizeWorktreeSourcesByRepo(parsed.state?.worktreeSourcesByRepo)
```

```ts
worktreeSourcesByRepo: state.worktreeSourcesByRepo,
```

```ts
worktreeSourcesByRepo: normalizeWorktreeSourcesByRepo(
  (persisted as RawPersistedReposStore | null)?.worktreeSourcesByRepo,
),
```

In `src/renderer/stores/repos/persistence.ts`, import:

```ts
import {
  validWorktreeSourceInfo,
  worktreeSourceKey,
  type WorktreeSourceInfo,
} from '#/shared/worktree-source.ts'
```

Add:

```ts
export function normalizeWorktreeSourcesByRepo(value: unknown): Record<string, Record<string, WorktreeSourceInfo>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized: Record<string, Record<string, WorktreeSourceInfo>> = {}
  for (const [repoId, rawSources] of Object.entries(value as Record<string, unknown>)) {
    if (!repoId || !rawSources || typeof rawSources !== 'object' || Array.isArray(rawSources)) continue
    const entries: Record<string, WorktreeSourceInfo> = {}
    for (const raw of Object.values(rawSources as Record<string, unknown>)) {
      if (!validWorktreeSourceInfo(raw)) continue
      entries[worktreeSourceKey(raw.branch, raw.worktreePath)] = raw
    }
    if (Object.keys(entries).length > 0) normalized[repoId] = entries
  }
  return normalized
}
```

In `src/renderer/stores/repos/test-utils.ts`, import the source type:

```ts
import type { WorktreeSourceInfo } from '#/shared/worktree-source.ts'
```

Add this option to `seedRepoState`:

```ts
worktreeSourcesByRepo?: Record<string, Record<string, WorktreeSourceInfo>>
```

Add `worktreeSourcesByRepo: {}` to `resetReposStore`.

In the `useReposStore.setState` call inside `seedRepoState`, add:

```ts
worktreeSourcesByRepo: options.worktreeSourcesByRepo ?? {},
```

- [ ] **Step 5: Run persistence tests**

Run: `bun run test src/renderer/stores/repos/persistence.test.ts -t "worktree source|worktree source metadata"`

Expected: PASS.

## Task 5: Record Exact Source and Infer on Refresh

**Files:**
- Modify: `src/renderer/stores/repos/branch-actions.ts`
- Modify: `src/renderer/stores/repos/branch-actions.test.ts`
- Modify: `src/renderer/stores/repos/refresh.ts`
- Modify: `src/renderer/stores/repos/refresh.test.ts`

- [ ] **Step 1: Write failing exact-record tests**

In `src/renderer/stores/repos/branch-actions.test.ts`, add:

```ts
test('records exact worktree source after successful create worktree', async () => {
  installSuccessfulCreateWorktreeBridge()

  const result = await useReposStore.getState().runBranchAction(REPO_ID, {
    kind: 'createWorktree',
    newBranch: 'feature/new',
    worktreePath: '/tmp/gbl-branch-actions-test-worktree',
    baseBranch: 'main',
  })

  expect(result?.ok).toBe(true)
  expect(useReposStore.getState().worktreeSourcesByRepo[REPO_ID]).toMatchObject({
    'feature/new\0/tmp/gbl-branch-actions-test-worktree': {
      branch: 'feature/new',
      worktreePath: '/tmp/gbl-branch-actions-test-worktree',
      sourceBranch: 'main',
      confidence: 'exact',
    },
  })
})

test('does not record exact worktree source after failed create worktree', async () => {
  installGoblinTestBridge({
    'repo.createWorktree': async () => ({ ok: false, message: 'boom' }),
  })

  const result = await useReposStore.getState().runBranchAction(
    REPO_ID,
    {
      kind: 'createWorktree',
      newBranch: 'feature/new',
      worktreePath: '/tmp/gbl-branch-actions-test-worktree',
      baseBranch: 'main',
    },
    { refreshOnError: false },
  )

  expect(result).toEqual({ ok: false, message: 'boom' })
  expect(useReposStore.getState().worktreeSourcesByRepo[REPO_ID]).toBeUndefined()
})
```

- [ ] **Step 2: Run failing exact-record tests**

Run: `bun run test src/renderer/stores/repos/branch-actions.test.ts -t "worktree source"`

Expected: FAIL because `runBranchAction` does not record exact source metadata.

- [ ] **Step 3: Record exact metadata after successful create**

In `src/renderer/stores/repos/branch-actions.ts`, import:

```ts
import { recordExactWorktreeSource } from '#/renderer/stores/repos/worktree-sources.ts'
```

In `handleResult`, after `if (result.message === 'cancelled') return` and before refresh workflow, add:

```ts
if (result.ok && action.kind === 'createWorktree') {
  recordExactWorktreeSource(set, {
    repoId: id,
    token,
    branch: action.newBranch,
    worktreePath: action.worktreePath,
    sourceBranch: action.baseBranch,
  })
}
```

- [ ] **Step 4: Run exact-record tests**

Run: `bun run test src/renderer/stores/repos/branch-actions.test.ts -t "worktree source"`

Expected: PASS.

- [ ] **Step 5: Write failing refresh prune/inference tests**

In `src/renderer/stores/repos/refresh.test.ts`, add tests in the snapshot refresh describe block:

```ts
test('prunes stale worktree source metadata after snapshot refresh', async () => {
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('feature/old', { worktree: { path: '/tmp/old' } })],
  })
  useReposStore.setState({
    worktreeSourcesByRepo: {
      [REPO_ID]: {
        'feature/old\0/tmp/old': {
          branch: 'feature/old',
          worktreePath: '/tmp/old',
          sourceBranch: 'main',
          confidence: 'exact',
          updatedAt: 100,
        },
      },
    },
  })
  installGoblinTestBridge({
    'repo.snapshot': async () => ({ branches: [createBranchSnapshot('main')], current: 'main' }),
    'repo.status': async () => [],
    'repo.pullRequests': async () => [],
    'repo.inferWorktreeSources': async () => [],
  })

  await useReposStore.getState().refreshSnapshot(REPO_ID)

  expect(useReposStore.getState().worktreeSourcesByRepo[REPO_ID]).toBeUndefined()
})

test('merges inferred worktree sources after snapshot refresh without replacing exact entries', async () => {
  seedRepoState({ id: REPO_ID, branches: [createRepoBranch('main')] })
  useReposStore.setState({
    worktreeSourcesByRepo: {
      [REPO_ID]: {
        'feature/exact\0/tmp/exact': {
          branch: 'feature/exact',
          worktreePath: '/tmp/exact',
          sourceBranch: 'develop',
          confidence: 'exact',
          updatedAt: 100,
        },
      },
    },
  })
  installGoblinTestBridge({
    'repo.snapshot': async () => ({
      branches: [
        createBranchSnapshot('feature/exact', { worktree: { path: '/tmp/exact' } }),
        createBranchSnapshot('feature/inferred', { worktree: { path: '/tmp/inferred' } }),
      ],
      current: 'feature/exact',
    }),
    'repo.status': async () => [],
    'repo.pullRequests': async () => [],
    'repo.inferWorktreeSources': async ({ branches }) => {
      expect(branches).toEqual(['feature/inferred'])
      return [{ branch: 'feature/inferred', sourceBranch: 'main', confidence: 'inferred' }]
    },
  })

  await useReposStore.getState().refreshSnapshot(REPO_ID)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(useReposStore.getState().worktreeSourcesByRepo[REPO_ID]).toMatchObject({
    'feature/exact\0/tmp/exact': {
      sourceBranch: 'develop',
      confidence: 'exact',
    },
    'feature/inferred\0/tmp/inferred': {
      sourceBranch: 'main',
      confidence: 'inferred',
    },
  })
})
```

Use existing constants/imports in `src/renderer/stores/repos/refresh.test.ts`; import `createRepoBranch` and `createBranchSnapshot` from test utils if not already imported.

- [ ] **Step 6: Run failing refresh tests**

Run: `bun run test src/renderer/stores/repos/refresh.test.ts -t "worktree source"`

Expected: FAIL because refresh does not prune or infer source metadata.

- [ ] **Step 7: Wire prune and silent inference into refresh**

In `src/renderer/stores/repos/refresh.ts`, import:

```ts
import {
  pruneWorktreeSourcesForRepo,
  refreshWorktreeSourceInferences,
} from '#/renderer/stores/repos/worktree-sources.ts'
```

Inside `refreshSnapshot` `onResult`, after `runSnapshotSuccessWorkflow(...)`, add:

```ts
pruneWorktreeSourcesForRepo(set, { repoId: id, token })
void refreshWorktreeSourceInferences(set, get, { repoId: id, token })
```

This placement runs after the store contains fresh `r.data.branches`, so pruning and inference inspect the latest live worktree set.

- [ ] **Step 8: Run refresh tests**

Run: `bun run test src/renderer/stores/repos/refresh.test.ts -t "worktree source"`

Expected: PASS.

## Task 6: Branch List Source Badge and I18n

**Files:**
- Modify: `src/renderer/components/BranchList.tsx`
- Modify: `src/renderer/components/branch-list/BranchRow.tsx`
- Modify: `src/renderer/components/branch-list/BranchRow.test.tsx`
- Modify: `src/main/i18n/en.ts`
- Modify: `src/main/i18n/zh.ts`
- Modify: `src/main/i18n/ja.ts`
- Modify: `src/main/i18n/ko.ts`

- [ ] **Step 1: Write failing BranchRow rendering tests**

In `src/renderer/components/branch-list/BranchRow.test.tsx`, add:

```ts
describe('BranchRow worktree source badge', () => {
  test('renders exact source badge for worktree rows', () => {
    const repo = emptyRepo('/repo', 'repo')
    const branch = createBranch('feature/x', { worktreePath: '/repo-feature-x' })
    const selectedRef = { current: null }

    const markup = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={branch}
        worktreeSource={{
          branch: 'feature/x',
          worktreePath: '/repo-feature-x',
          sourceBranch: 'main',
          confidence: 'exact',
          updatedAt: 100,
        }}
        selected="feature/x"
        current="main"
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
      />,
    )

    expect(markup).toContain('branches.source.exact')
    expect(markup).toContain('main')
  })

  test('renders inferred source badge for worktree rows', () => {
    const repo = emptyRepo('/repo', 'repo')
    const branch = createBranch('feature/x', { worktreePath: '/repo-feature-x' })
    const selectedRef = { current: null }

    const markup = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={branch}
        worktreeSource={{
          branch: 'feature/x',
          worktreePath: '/repo-feature-x',
          sourceBranch: 'main',
          confidence: 'inferred',
          updatedAt: 100,
        }}
        selected="feature/x"
        current="main"
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
      />,
    )

    expect(markup).toContain('branches.source.inferred')
    expect(markup).toContain('main')
  })

  test('does not render source badge for non-worktree rows', () => {
    const repo = emptyRepo('/repo', 'repo')
    const branch = createBranch('feature/x')
    const selectedRef = { current: null }

    const markup = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={branch}
        worktreeSource={{
          branch: 'feature/x',
          worktreePath: '/repo-feature-x',
          sourceBranch: 'main',
          confidence: 'exact',
          updatedAt: 100,
        }}
        selected="feature/x"
        current="main"
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
      />,
    )

    expect(markup).not.toContain('branches.source.exact')
    expect(markup).not.toContain('branches.source.inferred')
  })
})
```

- [ ] **Step 2: Run failing BranchRow tests**

Run: `bun run test src/renderer/components/branch-list/BranchRow.test.tsx -t "worktree source"`

Expected: FAIL because `BranchRow` has no `worktreeSource` prop.

- [ ] **Step 3: Update BranchRow**

In `src/renderer/components/branch-list/BranchRow.tsx`, import:

```ts
import type { WorktreeSourceInfo } from '#/shared/worktree-source.ts'
```

Add prop:

```ts
worktreeSource?: WorktreeSourceInfo | null
```

Add to function parameters:

```ts
worktreeSource = null,
```

After `const worktreeDirty = ...`, add:

```ts
const visibleWorktreeSource = hasWorktree ? worktreeSource : null
const sourceLabel = visibleWorktreeSource
  ? t(
      visibleWorktreeSource.confidence === 'exact'
        ? 'branches.source.exact'
        : 'branches.source.inferred',
      { branch: visibleWorktreeSource.sourceBranch },
    )
  : null
```

Add `sourceLabel` to `ariaParts`.

In the badge group after the worktree/dirty badge block, add:

```tsx
{sourceLabel && (
  <Badge
    variant={visibleWorktreeSource?.confidence === 'exact' ? 'brand' : 'warning'}
    className="max-w-[12rem] gap-1 truncate"
    title={sourceLabel}
  >
    <span className="truncate">{sourceLabel}</span>
  </Badge>
)}
```

- [ ] **Step 4: Pass row source from BranchList**

In `src/renderer/components/BranchList.tsx`, import:

```ts
import { sourceForBranch } from '#/renderer/stores/repos/worktree-sources.ts'
```

In the store selector return object, add:

```ts
worktreeSources: repo ? (s.worktreeSourcesByRepo[repoId] ?? {}) : {},
```

Add equality comparison:

```ts
a.repo?.id === b.repo?.id && a.worktreeSources === b.worktreeSources
```

Replace the equality callback with this shape so source metadata changes re-render rows without broadening unrelated subscriptions:

```ts
(a, b) =>
  a.repo === b.repo
    ? a.branchSearchQuery === b.branchSearchQuery && a.worktreeSources === b.worktreeSources
    : !!a.repo &&
      !!b.repo &&
      a.repo.id === b.repo.id &&
      a.repo.instanceToken === b.repo.instanceToken &&
      a.repo.data.branches === b.repo.data.branches &&
      a.repo.ui.branchViewMode === b.repo.ui.branchViewMode &&
      a.repo.ui.branchOrder === b.repo.ui.branchOrder &&
      a.branchSearchQuery === b.branchSearchQuery &&
      a.worktreeSources === b.worktreeSources &&
      a.repo.data.worktreesByPath === b.repo.data.worktreesByPath &&
      a.repo.operations.branchAction === b.repo.operations.branchAction &&
      a.repo.resources.snapshot === b.repo.resources.snapshot &&
      a.branchCount === b.branchCount &&
      a.selected === b.selected &&
      a.current === b.current,
```

Add `worktreeSources` to the destructure:

```ts
const { repo, branches, selected, current, worktreeSources } = useStoreWithEqualityFn(...)
```

Pass it to `BranchRows`:

```tsx
worktreeSources={worktreeSources}
```

Add to `BranchRows` props:

```ts
worktreeSources: Record<string, WorktreeSourceInfo>
```

Import `WorktreeSourceInfo` from `#/shared/worktree-source.ts`.

Pass per row:

```tsx
worktreeSource={sourceForBranch(worktreeSources, branch)}
```

- [ ] **Step 5: Add i18n labels**

In `src/main/i18n/en.ts` under branch list keys:

```ts
'branches.source.exact': 'from {branch}',
'branches.source.inferred': 'inferred from {branch}',
```

In `src/main/i18n/zh.ts`:

```ts
'branches.source.exact': '来自 {branch}',
'branches.source.inferred': '推断来自 {branch}',
```

In `src/main/i18n/ja.ts`:

```ts
'branches.source.exact': '{branch} から',
'branches.source.inferred': '{branch} から推定',
```

In `src/main/i18n/ko.ts`:

```ts
'branches.source.exact': '{branch} 에서 생성',
'branches.source.inferred': '{branch} 에서 생성 추정',
```

- [ ] **Step 6: Run UI and dictionary tests**

Run: `bun run test src/renderer/components/branch-list/BranchRow.test.tsx src/main/i18n/dictionaries.test.ts`

Expected: PASS.

## Task 7: Full Verification

**Files:**
- No new source files.

- [ ] **Step 1: Run focused test suite**

Run:

```sh
bun run test src/shared/worktree-source.test.ts src/main/git/branches.test.ts src/main/ssh/commands.test.ts src/main/ssh/git.test.ts src/main/rpc.test.ts src/renderer/stores/repos/persistence.test.ts src/renderer/stores/repos/branch-actions.test.ts src/renderer/stores/repos/refresh.test.ts src/renderer/components/branch-list/BranchRow.test.tsx src/main/i18n/dictionaries.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full unit test suite**

Run:

```sh
bun run test
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript verification**

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

Expected: Only files related to worktree source branch display are changed by this implementation, plus any pre-existing unrelated worktree changes that were already present before implementation.

Run:

```sh
git diff -- docs/superpowers/specs/2026-06-01-worktree-source-branch-display-design.md docs/superpowers/plans/2026-06-01-worktree-source-branch-display.md src/shared/worktree-source.ts src/shared/worktree-source.test.ts src/main/git/branches.ts src/main/git/branches.test.ts src/main/ssh/commands.ts src/main/ssh/commands.test.ts src/main/ssh/git.ts src/main/ssh/git.test.ts src/shared/rpc.ts src/main/rpc.ts src/main/rpc.test.ts src/renderer/stores/repos/worktree-sources.ts src/renderer/stores/repos/types.ts src/renderer/stores/repos/store.ts src/renderer/stores/repos/persistence.ts src/renderer/stores/repos/persistence.test.ts src/renderer/stores/repos/test-utils.ts src/renderer/stores/repos/branch-actions.ts src/renderer/stores/repos/branch-actions.test.ts src/renderer/stores/repos/refresh.ts src/renderer/stores/repos/refresh.test.ts src/renderer/components/BranchList.tsx src/renderer/components/branch-list/BranchRow.tsx src/renderer/components/branch-list/BranchRow.test.tsx src/main/i18n/en.ts src/main/i18n/zh.ts src/main/i18n/ja.ts src/main/i18n/ko.ts src/main/i18n/dictionaries.test.ts
```

Expected: Diff matches the design: exact source recorded after successful create, inference is best-effort, exact is not overwritten, and source badges render only on left branch-list worktree rows.
