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
      stdout: ['__GOBLIN_REMOTE_CURRENT__', '', '__GOBLIN_REMOTE_DEFAULT__', '', '__GOBLIN_REMOTE_BRANCHES__'].join(
        '\n',
      ),
    }))

    await expect(getRemoteSnapshot(TARGET, { run })).resolves.toEqual({ branches: [], current: '' })
  })

  test('remote snapshot merges worktree metadata and dirty counts', async () => {
    const { getRemoteSnapshot } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async (command) => {
      if (command.type === 'gitSnapshot') {
        return {
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
        }
      }
      if (command.type === 'gitWorktreeList') {
        return {
          ok: true,
          stderr: '',
          stdout: [
            'worktree /srv/goblin',
            'HEAD abc1234',
            'branch refs/heads/main',
            '',
            'worktree /srv/goblin-feature-x',
            'HEAD def5678',
            'branch refs/heads/feature/x',
          ].join('\n'),
        }
      }
      if (command.type === 'gitStatus' && command.path === '/srv/goblin-feature-x') {
        return { ok: true, stderr: '', stdout: ' M file.txt\0?? new.txt\0' }
      }
      return { ok: true, stderr: '', stdout: '' }
    })

    const snapshot = await getRemoteSnapshot(TARGET, { run })

    expect(snapshot?.branches.find((branch) => branch.name === 'main')).toMatchObject({
      worktreePath: '/srv/goblin',
      worktreeIsPrimary: true,
      worktreeDirty: false,
      worktreeChangeCount: 0,
    })
    expect(snapshot?.branches.find((branch) => branch.name === 'feature/x')).toMatchObject({
      worktreePath: '/srv/goblin-feature-x',
      worktreeIsPrimary: false,
      worktreeDirty: true,
      worktreeChangeCount: 2,
    })
  })

  test('reads remote status for all non-bare worktrees', async () => {
    const { getRemoteStatus } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async (command) => {
      if (command.type === 'gitWorktreeList') {
        return {
          ok: true,
          stderr: '',
          stdout: [
            'worktree /srv/goblin',
            'HEAD abc1234',
            'branch refs/heads/main',
            '',
            'worktree /srv/goblin-feature-x',
            'HEAD def5678',
            'branch refs/heads/feature/x',
          ].join('\n'),
        }
      }
      if (command.type === 'gitStatus' && command.path === '/srv/goblin-feature-x') {
        return { ok: true, stderr: '', stdout: ' M file.txt\0?? new.txt\0' }
      }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(getRemoteStatus(TARGET, { run })).resolves.toEqual([
      { path: '/srv/goblin', branch: 'main', isMain: true, entries: [] },
      {
        path: '/srv/goblin-feature-x',
        branch: 'feature/x',
        isMain: false,
        entries: [
          { x: ' ', y: 'M', path: 'file.txt' },
          { x: '?', y: '?', path: 'new.txt' },
        ],
      },
    ])
  })

  test('runs remote fetch and worktree creation as ExecResult operations', async () => {
    const { createRemoteWorktree, fetchRemoteRepository } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({ ok: true, stdout: '', stderr: '' }))

    await expect(fetchRemoteRepository(TARGET, { run })).resolves.toEqual({ ok: true, message: 'ok' })
    await expect(
      createRemoteWorktree(TARGET, {
        worktreePath: '/srv/goblin-feature-x',
        newBranch: 'feature/x',
        baseBranch: 'main',
        run,
      }),
    ).resolves.toEqual({ ok: true, message: 'ok' })

    expect(run).toHaveBeenCalledWith({ type: 'gitFetch', path: '/srv/goblin' }, TARGET, { signal: undefined })
    expect(run).toHaveBeenCalledWith(
      {
        type: 'gitWorktreeAdd',
        path: '/srv/goblin',
        worktreePath: '/srv/goblin-feature-x',
        newBranch: 'feature/x',
        baseBranch: 'main',
      },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('reads remote logs with pagination args', async () => {
    const { getRemoteLog } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({
      ok: true,
      stderr: '',
      stdout: ['hash1', 'h1', 'message', 'Ada', '2026-05-28T10:00:00Z'].join(FIELD_SEP),
    }))

    await expect(getRemoteLog(TARGET, 'feature/x', 30, 60, { run })).resolves.toEqual([
      {
        hash: 'hash1',
        shortHash: 'h1',
        message: 'message',
        author: 'Ada',
        date: '2026-05-28T10:00:00Z',
      },
    ])
    expect(run).toHaveBeenCalledWith(
      { type: 'gitLog', path: '/srv/goblin', branch: 'feature/x', count: 30, skip: 60 },
      TARGET,
      { signal: undefined },
    )
  })
})

