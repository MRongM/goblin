import { describe, expect, test, vi } from 'vitest'
import { realpath } from 'node:fs/promises'
import {
  getBranches,
  getBranchWorktreeIdentities,
  getCurrentBranch,
  getLog,
  deleteBranch,
  deleteUpstreamBranch,
  resolveRepoCommonDir,
  resolveRepoObjectsDir,
  resolveGitWorkspacePath,
} from '#/system/git/branches.ts'
import { git, gitCommandResultWithOptions } from '#/system/git/git-exec.ts'
import { nativePathForTest } from '#/test-utils/workspace-id.ts'

const REPO_PATH = nativePathForTest('/repo')
const REPO_WORKTREE_PATH = nativePathForTest('/repo/worktree')
const PHYSICAL_REPO_WORKTREE_PATH = nativePathForTest('/physical/repo/worktree')
const BARE_REPO_PATH = nativePathForTest('/repo.git')
const PHYSICAL_BARE_REPO_PATH = nativePathForTest('/physical/repo.git')
const PHYSICAL_COMMON_DIR = nativePathForTest('/physical/repo/.git')
const PHYSICAL_OBJECTS_DIR = nativePathForTest('/physical/object-store')

vi.mock('#/system/git/git-exec.ts', () => ({
  git: vi.fn(),
  gitCommandResultWithOptions: vi.fn(),
  NETWORK_TIMEOUT_MS: 30_000,
}))

vi.mock('node:fs/promises', () => ({
  realpath: vi.fn(),
}))

describe('branch mutations', () => {
  test('preserves local branch deletion execution facts', async () => {
    vi.mocked(gitCommandResultWithOptions).mockResolvedValueOnce({
      result: { ok: false, message: 'delete failed' },
      execution: { status: 'failed' },
    })

    await expect(deleteBranch('/repo', 'feature/test')).resolves.toEqual({
      result: { ok: false, message: 'delete failed' },
      execution: { status: 'failed' },
    })
  })

  test('preserves upstream deletion execution facts', async () => {
    vi.mocked(gitCommandResultWithOptions).mockResolvedValueOnce({
      result: { ok: false, message: 'push failed' },
      execution: { status: 'timed-out' },
    })

    await expect(deleteUpstreamBranch('/repo', 'origin', 'feature/test')).resolves.toEqual({
      result: { ok: false, message: 'push failed' },
      execution: { status: 'timed-out' },
    })
  })
})

describe('getBranchWorktreeIdentities', () => {
  test('reads strict branch identity and maps known worktree paths', async () => {
    vi.mocked(git).mockResolvedValueOnce('main\nfeature/linked\nfeature/free')

    await expect(
      getBranchWorktreeIdentities('/repo', [
        {
          path: '/repo',
          head: { kind: 'branch', branchName: 'main' },
          headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          materializedBranch: 'main',
        },
        {
          path: '/worktrees/linked',
          head: { kind: 'branch', branchName: 'feature/linked' },
          headOid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          materializedBranch: 'feature/linked',
        },
      ]),
    ).resolves.toEqual([
      {
        kind: 'git-worktree',
        worktreePath: '/repo',
        head: { kind: 'branch', branchName: 'main' },
        materializedBranch: 'main',
      },
      {
        kind: 'git-worktree',
        worktreePath: '/worktrees/linked',
        head: { kind: 'branch', branchName: 'feature/linked' },
        materializedBranch: 'feature/linked',
      },
      { kind: 'git-branch', branchName: 'feature/free' },
    ])
    expect(git).toHaveBeenCalledWith('/repo', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], {
      signal: undefined,
    })
  })

  test('does not turn a failed authority read into an empty catalog', async () => {
    vi.mocked(git).mockRejectedValueOnce(new Error('git unavailable'))
    await expect(getBranchWorktreeIdentities('/repo', [])).rejects.toThrow('git unavailable')
  })

  test('rejects whitespace-normalized branch identities', async () => {
    vi.mocked(git).mockResolvedValueOnce(' main')

    await expect(getBranchWorktreeIdentities('/repo', [])).rejects.toThrow('Git returned invalid branch identities')
  })

  test('keeps a detached local worktree without a branch ref', async () => {
    vi.mocked(git).mockResolvedValueOnce('')
    await expect(
      getBranchWorktreeIdentities('/repo', [
        {
          path: '/repo',
          head: { kind: 'detached' },
          headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          materializedBranch: null,
        },
      ]),
    ).resolves.toEqual([
      {
        kind: 'git-worktree',
        worktreePath: '/repo',
        head: { kind: 'detached' },
        materializedBranch: null,
      },
    ])
  })

  test('does not expose the branch retained by a detached worktree', async () => {
    vi.mocked(git).mockResolvedValueOnce('main\nfeature/in-progress')

    await expect(
      getBranchWorktreeIdentities('/repo', [
        {
          path: '/repo',
          head: { kind: 'detached' },
          headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          materializedBranch: 'feature/in-progress',
        },
      ]),
    ).resolves.toEqual([
      {
        kind: 'git-worktree',
        worktreePath: '/repo',
        head: { kind: 'detached' },
        materializedBranch: 'feature/in-progress',
      },
      { kind: 'git-branch', branchName: 'main' },
    ])
  })

  test('rejects a committed materialized branch missing from local refs', async () => {
    vi.mocked(git).mockResolvedValueOnce('main')

    await expect(
      getBranchWorktreeIdentities('/repo', [
        {
          path: '/repo',
          head: { kind: 'detached' },
          headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          materializedBranch: 'feature/missing',
        },
      ]),
    ).rejects.toThrow('Git worktree materialized branch is unavailable')
  })
})

