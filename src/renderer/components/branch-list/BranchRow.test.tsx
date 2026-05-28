import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { BranchRow } from '#/renderer/components/branch-list/BranchRow.tsx'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { createBranch } from '#/renderer/stores/repos/test-utils.ts'

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

vi.mock('#/renderer/components/BranchActionsMenu.tsx', () => ({
  BranchActionsMenu: () => <span data-actions="branch-actions" />,
}))

describe('BranchRow action gate', () => {
  test('renders row actions only when showActions is true', () => {
    const repo = emptyRepo('/repo', 'repo')
    const branch = createBranch('feature/x', { worktreePath: '/repo-feature-x' })
    const selectedRef = { current: null }

    const withActions = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={branch}
        selected="feature/x"
        current="main"
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
        showActions
      />,
    )
    const withoutActions = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={branch}
        selected="feature/x"
        current="main"
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
        showActions={false}
      />,
    )

    expect(withActions).toContain('data-actions="branch-actions"')
    expect(withoutActions).not.toContain('data-actions="branch-actions"')
  })
})
