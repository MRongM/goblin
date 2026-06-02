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

  test('includes remote tracking branches that do not already have local branches', async () => {
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
            '__GOBLIN_REMOTE_TRACKING_BRANCHES__',
            ['origin/HEAD', 'abc1234', 'origin head', '2026-05-28T10:00:00Z', 'Ada', '', ''].join(FIELD_SEP),
            ['origin/feature/x', 'def5678', 'existing local', '2026-05-28T11:00:00Z', 'Lin', '', ''].join(FIELD_SEP),
            ['origin/feature/y', 'fed9876', 'remote only', '2026-05-28T12:00:00Z', 'Grace', '', ''].join(FIELD_SEP),
          ].join('\n'),
        }
      }
      return { ok: true, stderr: '', stdout: '' }
    })

    const snapshot = await getRemoteSnapshot(TARGET, { run })

    expect(snapshot?.branches.map((branch) => branch.name)).toEqual(['main', 'feature/x', 'origin/feature/y'])
    expect(snapshot?.branches.find((branch) => branch.name === 'origin/feature/y')).toMatchObject({
      remoteTracking: true,
      remoteName: 'origin',
      localName: 'feature/y',
      isCurrent: false,
    })
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
      worktree: {
        path: '/srv/goblin',
        isPrimary: true,
        summary: { dirty: false, changeCount: 0 },
      },
    })
    expect(snapshot?.branches.find((branch) => branch.name === 'feature/x')).toMatchObject({
      worktree: {
        path: '/srv/goblin-feature-x',
        isPrimary: false,
        summary: { dirty: true, changeCount: 2 },
      },
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

  test('does not render failed remote status reads as clean worktrees', async () => {
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
        return { ok: false, stderr: 'Permission denied', stdout: '', message: 'Permission denied' }
      }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(getRemoteStatus(TARGET, { run })).resolves.toEqual([
      { path: '/srv/goblin', branch: 'main', isMain: true, entries: [] },
    ])
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

describe('remote git commit detail', () => {
  test('reads remote commit metadata and file stats', async () => {
    const { getRemoteCommitDetail } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async (command) => {
      if (command.type === 'gitCommitMeta') {
        return {
          ok: true,
          stderr: '',
          stdout: [
            'abc123',
            'abc123',
            'Ada',
            'ada@example.com',
            '2026-05-28T10:00:00Z',
            'parent1 parent2',
            'Subject',
            'Body',
          ].join('\x1f'),
        }
      }
      if (command.type === 'gitCommitFileStats') {
        return { ok: true, stderr: '', stdout: '1\t2\tsrc/app.ts\0-\t-\tassets/logo.png\0' }
      }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(getRemoteCommitDetail(TARGET, 'abc123', { run })).resolves.toEqual({
      meta: {
        hash: 'abc123',
        shortHash: 'abc123',
        subject: 'Subject',
        body: 'Body',
        author: 'Ada',
        email: 'ada@example.com',
        date: '2026-05-28T10:00:00Z',
        parents: ['parent1', 'parent2'],
      },
      files: [
        { added: 1, deleted: 2, path: 'src/app.ts', binary: false },
        { added: 0, deleted: 0, path: 'assets/logo.png', binary: true },
      ],
    })
    expect(run).toHaveBeenCalledWith({ type: 'gitCommitMeta', path: '/srv/goblin', hash: 'abc123' }, TARGET, {
      signal: undefined,
      timeoutMs: 90_000,
    })
    expect(run).toHaveBeenCalledWith({ type: 'gitCommitFileStats', path: '/srv/goblin', hash: 'abc123' }, TARGET, {
      signal: undefined,
      timeoutMs: 90_000,
    })
  })

  test('returns null when remote commit metadata cannot be read', async () => {
    const { getRemoteCommitDetail } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({ ok: false, stderr: 'bad revision', stdout: '', message: 'bad revision' }))

    await expect(getRemoteCommitDetail(TARGET, 'missing', { run })).resolves.toBeNull()
  })
})

describe('remote worktree source inference', () => {
  test('infers source branches from remote reflog messages', async () => {
    const { getRemoteWorktreeSourceInferences } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async (command) => {
      if (command.type === 'gitBranchReflogMessages' && command.branch === 'feature/x') {
        return { ok: true, stderr: '', stdout: 'commit: work\nbranch: Created from main' }
      }
      if (command.type === 'gitBranchReflogMessages' && command.branch === 'feature/self') {
        return { ok: true, stderr: '', stdout: 'branch: Created from feature/self' }
      }
      return { ok: false, stderr: 'missing', stdout: '' }
    })

    await expect(
      getRemoteWorktreeSourceInferences(TARGET, ['feature/x', 'feature/self', 'bad branch'], { run }),
    ).resolves.toEqual([{ branch: 'feature/x', sourceBranch: 'main' }])
    expect(run).toHaveBeenCalledWith(
      { type: 'gitBranchReflogMessages', path: '/srv/goblin', branch: 'feature/x' },
      TARGET,
      { signal: undefined },
    )
  })
})

describe('remote git branch actions', () => {
  test('fetches all remotes from the remote repository path', async () => {
    const { fetchRemoteRepository } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({ ok: true, stdout: 'fetched', stderr: '' }))

    await expect(fetchRemoteRepository(TARGET, { run })).resolves.toEqual({
      ok: true,
      message: 'fetched',
    })

    expect(run).toHaveBeenCalledWith(
      { type: 'gitFetchAll', path: '/srv/goblin' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('checks out a branch in the provided remote worktree path', async () => {
    const { checkoutRemoteBranch } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({ ok: true, stdout: '', stderr: '' }))

    await expect(checkoutRemoteBranch(TARGET, 'feature/x', '/srv/goblin-feature-x', { run })).resolves.toEqual({
      ok: true,
      message: 'ok',
    })

    expect(run).toHaveBeenCalledWith(
      { type: 'gitCheckout', path: '/srv/goblin-feature-x', branch: 'feature/x' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('checks out a remote tracking branch on the SSH host repository path', async () => {
    const { checkoutRemoteTrackingBranchOnRemote } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({ ok: true, stdout: 'branch set up', stderr: '' }))

    await expect(checkoutRemoteTrackingBranchOnRemote(TARGET, 'origin/feature/x', { run })).resolves.toEqual({
      ok: true,
      message: 'branch set up',
    })

    expect(run).toHaveBeenCalledWith(
      {
        type: 'gitCheckoutRemoteTracking',
        path: '/srv/goblin',
        remoteBranch: 'origin/feature/x',
        localBranch: 'feature/x',
      },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('rejects malformed remote tracking branch checkout refs', async () => {
    const { checkoutRemoteTrackingBranchOnRemote } = await import('#/main/ssh/git.ts')
    const run = vi.fn()

    await expect(checkoutRemoteTrackingBranchOnRemote(TARGET, 'origin/HEAD', { run })).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(checkoutRemoteTrackingBranchOnRemote(TARGET, 'feature', { run })).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    expect(run).not.toHaveBeenCalled()
  })

  test('pushes a branch from the remote repository path', async () => {
    const { pushRemoteBranch } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({ ok: true, stdout: 'pushed', stderr: '' }))

    await expect(pushRemoteBranch(TARGET, 'feature/x', { run })).resolves.toEqual({
      ok: true,
      message: 'pushed',
    })

    expect(run).toHaveBeenCalledWith(
      { type: 'gitPush', path: '/srv/goblin', branch: 'feature/x' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('pulls a branch in its worktree path with fast-forward only', async () => {
    const { pullRemoteBranch } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({ ok: true, stdout: 'pulled', stderr: '' }))

    await expect(pullRemoteBranch(TARGET, 'feature/x', '/srv/goblin-feature-x', { run })).resolves.toEqual({
      ok: true,
      message: 'pulled',
    })

    expect(run).toHaveBeenCalledWith(
      { type: 'gitPullCurrent', path: '/srv/goblin-feature-x' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('builds remote copy-patch output for tracked and untracked files', async () => {
    const { getRemotePatch } = await import('#/main/ssh/git.ts')
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
      if (command.type === 'gitPatch') return { ok: true, stderr: '', stdout: 'diff --git a/tracked.txt b/tracked.txt' }
      if (command.type === 'gitStatusAll') return { ok: true, stderr: '', stdout: ' M tracked.txt\0?? new file.txt\0' }
      if (command.type === 'gitDiffNoIndex') {
        return { ok: true, stderr: '', stdout: 'diff --git a/new file.txt b/new file.txt\n+untracked' }
      }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(getRemotePatch(TARGET, '/srv/goblin-feature-x', { run })).resolves.toEqual({
      ok: true,
      message: 'diff --git a/tracked.txt b/tracked.txt\ndiff --git a/new file.txt b/new file.txt\n+untracked\n',
    })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitDiffNoIndex', path: '/srv/goblin-feature-x', filePath: 'new file.txt' },
      TARGET,
      { signal: undefined, timeoutMs: 90_000 },
    )
  })

  test('returns cancelled instead of partial patch output when aborted during untracked diff reads', async () => {
    const { getRemotePatch } = await import('#/main/ssh/git.ts')
    const ctrl = new AbortController()
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
      if (command.type === 'gitPatch') return { ok: true, stderr: '', stdout: 'diff --git a/tracked.txt b/tracked.txt' }
      if (command.type === 'gitStatusAll') return { ok: true, stderr: '', stdout: '?? new-a.txt\0?? new-b.txt\0' }
      if (command.type === 'gitDiffNoIndex' && command.filePath === 'new-a.txt') {
        ctrl.abort()
        return { ok: true, stderr: '', stdout: 'diff --git a/new-a.txt b/new-a.txt\n+partial' }
      }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(getRemotePatch(TARGET, '/srv/goblin-feature-x', { run, signal: ctrl.signal })).resolves.toEqual({
      ok: false,
      message: 'cancelled',
    })
  })

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
  })

  test('rejects dirty remote worktree removal', async () => {
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
        alsoDeleteBranch: true,
        forceDeleteBranch: false,
        run,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.cannot-remove-dirty-worktree' })
  })

  test('builds a remote GitHub pull request URL from origin', async () => {
    const { getRemoteGitHubUrl } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({ ok: true, stderr: '', stdout: 'git@github.com:nano-props/goblin.git' }))

    await expect(getRemoteGitHubUrl(TARGET, 'feature/x', { run })).resolves.toBe(
      'https://github.com/nano-props/goblin/pull/new/feature/x',
    )
  })

  test('rejects deleting a protected remote branch', async () => {
    const { deleteRemoteBranch } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({ ok: true, stderr: '', stdout: '' }))

    await expect(deleteRemoteBranch(TARGET, { branch: 'main', force: false, run })).resolves.toEqual({
      ok: false,
      message: 'error.cannot-delete-protected-branch',
    })
  })

  test('deletes remote upstream after deleting a remote branch when requested', async () => {
    const { deleteRemoteBranch } = await import('#/main/ssh/git.ts')
    const calls: string[] = []
    const run = vi.fn(async (command) => {
      calls.push(command.type)
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
            ['feature/x', 'def5678', 'feature work', '2026-05-28T11:00:00Z', 'Lin', 'origin/feature/x', ''].join(
              FIELD_SEP,
            ),
          ].join('\n'),
        }
      }
      if (command.type === 'gitUpstream') return { ok: true, stderr: '', stdout: 'origin/feature/x' }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(deleteRemoteBranch(TARGET, { branch: 'feature/x', alsoDeleteUpstream: true, run })).resolves.toEqual({
      ok: true,
      message: 'ok',
    })
    expect(calls).toEqual([
      'gitSnapshot',
      'gitWorktreeList',
      'gitUpstream',
      'gitIsAncestor',
      'gitUpstream',
      'gitBranchDelete',
      'gitPushDelete',
    ])
  })

  test('skips remote upstream delete for dot upstreams and missing upstreams', async () => {
    const { deleteRemoteBranch } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async (command) => {
      if (command.type === 'gitSnapshot') {
        return { ok: true, stderr: '', stdout: ['__GOBLIN_REMOTE_BRANCHES__'].join('\n') }
      }
      if (command.type === 'gitUpstream') return { ok: true, stderr: '', stdout: './feature/x' }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(
      deleteRemoteBranch(TARGET, { branch: 'feature/x', force: true, alsoDeleteUpstream: true, run }),
    ).resolves.toEqual({
      ok: true,
      message: 'ok',
    })
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitPushDelete' }), TARGET, expect.anything())
  })
})
