/* @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoToolbar } from '#/renderer/components/repo-toolbar/RepoToolbar.tsx'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { resetReposStore } from '#/renderer/stores/repos/test-utils.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

const TARGET: RemoteRepoTarget = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: null,
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

function seedRemoteRepo() {
  const repo = emptyRepo(TARGET.id, 'prod:goblin', { kind: 'remote', remoteTarget: TARGET })
  useReposStore.setState({
    repos: { [repo.id]: repo },
    order: [repo.id],
    activeId: repo.id,
    sessionReady: true,
  })
  return repo
}

describe('RepoToolbar', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    resetReposStore()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
    resetReposStore()
  })

  test('rerenders when remote port sessions change', async () => {
    const repo = seedRemoteRepo()
    await act(async () => {
      root.render(<RepoToolbar repoId={repo.id} />)
    })

    const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label="remote-ports.title"]')
    expect(trigger()?.textContent).not.toContain('1')

    await act(async () => {
      useReposStore.setState((state) => {
        const current = state.repos[repo.id]
        if (!current) return state
        return {
          repos: {
            ...state.repos,
            [repo.id]: {
              ...current,
              remotePorts: {
                ...current.remotePorts,
                sessions: {
                  'cfg-1': {
                    configId: 'cfg-1',
                    repoId: repo.id,
                    remotePort: 3000,
                    requestedLocalPort: null,
                    actualLocalPort: 49152,
                    localHost: '127.0.0.1',
                    remoteHost: '127.0.0.1',
                    status: 'running',
                    startedAt: 123,
                  },
                },
              },
            },
          },
        }
      })
    })

    expect(trigger()?.textContent).toContain('1')
  })
})
