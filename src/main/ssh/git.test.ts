import { describe, expect, test, vi } from 'vitest'
import { FIELD_SEP } from '#/main/git/parsers.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const TARGET: RemoteRepoTarget = {
  id: 'ssh://deploy@prod.example.com:22/srv/goblin',
  alias: null,
  host: 'prod.example.com',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod.example.com:goblin',
}

describe('remote git snapshot', () => {
  test('reads branches from a fixed remote snapshot command', async () => {
    const { getRemoteSnapshot } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({
      ok: true,
      stderr: '',
      stdout: [
        '__GOBLIN_REMOTE_CURRENT__',
        'main',
        '__GOBLIN_REMOTE_DEFAULT__',
        'main',
        '__GOBLIN_REMOTE_BRANCHES__',
        ['main', 'abc1234', 'initial commit', '2026-05-28T10:00:00Z', 'Ada', 'origin/main', ''].join(FIELD_SEP),
        ['feature/x', 'def5678', 'feature work', '2026-05-28T11:00:00Z', 'Lin', '', ''].join(FIELD_SEP),
      ].join('\n'),
    }))

    const snapshot = await getRemoteSnapshot(TARGET, { run })

    expect(run).toHaveBeenCalledWith({ type: 'gitSnapshot', path: '/srv/goblin' }, TARGET, { signal: undefined })
    expect(snapshot?.current).toBe('main')
    expect(snapshot?.branches.map((branch) => branch.name)).toEqual(['main', 'feature/x'])
    expect(snapshot?.branches[0]).toMatchObject({ name: 'main', isCurrent: true, isDefault: true })
    expect(snapshot?.branches[1]).toMatchObject({ name: 'feature/x', isCurrent: false })
  })

  test('returns an empty snapshot for a valid repository with no branches', async () => {
    const { getRemoteSnapshot } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({
      ok: true,
      stderr: '',
      stdout: [
        '__GOBLIN_REMOTE_CURRENT__',
        '',
        '__GOBLIN_REMOTE_DEFAULT__',
        '',
        '__GOBLIN_REMOTE_BRANCHES__',
      ].join('\n'),
    }))

    await expect(getRemoteSnapshot(TARGET, { run })).resolves.toEqual({ branches: [], current: '' })
  })
})
