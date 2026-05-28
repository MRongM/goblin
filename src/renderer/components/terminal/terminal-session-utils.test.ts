import { describe, expect, test } from 'vitest'
import {
  isTerminalDescriptorLive,
  terminalDescriptor,
  terminalSessionGroupKey,
  terminalSessionKey,
} from '#/renderer/components/terminal/terminal-session-utils.ts'
import { createBranch, seedRepoState } from '#/renderer/stores/repos/test-utils.ts'
import type { ReposStore } from '#/renderer/stores/repos/types.ts'

const REMOTE_TARGET = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: null,
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

describe('terminal session utils', () => {
  test('builds stable worktree-scoped keys', () => {
    expect(terminalSessionGroupKey({ kind: 'local', repoRoot: '/repo', worktreePath: '/repo/worktree' })).toBe(
      'local\0/repo\0/repo/worktree',
    )
    expect(terminalSessionKey({ kind: 'local', repoRoot: '/repo', worktreePath: '/repo/worktree' }, 'terminal-1')).toBe(
      'local\0/repo\0/repo/worktree\0terminal-1',
    )
  })

  test('builds isolated remote terminal keys', () => {
    expect(
      terminalSessionGroupKey({ kind: 'remote', repoId: REMOTE_TARGET.id, worktreePath: '/srv/goblin-feature' }),
    ).toBe('remote\0ssh://deploy@prod:22/srv/goblin\0/srv/goblin-feature')
    expect(
      terminalSessionKey(
        { kind: 'remote', repoId: REMOTE_TARGET.id, worktreePath: '/srv/goblin-feature' },
        'terminal-1',
      ),
    ).toBe('remote\0ssh://deploy@prod:22/srv/goblin\0/srv/goblin-feature\0terminal-1')
  })

  test('checks whether a terminal descriptor still has a live worktree', () => {
    const repo = seedRepoState({
      id: '/repo',
      branches: [createBranch('main', { worktreePath: '/repo' }), createBranch('feature')],
    })
    const repos: ReposStore['repos'] = { '/repo': repo }

    expect(
      isTerminalDescriptorLive(
        repos,
        terminalDescriptor({ repoRoot: '/repo', branch: 'main', worktreePath: '/repo' }, 'terminal-1', 1),
      ),
    ).toBe(true)
    expect(
      isTerminalDescriptorLive(
        repos,
        terminalDescriptor({ repoRoot: '/repo', branch: 'missing', worktreePath: '/missing' }, 'terminal-1', 1),
      ),
    ).toBe(false)
  })

  test('checks remote terminal descriptor liveness by remote repo id and worktree path', () => {
    const descriptor = terminalDescriptor(
      {
        kind: 'remote',
        repoId: REMOTE_TARGET.id,
        target: REMOTE_TARGET,
        branch: 'feature',
        worktreePath: '/srv/goblin-feature',
      },
      'terminal-1',
      1,
    )

    expect(
      isTerminalDescriptorLive(
        {
          [REMOTE_TARGET.id]: {
            data: { branches: [{ name: 'feature', worktreePath: '/srv/goblin-feature' }] },
          } as any,
        },
        descriptor,
      ),
    ).toBe(true)
  })
})
