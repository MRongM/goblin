import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { useBranchActionItems } from '#/renderer/hooks/useBranchActionItems.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { createBranch } from '#/renderer/stores/repos/test-utils.ts'
import type { BranchInfo } from '#/renderer/types.ts'

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

vi.mock('#/renderer/stores/settings.ts', () => ({
  useSettingsStore: (selector: any) =>
    selector({
      terminalApp: 'auto',
      resolvedTerminalApp: 'terminal',
      terminalAvailable: true,
      editorApp: 'auto',
      resolvedEditorApp: 'vscode',
      editorAvailable: true,
    }),
}))

vi.mock('#/renderer/stores/repos/store.ts', () => ({
  useReposStore: (selector: any) =>
    selector({
      setLastResult: vi.fn(),
      runBranchAction: vi.fn(),
    }),
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

function visibleIds(repo = remoteRepo(), branch = createBranch('feature/x', { worktreePath: '/srv/goblin-feature-x' })) {
  const html = renderToStaticMarkup(<ActionItemProbe repo={repo} branch={branch} />)
  const encoded = html.match(/data-visible="([^"]*)"/)?.[1] ?? ''
  return encoded ? encoded.split(',') : []
}

function ActionItemProbe({ repo, branch }: { repo: RepoState; branch: BranchInfo }) {
  const groups = useBranchActionItems(repo, branch)
  const ids = [...groups.patchItems, ...groups.mainItems, ...groups.destructiveItems]
    .filter((item) => item.visible)
    .map((item) => item.id)
    .join(',')
  return <span data-visible={ids} />
}

function remoteRepo() {
  return emptyRepo(REMOTE_TARGET.id, REMOTE_TARGET.displayName, {
    kind: 'remote',
    remoteTarget: REMOTE_TARGET,
  })
}

describe('useBranchActionItems remote visibility', () => {
  test('shows remote worktree branch actions', () => {
    const repo = remoteRepo()
    repo.data.status = [
      {
        path: '/srv/goblin-feature-x',
        branch: 'feature/x',
        isMain: false,
        entries: [{ x: ' ', y: 'M', path: 'file.txt' }],
      },
    ]

    const ids = visibleIds(
      repo,
      createBranch('feature/x', {
        tracking: 'origin/feature/x',
        worktreePath: '/srv/goblin-feature-x',
      }),
    )

    expect(ids).toEqual(
      expect.arrayContaining(['copyPatch', 'pull', 'push', 'terminal', 'editor', 'github', 'removeWorktree']),
    )
    expect(ids).not.toContain('deleteBranch')
  })

  test('shows remote plain branch actions', () => {
    const ids = visibleIds(remoteRepo(), createBranch('feature/plain'))

    expect(ids).toEqual(expect.arrayContaining(['checkout', 'push', 'github', 'deleteBranch']))
    expect(ids).not.toContain('terminal')
    expect(ids).not.toContain('removeWorktree')
  })

  test('shows only local checkout action for local remote tracking branches', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const ids = visibleIds(
      repo,
      createBranch('origin/feature/x', {
        remoteTracking: true,
        remoteName: 'origin',
        localName: 'feature/x',
      }),
    )

    expect(ids).toContain('checkoutRemoteBranch')
    expect(ids).toContain('github')
    expect(ids).not.toContain('checkout')
    expect(ids).not.toContain('pull')
    expect(ids).not.toContain('push')
    expect(ids).not.toContain('deleteBranch')
    expect(ids).not.toContain('removeWorktree')
    expect(ids).not.toContain('terminal')
    expect(ids).not.toContain('editor')
  })
})
