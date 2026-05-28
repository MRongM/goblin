/* @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchDetailContent } from '#/renderer/components/branch-detail/BranchDetailContent.tsx'
import { getSelectedBranchDetailPresentation } from '#/renderer/components/branch-detail/model.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { createBranch, resetReposStore } from '#/renderer/stores/repos/test-utils.ts'

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

function remoteRepo() {
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
  repo.data.branches = [createBranch('feature/x', { worktreePath: '/srv/goblin-feature-x' })]
  repo.ui.selectedBranch = 'feature/x'
  return repo
}

describe('BranchDetailContent remote resource retries', () => {
  let host: HTMLDivElement
  let root: Root
  let originalRefreshStatus: ReturnType<typeof useReposStore.getState>['refreshStatus']
  let originalRefreshBranchLog: ReturnType<typeof useReposStore.getState>['refreshBranchLog']
  let originalRefreshRemoteDiagnostics: ReturnType<typeof useReposStore.getState>['refreshRemoteDiagnostics']

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    resetReposStore()
    const state = useReposStore.getState()
    originalRefreshStatus = state.refreshStatus
    originalRefreshBranchLog = state.refreshBranchLog
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
      refreshStatus: originalRefreshStatus,
      refreshBranchLog: originalRefreshBranchLog,
      refreshRemoteDiagnostics: originalRefreshRemoteDiagnostics,
    })
  })

  test('retries only remote status from the changes panel', async () => {
    const repo = remoteRepo()
    repo.ui.detailTab = 'changes'
    repo.resources.status.error = 'status failed'
    const refreshStatus = vi.fn()
    const refreshRemoteDiagnostics = vi.fn()
    useReposStore.setState({ repos: { [repo.id]: repo }, refreshStatus, refreshRemoteDiagnostics })

    await act(async () => {
      root.render(
        <BranchDetailContent
          repo={repo}
          detail={getSelectedBranchDetailPresentation(repo)}
          detailId="detail"
          contentId="content"
          layout="top-bottom"
        />,
      )
    })

    expect(host.textContent).toContain('status failed')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(refreshStatus).toHaveBeenCalledWith(repo.id, { token: repo.instanceToken })
    expect(refreshRemoteDiagnostics).not.toHaveBeenCalled()
  })

  test('retries only remote branch log from the commits panel', async () => {
    const repo = remoteRepo()
    repo.ui.detailTab = 'commits'
    repo.resources.logsByBranch['feature/x'] = { phase: 'idle', loadedAt: null, error: 'log failed', stale: false }
    const refreshBranchLog = vi.fn()
    const refreshRemoteDiagnostics = vi.fn()
    useReposStore.setState({ repos: { [repo.id]: repo }, refreshBranchLog, refreshRemoteDiagnostics })

    await act(async () => {
      root.render(
        <BranchDetailContent
          repo={repo}
          detail={getSelectedBranchDetailPresentation(repo)}
          detailId="detail"
          contentId="content"
          layout="top-bottom"
        />,
      )
    })

    expect(host.textContent).toContain('log failed')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(refreshBranchLog).toHaveBeenCalledWith(repo.id, 'feature/x', { token: repo.instanceToken })
    expect(refreshRemoteDiagnostics).not.toHaveBeenCalled()
  })
})
