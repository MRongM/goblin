import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { hydrateCachedRepo, normalizeRepoCache, persistRepoCache } from '#/renderer/stores/repos/persistence.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import {
  createBranchSnapshot,
  createRepoBranch,
  resetReposStore,
  seedRepoState,
} from '#/renderer/stores/repos/test-utils.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { CachedRepoState } from '#/renderer/stores/repos/types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { normalizeRemotePortConfigMap } from '#/shared/remote-ports.ts'

function cachedRepo(savedAt: number): CachedRepoState {
  return {
    savedAt,
    name: 'repo',
    data: {
      branches: [],
      currentBranch: '',
      status: [],
      statusLoaded: false,
      worktreesByPath: {},
    },
    ui: {
      selectedBranch: null,
      branchViewMode: 'all',
      detailTab: 'status',
    },
  }
}

beforeEach(resetReposStore)

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

const REMOTE_TARGET: RemoteRepoTarget = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: 'prod',
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

describe('normalizeRepoCache', () => {
  test('keeps only the newest 50 valid cache entries', () => {
    const now = Date.now()
    const raw = Object.fromEntries(
      Array.from({ length: 55 }, (_, index) => [`/repo-${index}`, cachedRepo(now + index)]),
    )

    const normalized = normalizeRepoCache(raw)

    expect(Object.keys(normalized)).toHaveLength(50)
    expect(normalized['/repo-0']).toBeUndefined()
    expect(normalized['/repo-4']).toBeUndefined()
    expect(normalized['/repo-5']).toBeDefined()
    expect(Object.keys(normalized)[0]).toBe('/repo-54')
  })

  test('drops expired and invalid cache entries', () => {
    const now = Date.now()
    const normalized = normalizeRepoCache({
      fresh: cachedRepo(now),
      expired: cachedRepo(now - 15 * 24 * 60 * 60 * 1000),
      invalid: { savedAt: now, name: 'repo' },
    })

    expect(Object.keys(normalized)).toEqual(['fresh'])
  })

  test('keeps old terminal cache entries so hydrate can normalize them', () => {
    const now = Date.now()
    const raw = cachedRepo(now) as any
    raw.ui.detailTab = 'terminal'

    const normalized = normalizeRepoCache({ repo: raw })

    expect(normalized.repo?.ui.detailTab).toBe('terminal')
  })

  test('normalizes cached branch worktree metadata into canonical worktree state', () => {
    const now = Date.now()
    const raw = cachedRepo(now)
    raw.data.branches = [createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })]
    raw.data.worktreesByPath = {
      '/tmp/worktree-a': {
        path: '/tmp/worktree-a',
        branch: 'feature/a',
        isMain: true,
        isDirty: true,
        changeCount: 2,
        isLocked: true,
      },
    }

    const normalized = normalizeRepoCache({ repo: raw })

    expect(normalized.repo?.data.branches[0]?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(normalized.repo?.data.worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isMain: true,
      isDirty: true,
      changeCount: 2,
      isLocked: true,
    })
  })
})

describe('persistRepoCache', () => {
  test('does not write a stale cache entry after the repo instance changes', () => {
    const staleRepo = seedRepoState({
      id: '/repo',
      instanceToken: 1,
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
      selectedBranch: 'main',
    })
    seedRepoState({ id: '/repo', instanceToken: 2 })

    persistRepoCache(useReposStore.setState, staleRepo, 1)

    expect(useReposStore.getState().repoCache['/repo']).toBeUndefined()
  })

  test('does not persist remote repo diagnostics or secret-like transient data', () => {
    const repo = seedRepoState({
      id: REMOTE_TARGET.id,
      name: REMOTE_TARGET.displayName,
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
      statusLoaded: true,
    })
    const remoteRepo = {
      ...repo,
      kind: 'remote' as const,
      remoteTarget: REMOTE_TARGET,
      diagnostics: {
        target: REMOTE_TARGET,
        ok: false,
        category: 'auth failed' as const,
        message: 'auth failed',
        details: 'Permission denied with sensitive stderr',
        stages: [],
      },
    }

    persistRepoCache(useReposStore.setState, remoteRepo, remoteRepo.instanceToken)

    expect(useReposStore.getState().repoCache[REMOTE_TARGET.id]).toBeUndefined()
    expect(JSON.stringify(useReposStore.getState().repoCache)).not.toMatch(/Permission denied|stderr|password|secret/)
  })

  test('persists worktree state outside branch state', () => {
    const repo = seedRepoState({
      id: '/repo',
      instanceToken: 1,
      branchSnapshots: [
        createBranchSnapshot('feature/a', {
          worktree: {
            path: '/tmp/worktree-a',
            isPrimary: true,
            isLocked: true,
            summary: {
              dirty: true,
              changeCount: 2,
            },
          },
        }),
      ],
      currentBranch: 'feature/a',
      selectedBranch: 'feature/a',
    })

    persistRepoCache(useReposStore.setState, repo, 1)

    const cached = useReposStore.getState().repoCache['/repo']
    expect(cached?.data.branches[0]?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(cached?.data.worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isMain: true,
      isLocked: true,
      isDirty: true,
      changeCount: 2,
    })
  })
})

describe('repo store persistence', () => {
  test('normalizes persisted remote port configs without persisting sessions', () => {
    const normalized = normalizeRemotePortConfigMap({
      [REMOTE_TARGET.id]: [{ id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: 'dev' }],
    })

    expect(normalized).toEqual({
      [REMOTE_TARGET.id]: [{ id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: 'dev' }],
    })
    expect(JSON.stringify(normalized)).not.toMatch(/actualLocalPort|running|startedAt/)
  })

  test('rehydrates remote port forward configs from local storage', async () => {
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
          remotePortConfigsByRepo: {
            [REMOTE_TARGET.id]: [
              {
                id: 'cfg-1',
                remotePort: 3000,
                requestedLocalPort: null,
                label: 'dev server',
              },
            ],
          },
        },
        version: 0,
      }),
    )

    await useReposStore.persist.rehydrate()

    expect(useReposStore.getState().remotePortConfigsByRepo[REMOTE_TARGET.id]).toEqual([
      {
        id: 'cfg-1',
        remotePort: 3000,
        requestedLocalPort: null,
        label: 'dev server',
      },
    ])
  })
})

describe('hydrateCachedRepo', () => {
  test('hydrates branches without restoring worktree metadata fields', () => {
    const now = Date.now()
    const cached = cachedRepo(now)
    cached.data.branches = [createBranchSnapshot('feature/a', { worktree: { path: '/tmp/worktree-a' } })]
    cached.data.worktreesByPath = {
      '/tmp/worktree-a': {
        path: '/tmp/worktree-a',
        branch: 'feature/a',
        isMain: false,
        isDirty: true,
        changeCount: 2,
      },
    }

    const repo = hydrateCachedRepo(emptyRepo('/repo', 'repo'), cached)

    expect(repo.data.branches[0]?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(repo.data.worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isDirty: true,
      changeCount: 2,
    })
  })
})
