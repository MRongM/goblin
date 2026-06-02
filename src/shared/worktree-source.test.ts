import { describe, expect, test } from 'vitest'
import {
  inferWorktreeSourceFromReflogMessages,
  parseWorktreeSourceFromReflog,
  validWorktreeSourceInfo,
  worktreeSourceKey,
} from '#/shared/worktree-source.ts'

describe('worktree source metadata', () => {
  test('keys source entries by branch and worktree path', () => {
    expect(worktreeSourceKey('feature/a', '/repo-feature-a')).toBe('feature/a\0/repo-feature-a')
  })

  test('parses the first safe Created from reflog message', () => {
    const messages = [
      'commit: keep working',
      'branch: Created from -bad',
      'branch: Created from refs/heads/main',
    ].join('\n')

    expect(parseWorktreeSourceFromReflog(messages, 'feature/a')).toBe('main')
  })

  test('ignores malformed, self-referential, and unsafe reflog messages', () => {
    expect(parseWorktreeSourceFromReflog('branch: Created from feature/a', 'feature/a')).toBeNull()
    expect(parseWorktreeSourceFromReflog('checkout: moving from main to feature/a', 'feature/a')).toBeNull()
    expect(parseWorktreeSourceFromReflog('branch: Created from -bad', 'feature/a')).toBeNull()
  })

  test('infers branch source metadata from reflog messages', () => {
    expect(inferWorktreeSourceFromReflogMessages('feature/a', 'branch: Created from main')).toEqual({
      branch: 'feature/a',
      sourceBranch: 'main',
    })
  })

  test('validates persisted source entries', () => {
    expect(
      validWorktreeSourceInfo({
        branch: 'feature/a',
        worktreePath: '/repo-feature-a',
        sourceBranch: 'main',
        confidence: 'exact',
        updatedAt: 100,
      }),
    ).toBe(true)
    expect(
      validWorktreeSourceInfo({
        branch: 'feature/a',
        worktreePath: '',
        sourceBranch: 'main',
        confidence: 'exact',
        updatedAt: 100,
      }),
    ).toBe(false)
    expect(
      validWorktreeSourceInfo({
        branch: 'feature/a',
        worktreePath: '/repo-feature-a',
        sourceBranch: 'feature/a',
        confidence: 'inferred',
        updatedAt: 100,
      }),
    ).toBe(false)
  })
})
