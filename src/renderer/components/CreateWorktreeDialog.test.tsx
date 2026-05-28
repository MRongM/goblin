import { describe, expect, test } from 'vitest'
import { defaultRemoteWorktreePath, isRemoteAbsolutePath } from '#/renderer/lib/paths.ts'

describe('remote worktree paths', () => {
  test('uses a sibling path based on remote repository path and branch slug', () => {
    expect(defaultRemoteWorktreePath('/srv/goblin', 'feat/new-ui')).toBe('/srv/goblin-feat-new-ui')
    expect(defaultRemoteWorktreePath('/srv/goblin/', 'bugfix/JIRA-123')).toBe('/srv/goblin-bugfix-JIRA-123')
    expect(defaultRemoteWorktreePath('/', 'feat/root')).toBe('/feat-root')
  })

  test('validates remote absolute paths without local filesystem assumptions', () => {
    expect(isRemoteAbsolutePath('/srv/goblin-feature')).toBe(true)
    expect(isRemoteAbsolutePath('srv/goblin-feature')).toBe(false)
    expect(isRemoteAbsolutePath('/bad\0path')).toBe(false)
  })
})