describe('remote git worktree removal', () => {
  test('removes a clean non-primary remote worktree without deleting the branch', async () => {
    const { removeRemoteWorktree } = await import('#/main/ssh/git.ts')
    const calls: string[] = []
    const run = vi.fn(async (command) => {
      calls.push(command.type)
      if (command.type === 'gitWorktreeList') {
        return {
          ok: true,
          stderr: '',
          stdout: [
            'worktree /srv/goblin',
            'HEAD abc1234',
            'branch refs/heads/main',
            '',
            'worktree /srv/goblin-feature-x',
            'HEAD def5678',
            'branch refs/heads/feature/x',
          ].join('\n'),
        }
      }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(
      removeRemoteWorktree(TARGET, {
        branch: 'feature/x',
        worktreePath: '/srv/goblin-feature-x',
        alsoDeleteBranch: false,
        forceDeleteBranch: false,
        run,
      }),
    ).resolves.toEqual({ ok: true, message: 'ok' })

    expect(calls).toEqual(['gitWorktreeList', 'gitStatus', 'gitWorktreeRemove'])
    expect(run).toHaveBeenCalledWith(
      { type: 'gitWorktreeRemove', path: '/srv/goblin', worktreePath: '/srv/goblin-feature-x' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('removes a clean remote worktree and deletes the branch after safe ancestor check', async () => {
    const { removeRemoteWorktree } = await import('#/main/ssh/git.ts')
    const calls: string[] = []
    const run = vi.fn(async (command) => {
      calls.push(command.type)
      if (command.type === 'gitWorktreeList') {
        return {
          ok: true,
          stderr: '',
          stdout: [
            'worktree /srv/goblin',
            'HEAD abc1234',
            'branch refs/heads/main',
            '',
            'worktree /srv/goblin-feature-x',
            'HEAD def5678',
            'branch refs/heads/feature/x',
          ].join('\n'),
        }
      }
      if (command.type === 'gitUpstream') return { ok: true, stderr: '', stdout: 'origin/feature/x' }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(
      removeRemoteWorktree(TARGET, {
        branch: 'feature/x',
        worktreePath: '/srv/goblin-feature-x',
        alsoDeleteBranch: true,
        forceDeleteBranch: false,
        run,
      }),
    ).resolves.toEqual({ ok: true, message: 'ok' })

    expect(calls).toEqual([
      'gitWorktreeList',
      'gitStatus',
      'gitUpstream',
      'gitIsAncestor',
      'gitWorktreeRemove',
      'gitBranchDelete',
    ])
    expect(run).toHaveBeenCalledWith(
      { type: 'gitBranchDelete', path: '/srv/goblin', branch: 'feature/x', force: false },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('rejects dirty remote worktree removal before running destructive commands', async () => {
    const { removeRemoteWorktree } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async (command) => {
      if (command.type === 'gitWorktreeList') {
        return {
          ok: true,
          stderr: '',
          stdout: [
            'worktree /srv/goblin',
            'HEAD abc1234',
            'branch refs/heads/main',
            '',
            'worktree /srv/goblin-feature-x',
            'HEAD def5678',
            'branch refs/heads/feature/x',
          ].join('\n'),
        }
      }
      if (command.type === 'gitStatus') return { ok: true, stderr: '', stdout: ' M file.txt\0' }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(
      removeRemoteWorktree(TARGET, {
        branch: 'feature/x',
        worktreePath: '/srv/goblin-feature-x',
        alsoDeleteBranch: false,
        forceDeleteBranch: false,
        run,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.cannot-remove-dirty-worktree' })

    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitWorktreeRemove' }), TARGET, expect.anything())
  })

  test.each([
    {
      name: 'primary worktree',
      list: ['worktree /srv/goblin', 'HEAD abc1234', 'branch refs/heads/main'].join('\n'),
      branch: 'main',
      worktreePath: '/srv/goblin',
      status: { ok: true, stderr: '', stdout: '' },
      message: 'error.cannot-remove-main-worktree',
    },
    {
      name: 'locked worktree',
      list: [
        'worktree /srv/goblin',
        'HEAD abc1234',
        'branch refs/heads/main',
        '',
        'worktree /srv/goblin-feature-x',
        'HEAD def5678',
        'branch refs/heads/feature/x',
        'locked',
      ].join('\n'),
      branch: 'feature/x',
      worktreePath: '/srv/goblin-feature-x',
      status: { ok: true, stderr: '', stdout: '' },
      message: 'error.cannot-remove-locked-worktree',
    },
    {
      name: 'missing worktree',
      list: ['worktree /srv/goblin', 'HEAD abc1234', 'branch refs/heads/main'].join('\n'),
      branch: 'feature/x',
      worktreePath: '/srv/goblin-feature-x',
      status: { ok: true, stderr: '', stdout: '' },
      message: 'error.worktree-not-found-for-branch',
    },
    {
      name: 'unknown dirty status',
      list: [
        'worktree /srv/goblin',
        'HEAD abc1234',
        'branch refs/heads/main',
        '',
        'worktree /srv/goblin-feature-x',
        'HEAD def5678',
        'branch refs/heads/feature/x',
      ].join('\n'),
      branch: 'feature/x',
      worktreePath: '/srv/goblin-feature-x',
      status: { ok: false, stderr: 'permission denied', stdout: '', message: 'permission denied' },
      message: 'error.cannot-remove-dirty-worktree',
    },
  ])('rejects $name before removal', async ({ list, branch, worktreePath, status, message }) => {
    const { removeRemoteWorktree } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async (command) => {
      if (command.type === 'gitWorktreeList') return { ok: true, stderr: '', stdout: list }
      if (command.type === 'gitStatus') return status
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(
      removeRemoteWorktree(TARGET, {
        branch,
        worktreePath,
        alsoDeleteBranch: false,
        forceDeleteBranch: false,
        run,
      }),
    ).resolves.toEqual({ ok: false, message })

    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitWorktreeRemove' }), TARGET, expect.anything())
  })

  test('returns force confirmation error when branch deletion is not safely allowed', async () => {
    const { removeRemoteWorktree } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async (command) => {
      if (command.type === 'gitWorktreeList') {
        return {
          ok: true,
          stderr: '',
          stdout: [
            'worktree /srv/goblin',
            'HEAD abc1234',
            'branch refs/heads/main',
            '',
            'worktree /srv/goblin-feature-x',
            'HEAD def5678',
            'branch refs/heads/feature/x',
          ].join('\n'),
        }
      }
      if (command.type === 'gitUpstream') return { ok: true, stderr: '', stdout: '' }
      if (command.type === 'gitIsAncestor') return { ok: false, stderr: '', stdout: '', message: 'not ancestor' }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(
      removeRemoteWorktree(TARGET, {
        branch: 'feature/x',
        worktreePath: '/srv/goblin-feature-x',
        alsoDeleteBranch: true,
        forceDeleteBranch: false,
        run,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.cannot-remove-unpushed-worktree' })

    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitWorktreeRemove' }), TARGET, expect.anything())
  })
})
