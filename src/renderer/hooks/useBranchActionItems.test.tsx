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
  test('shows only editor and remove worktree for remote linked worktrees', () => {
    expect(visibleIds()).toEqual(['editor', 'removeWorktree'])
  })

  test('shows only editor for the primary remote worktree', () => {
    expect(
      visibleIds(remoteRepo(), createBranch('main', { worktreePath: '/srv/goblin', worktreeIsPrimary: true })),
    ).toEqual(['editor'])
  })

  test('shows no remote actions when there is no worktree path', () => {
    expect(visibleIds(remoteRepo(), createBranch('feature/x'))).toEqual([])
  })
})
