/* @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoActivityControl } from '#/renderer/components/repo-activity/RepoActivityControl.tsx'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { resetReposStore } from '#/renderer/stores/repos/test-utils.ts'

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
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

function remoteRepo(options: { hasRemotes?: boolean } = {}) {
  const repo = emptyRepo(REMOTE_TARGET.id, REMOTE_TARGET.displayName, {
    kind: 'remote',
    remoteTarget: REMOTE_TARGET,
  })
  repo.remote.hasRemotes = options.hasRemotes ?? true
  repo.remote.remotes = repo.remote.hasRemotes ? ['origin'] : []
  return repo
}

describe('RepoActivityControl remote refresh', () => {
  let host: HTMLDivElement
  let root: Root
  let originalSyncAndRefresh: ReturnType<typeof useReposStore.getState>['syncAndRefresh']

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    resetReposStore()
    originalSyncAndRefresh = useReposStore.getState().syncAndRefresh
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
    resetReposStore()
    useReposStore.setState({ syncAndRefresh: originalSyncAndRefresh })
  })

  test('shows a manual remote refresh button that syncs the remote repository', async () => {
    const repo = remoteRepo()
    const syncAndRefresh = vi.fn(async () => undefined)
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
      syncAndRefresh,
    })

    await act(async () => {
      root.render(<RepoActivityControl repoId={repo.id} />)
    })

    const button = host.querySelector<HTMLButtonElement>('button')
    expect(button).not.toBeNull()
    expect(button?.textContent).toBe('action.refresh-remote')
    expect(button?.getAttribute('aria-label')).toBe('action.refresh-remote-title')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(syncAndRefresh).toHaveBeenCalledWith(repo.id, { token: repo.instanceToken })
  })

  test('keeps the remote refresh button visible when the remote repository has no git remotes', async () => {
    const repo = remoteRepo({ hasRemotes: false })
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
    })

    await act(async () => {
      root.render(<RepoActivityControl repoId={repo.id} />)
    })

    const button = host.querySelector<HTMLButtonElement>('button')
    expect(button).not.toBeNull()
    expect(button?.textContent).toBe('action.refresh-remote')
  })
})
