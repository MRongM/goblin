import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { RepoToolbarActions } from '#/renderer/components/repo-toolbar/RepoToolbarActions.tsx'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { createBranch, installGoblinTestBridge } from '#/renderer/stores/repos/test-utils.ts'

const storeMock = vi.hoisted(() => ({
  repos: {} as Record<string, unknown>,
}))

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

vi.mock('#/renderer/components/repo-activity/RepoActivityControl.tsx', () => ({
  RepoActivityControl: () => 'action.refresh-remote',
}))

vi.mock('#/renderer/stores/repos/store.ts', () => ({
  useReposStore: (selector: any) =>
    selector({
      repos: storeMock.repos,
      runBranchAction: vi.fn(),
      refreshAll: vi.fn(),
      refreshRemoteDiagnostics: vi.fn(),
      syncAndRefresh: vi.fn(),
      addRemotePortForward: vi.fn(),
      removeRemotePortForward: vi.fn(),
      startRemotePortForward: vi.fn(),
      stopRemotePortForward: vi.fn(),
      scanRemotePorts: vi.fn(),
    }),
}))

describe('RepoToolbarActions', () => {
  test('shows refresh, diagnostics retry, and create worktree for remote repositories', () => {
    const repo = emptyRepo('ssh://deploy@prod:22/srv/goblin', 'prod:goblin', {
      kind: 'remote',
      remoteTarget: {
        id: 'ssh://deploy@prod:22/srv/goblin',
        alias: null,
        host: 'prod',
        user: 'deploy',
        port: 22,
        remotePath: '/srv/goblin',
        displayName: 'prod:goblin',
      },
    })
    storeMock.repos = { [repo.id]: repo }

    const html = renderToStaticMarkup(<RepoToolbarActions repoId={repo.id} />)

    expect(html).toContain('action.refresh-remote')
    expect(html).toContain('remote-ports.button')
    expect(html).not.toContain('action.fetch')
    expect(html).toContain('action.create-worktree')
    expect(html).toContain('action.retry')
  })

  test('shows checkout locally when local remote tracking branches are available', () => {
    installGoblinTestBridge({})
    const repo = emptyRepo('/tmp/goblin', 'goblin')
    repo.data.currentBranch = 'main'
    repo.data.branches = [
      createBranch('main', { worktreePath: '/tmp/goblin' }),
      createBranch('origin/feature/x', {
        remoteTracking: true,
        remoteName: 'origin',
        localName: 'feature/x',
      }),
    ]
    repo.ui.selectedBranch = 'main'
    storeMock.repos = { [repo.id]: repo }

    const html = renderToStaticMarkup(<RepoToolbarActions repoId={repo.id} />)

    expect(html).toContain('action.checkout-locally')
  })

  test('shows server checkout when remote repository tracking branches are available', () => {
    installGoblinTestBridge({})
    const repo = emptyRepo('ssh://deploy@prod:22/srv/goblin', 'prod:goblin', {
      kind: 'remote',
      remoteTarget: {
        id: 'ssh://deploy@prod:22/srv/goblin',
        alias: null,
        host: 'prod',
        user: 'deploy',
        port: 22,
        remotePath: '/srv/goblin',
        displayName: 'prod:goblin',
      },
    })
    repo.data.currentBranch = 'main'
    repo.data.branches = [
      createBranch('main', { worktreePath: '/srv/goblin' }),
      createBranch('origin/feature/x', {
        remoteTracking: true,
        remoteName: 'origin',
        localName: 'feature/x',
      }),
    ]
    storeMock.repos = { [repo.id]: repo }

    const html = renderToStaticMarkup(<RepoToolbarActions repoId={repo.id} />)

    expect(html).toContain('action.checkout-on-server')
  })
})