describe('getLog', () => {
  test.each([
    { target: { kind: 'branch' as const, branchName: 'feature/history' }, revision: 'refs/heads/feature/history' },
    {
      target: { kind: 'commit' as const, oid: '2222222222222222222222222222222222222222' },
      revision: '2222222222222222222222222222222222222222',
    },
  ])('resolves a $target.kind target only at the Git command boundary', async ({ target, revision }) => {
    vi.mocked(git).mockResolvedValueOnce('')

    await expect(getLog('/repo', target, 20, 5)).resolves.toEqual([])

    expect(git).toHaveBeenLastCalledWith(
      '/repo',
      expect.arrayContaining(['log', '-n', '20', '--skip', '5', revision, '--']),
      { signal: undefined },
    )
  })
})

describe('authoritative snapshot reads', () => {
  test('represents detached HEAD explicitly', async () => {
    vi.mocked(git).mockResolvedValueOnce('')
    await expect(getCurrentBranch('/repo')).resolves.toBeNull()
  })

  test('preserves an unborn branch as authoritative current state', async () => {
    vi.mocked(git).mockResolvedValueOnce('main')
    await expect(getCurrentBranch('/repo')).resolves.toBe('main')
    expect(git).toHaveBeenCalledWith('/repo', ['branch', '--show-current'], { signal: undefined })
  })

  test('does not turn a failed branch projection into an empty branch list', async () => {
    vi.mocked(git).mockImplementation(async (_cwd, args) => {
      if (args[0] === 'for-each-ref') throw new Error('branch read failed')
      return ''
    })

    await expect(getBranches('/repo')).rejects.toThrow('branch read failed')
  })
})

describe('repository common directory', () => {
  test('resolves a non-bare workspace through its physical top level', async () => {
    vi.mocked(git).mockResolvedValueOnce('false').mockResolvedValueOnce(REPO_WORKTREE_PATH)
    vi.mocked(realpath).mockResolvedValueOnce(PHYSICAL_REPO_WORKTREE_PATH)

    await expect(resolveGitWorkspacePath(nativePathForTest('/repo/worktree/subdir'))).resolves.toBe(
      PHYSICAL_REPO_WORKTREE_PATH,
    )
  })

  test('uses the physical common directory for a bare workspace', async () => {
    vi.mocked(git).mockResolvedValueOnce('true').mockResolvedValueOnce('.')
    vi.mocked(realpath).mockResolvedValueOnce(PHYSICAL_BARE_REPO_PATH)

    await expect(resolveGitWorkspacePath(BARE_REPO_PATH)).resolves.toBe(PHYSICAL_BARE_REPO_PATH)
  })

  test('normalizes a confirmed common directory', async () => {
    vi.mocked(git).mockResolvedValueOnce('../.git')
    vi.mocked(realpath).mockResolvedValueOnce(PHYSICAL_COMMON_DIR)

    await expect(resolveRepoCommonDir(REPO_WORKTREE_PATH)).resolves.toBe(PHYSICAL_COMMON_DIR)
    expect(realpath).toHaveBeenCalledWith(nativePathForTest('/repo/.git'))
  })

  test('collapses filesystem aliases onto one physical common directory', async () => {
    vi.mocked(git).mockResolvedValue('.git')
    vi.mocked(realpath).mockResolvedValue(PHYSICAL_COMMON_DIR)

    const direct = await resolveRepoCommonDir(REPO_PATH)
    const alias = await resolveRepoCommonDir(nativePathForTest('/alias'))

    expect(direct).toBe(alias)
    expect(realpath).toHaveBeenNthCalledWith(1, nativePathForTest('/repo/.git'))
    expect(realpath).toHaveBeenNthCalledWith(2, nativePathForTest('/alias/.git'))
  })

  test('preserves authority read failures for strict callers', async () => {
    vi.mocked(git).mockRejectedValueOnce(new Error('git unavailable'))

    await expect(resolveRepoCommonDir('/repo')).rejects.toThrow('git unavailable')
  })
})

describe('repository objects directory', () => {
  test('resolves the effective object store through Git', async () => {
    vi.mocked(git).mockResolvedValueOnce('../../object-store')
    vi.mocked(realpath).mockResolvedValueOnce(PHYSICAL_OBJECTS_DIR)

    await expect(resolveRepoObjectsDir(REPO_WORKTREE_PATH)).resolves.toBe(PHYSICAL_OBJECTS_DIR)
    expect(git).toHaveBeenCalledWith(REPO_WORKTREE_PATH, ['rev-parse', '--git-path', 'objects'], { signal: undefined })
    expect(realpath).toHaveBeenCalledWith(nativePathForTest('/object-store'))
  })
})
