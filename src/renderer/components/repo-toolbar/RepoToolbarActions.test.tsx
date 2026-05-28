import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { RepoToolbarActions } from '#/renderer/components/repo-toolbar/RepoToolbarActions.tsx'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

vi.mock('#/renderer/stores/repos/store.ts', () => ({
  useReposStore: (selector: any) =>
    selector({
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

    const html = renderToStaticMarkup(<RepoToolbarActions repo={repo} />)

    expect(html).toContain('action.refresh-remote')
    expect(html).toContain('remote-ports.button')
    expect(html).not.toContain('action.fetch')
    expect(html).toContain('action.create-worktree')
    expect(html).toContain('action.retry')
  })
})
