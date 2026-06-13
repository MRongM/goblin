import { describe, expect, test } from 'vitest'
import { checkoutBranchCandidates } from '#/web/components/branch-list/checkout-candidates.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

function branch(name: string, worktreePath?: string): RepoBranchState {
  return {
    name,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
    ...(worktreePath ? { worktree: { path: worktreePath } } : {}),
  }
}

describe('checkoutBranchCandidates', () => {
  test('excludes the target worktree current branch', () => {
    expect(checkoutBranchCandidates('feature/current', [branch('feature/current'), branch('feature/free')]).map((b) => b.name)).toEqual([
      'feature/free',
    ])
  })

  test('excludes branches checked out in any worktree', () => {
    const result = checkoutBranchCandidates('feature/current', [
      branch('feature/current', '/tmp/repo-current'),
      branch('feature/other-worktree', '/tmp/repo-other'),
      branch('feature/free'),
    ])

    expect(result.map((b) => b.name)).toEqual(['feature/free'])
  })

  test('does not mutate the source array', () => {
    const branches = [branch('feature/current', '/tmp/repo-current'), branch('feature/free')]
    const result = checkoutBranchCandidates('feature/current', branches)

    expect(result).not.toBe(branches)
    expect(branches.map((b) => b.name)).toEqual(['feature/current', 'feature/free'])
  })
})
