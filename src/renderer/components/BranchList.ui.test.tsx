/* @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchList } from '#/renderer/components/BranchList.tsx'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { resetReposStore } from '#/renderer/stores/repos/test-utils.ts'

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useI18nStore: (selector: any) => selector({ lang: 'en' }),
  useT: () => (key: string) => key,
}))

describe('BranchList remote snapshot failure', () => {
  let host: HTMLDivElement
  let root: Root
  let originalRefreshSnapshot: ReturnType<typeof useReposStore.getState>['refreshSnapshot']
  let originalRefreshRemoteDiagnostics: ReturnType<typeof useReposStore.getState>['refreshRemoteDiagnostics']

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    resetReposStore()
    const state = useReposStore.getState()
    originalRefreshSnapshot = state.refreshSnapshot
    originalRefreshRemoteDiagnostics = state.refreshRemoteDiagnostics
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
    resetReposStore()
    useReposStore.setState({
      refreshSnapshot: originalRefreshSnapshot,
      refreshRemoteDiagnostics: originalRefreshRemoteDiagnostics,
    })
  })

  test('retries only the remote snapshot resource from the empty state', async () => {
    const repo = emptyRepo('ssh://deploy@prod:22/srv/goblin', 'prod:goblin', {
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
    repo.resources.snapshot.error = 'error.failed-read-repo'
    const refreshSnapshot = vi.fn()
    const refreshRemoteDiagnostics = vi.fn()
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
      refreshSnapshot,
      refreshRemoteDiagnostics,
    })

    await act(async () => {
      root.render(<BranchList repoId={repo.id} />)
    })

    expect(host.textContent).toContain('error.failed-read-repo')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(refreshSnapshot).toHaveBeenCalledWith(repo.id, { token: repo.instanceToken })
    expect(refreshRemoteDiagnostics).not.toHaveBeenCalled()
  })
})
