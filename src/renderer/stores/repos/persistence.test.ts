import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { normalizeRepoCache, persistRepoCache } from '#/renderer/stores/repos/persistence.ts'
import { createBranch, resetReposStore, seedRepoState } from '#/renderer/stores/repos/test-utils.ts'
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

  test('accepts old terminal cache entries so hydrate can normalize them to status', () => {
    const now = Date.now()
    const raw = cachedRepo(now)
    raw.ui.detailTab = 'terminal'

    const normalized = normalizeRepoCache({ repo: raw })

    expect(normalized.repo?.ui.detailTab).toBe('terminal')
  })
})

describe('persistRepoCache', () => {
  test('does not write a stale cache entry after the repo instance changes', () => {
    const staleRepo = seedRepoState({
      id: '/repo',
      instanceToken: 1,
      branches: [createBranch('main')],
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
      branches: [createBranch('main')],
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
