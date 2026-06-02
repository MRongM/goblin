import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { BranchRow } from '#/renderer/components/branch-list/BranchRow.tsx'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { createBranch } from '#/renderer/stores/repos/test-utils.ts'

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params?.branch ? `${key}:${params.branch}` : key,
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

  test('renders exact and inferred worktree source labels only for worktree rows', () => {
    const repo = emptyRepo('/repo', 'repo')
    const selectedRef = { current: null }
    const worktreeBranch = createBranch('feature/x', { worktreePath: '/repo-feature-x' })
    const currentBranch = createBranch('main', { worktreePath: '/repo' })

    const exact = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={worktreeBranch}
        selected="feature/x"
        current="main"
        source={{
          branch: 'feature/x',
          worktreePath: '/repo-feature-x',
          sourceBranch: 'main',
          confidence: 'exact',
          updatedAt: 1,
        }}
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
        showActions={false}
      />,
    )
    const inferred = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={worktreeBranch}
        selected="feature/x"
        current="main"
        source={{
          branch: 'feature/x',
          worktreePath: '/repo-feature-x',
          sourceBranch: 'develop',
          confidence: 'inferred',
          updatedAt: 1,
        }}
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
        showActions={false}
      />,
    )
    const current = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={currentBranch}
        selected="main"
        current="main"
        source={{
          branch: 'main',
          worktreePath: '/repo',
          sourceBranch: 'develop',
          confidence: 'exact',
          updatedAt: 1,
        }}
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
        showActions={false}
      />,
    )

    expect(exact).toContain('branches.source-exact:main')
    expect(inferred).toContain('branches.source-inferred:develop')
    expect(current).not.toContain('branches.source-exact:develop')
  })
})
