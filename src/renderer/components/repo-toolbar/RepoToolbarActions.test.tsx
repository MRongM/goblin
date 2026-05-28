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
    }),
}))

describe('RepoToolbarActions', () => {
  test('shows read-only refresh and diagnostics retry for remote repositories', () => {
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
    expect(html).not.toContain('action.fetch')
    expect(html).not.toContain('action.create-worktree')
    expect(html).toContain('action.retry')
  })
})
