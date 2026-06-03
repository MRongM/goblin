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
  test('renders a full worktree path above commit metadata for worktree rows', () => {
    const repo = emptyRepo('/repo', 'repo')
    const selectedRef = { current: null }
    const html = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={createBranch('feature/x', {
          worktreePath: '/Users/example/project-feature',
          lastCommitMessage: 'Fix branch status',
          lastCommitAuthor: 'Test Author',
          lastCommitDate: '2026-06-03T10:00:00.000Z',
        })}
        selected="feature/x"
        current="main"
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
        showActions={false}
      />,
    )

    const pathIndex = html.indexOf('/Users/example/project-feature')
    const commitIndex = html.indexOf('Fix branch status')

    expect(pathIndex).toBeGreaterThan(-1)
    expect(commitIndex).toBeGreaterThan(-1)
    expect(pathIndex).toBeLessThan(commitIndex)
  })

  test('renders a full remote worktree path above commit metadata for SSH remote rows', () => {
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
    const selectedRef = { current: null }
    const html = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={createBranch('feature/x', {
          worktreePath: '/srv/goblin-feature-x',
          lastCommitMessage: 'Fix branch status',
          lastCommitAuthor: 'Test Author',
          lastCommitDate: '2026-06-03T10:00:00.000Z',
        })}
        selected="feature/x"
        current="main"
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
        showActions={false}
      />,
    )

    const pathIndex = html.indexOf('/srv/goblin-feature-x')
    const commitIndex = html.indexOf('Fix branch status')

    expect(pathIndex).toBeGreaterThan(-1)
    expect(commitIndex).toBeGreaterThan(-1)
    expect(pathIndex).toBeLessThan(commitIndex)
  })

  test('does not render a worktree path line for non-worktree rows', () => {
    const repo = emptyRepo('/repo', 'repo')
    const selectedRef = { current: null }
    const html = renderToStaticMarkup(
      <BranchRow
        repo={repo}
        branch={createBranch('feature/plain', {
          lastCommitMessage: 'Fix branch status',
          lastCommitAuthor: 'Test Author',
          lastCommitDate: '2026-06-03T10:00:00.000Z',
        })}
        selected="feature/plain"
        current="main"
        lang="en"
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={selectedRef}
        showActions={false}
      />,
    )

    expect(html).not.toContain('title="/repo"')
    expect(html).not.toContain('data-worktree-path')
  })

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
