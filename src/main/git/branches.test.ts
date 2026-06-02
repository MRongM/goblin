import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  checkoutBranch,
  checkoutRemoteTrackingBranch,
  deleteBranch,
  getBranches,
  getLog,
  getUpstream,
  getWorktreeSourceInferences,
  isAncestor,
  markDefaultBranch,
  markMergedToDefault,
  prioritizeDefaultBranch,
} from '#/main/git/branches.ts'
import { inferWorktreeSourceFromReflogMessages } from '#/shared/worktree-source.ts'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'

let templateRepo: string | null = null
let tmp: string | null = null

function branch(name: string): BranchSnapshotInfo {
  return {
    name,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
  }
}

function runGit(cwd: string, args: string[], seconds = 0): void {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: `2026-01-01T00:00:${String(seconds).padStart(2, '0')}+00:00`,
    GIT_COMMITTER_DATE: `2026-01-01T00:00:${String(seconds).padStart(2, '0')}+00:00`,
  }
  execFileSync('git', args, { cwd, env, stdio: 'ignore' })
}

function commitFile(cwd: string, file: string, value: string, message: string, seconds: number): void {
  writeFileSync(path.join(cwd, file), value)
  runGit(cwd, ['add', file], seconds)
  runGit(cwd, ['commit', '-q', '-m', message], seconds)
}

beforeAll(() => {
  templateRepo = mkdtempSync(path.join(os.tmpdir(), 'gbl-branches-template-'))
  runGit(templateRepo, ['init', '-b', 'main'])
  runGit(templateRepo, ['config', 'user.email', 'test@example.com'])
  runGit(templateRepo, ['config', 'user.name', 'Test User'])
  commitFile(templateRepo, 'README.md', 'initial\n', 'initial', 0)
})

afterAll(() => {
  if (templateRepo) rmSync(templateRepo, { recursive: true, force: true })
  templateRepo = null
})

function createRepo(): string {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-branches-test-'))
  cpSync(templateRepo!, tmp, { recursive: true })
  return tmp
}

function abortedSignal(): AbortSignal {
  const ctrl = new AbortController()
  ctrl.abort()
  return ctrl.signal
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

describe('prioritizeDefaultBranch', () => {
  test('moves the default branch to the top', () => {
    const result = prioritizeDefaultBranch([branch('feature/a'), branch('main'), branch('release')], 'main')
    expect(result.map((b) => b.name)).toEqual(['main', 'feature/a', 'release'])
  })

  test('preserves order when the default branch is absent', () => {
    const result = prioritizeDefaultBranch([branch('feature/a'), branch('release')], 'main')
    expect(result.map((b) => b.name)).toEqual(['feature/a', 'release'])
  })

  test('preserves order when no default branch is known', () => {
    const result = prioritizeDefaultBranch([branch('feature/a'), branch('main')], '')
    expect(result.map((b) => b.name)).toEqual(['feature/a', 'main'])
  })
})

describe('markDefaultBranch', () => {
  test('marks only the default branch', () => {
    const result = markDefaultBranch([branch('feature/a'), branch('main')], 'main')
    expect(result.find((b) => b.name === 'feature/a')?.isDefault).toBeUndefined()
    expect(result.find((b) => b.name === 'main')?.isDefault).toBe(true)
  })

  test('clears stale default markers', () => {
    const result = markDefaultBranch([{ ...branch('feature/a'), isDefault: true }, branch('main')], 'main')
    expect(result.find((b) => b.name === 'feature/a')?.isDefault).toBeUndefined()
    expect(result.find((b) => b.name === 'main')?.isDefault).toBe(true)
  })

  test('preserves branches when no default branch is known', () => {
    const branches = [branch('feature/a'), branch('main')]
    expect(markDefaultBranch(branches, '')).toBe(branches)
  })

  test('clears stale default markers when no default branch is known', () => {
    const [result] = markDefaultBranch([{ ...branch('feature/a'), isDefault: true }], '')
    expect(result?.isDefault).toBeUndefined()
  })
})

describe('markMergedToDefault', () => {
  test('marks branches reachable from the default branch', () => {
    const result = markMergedToDefault(
      [branch('feature/a'), branch('feature/b'), branch('main')],
      'main',
      new Set(['feature/a', 'main']),
    )
    expect(result.find((b) => b.name === 'feature/a')?.mergedToDefault).toBe(true)
    expect(result.find((b) => b.name === 'feature/b')?.mergedToDefault).toBe(false)
    expect(result.find((b) => b.name === 'main')?.mergedToDefault).toBe(true)
  })

  test('preserves branches when no default branch is known', () => {
    const branches = [branch('feature/a')]
    expect(markMergedToDefault(branches, '', new Set(['feature/a']))).toBe(branches)
  })
})

describe('branch write operations', () => {
  test('does not checkout a branch when already aborted', async () => {
    const repo = createRepo()
    runGit(repo, ['branch', 'feature/aborted'])

    const result = await checkoutBranch(repo, 'feature/aborted', abortedSignal())

    expect(result).toEqual({ ok: false, message: 'cancelled' })
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('main')
  })

  test('does not delete a branch when already aborted', async () => {
    const repo = createRepo()
    runGit(repo, ['branch', 'feature/delete'])

    const result = await deleteBranch(repo, 'feature/delete', { force: true, signal: abortedSignal() })

    expect(result).toEqual({ ok: false, message: 'cancelled' })
    expect(execFileSync('git', ['branch', '--list', 'feature/delete'], { cwd: repo, encoding: 'utf8' }).trim()).toBe(
      'feature/delete',
    )
  })

  test('does not resolve an upstream when already aborted', async () => {
    const repo = createRepo()

    const result = await getUpstream(repo, 'main', abortedSignal())

    expect(result).toBeNull()
  })

  test('does not check ancestry when already aborted', async () => {
    const repo = createRepo()

    const result = await isAncestor(repo, 'main', 'HEAD', abortedSignal())

    expect(result).toBe(false)
  })
})

describe('worktree source inference', () => {
  test('parses clear branch creation reflog messages', () => {
    expect(inferWorktreeSourceFromReflogMessages('feature/x', 'commit: work\nbranch: Created from main')).toEqual({
      branch: 'feature/x',
      sourceBranch: 'main',
    })
    expect(inferWorktreeSourceFromReflogMessages('feature/x', 'branch: Created from refs/heads/main')).toEqual({
      branch: 'feature/x',
      sourceBranch: 'main',
    })
    expect(inferWorktreeSourceFromReflogMessages('feature/x', 'branch: Created from feature/x')).toBeNull()
    expect(inferWorktreeSourceFromReflogMessages('feature/x', 'branch: Created from bad branch')).toBeNull()
  })

  test('infers local branch source from git reflog', async () => {
    const repo = createRepo()
    runGit(repo, ['branch', 'feature/source', 'main'])

    await expect(getWorktreeSourceInferences(repo, ['feature/source'])).resolves.toEqual([
      { branch: 'feature/source', sourceBranch: 'main' },
    ])
  })
})

describe('remote tracking branches', () => {
  function createRepoWithOrigin(): { repo: string; remote: string } {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-branches-test-'))
    const repo = path.join(tmp, 'repo')
    const remote = path.join(tmp, 'origin.git')
    mkdirSync(repo)
    runGit(tmp, ['init', '--bare', remote])
    runGit(repo, ['init', '-b', 'main'])
    runGit(repo, ['config', 'user.email', 'test@example.com'])
    runGit(repo, ['config', 'user.name', 'Test User'])
    commitFile(repo, 'README.md', 'initial\n', 'initial', 0)
    runGit(repo, ['remote', 'add', 'origin', remote])
    runGit(repo, ['push', '-u', 'origin', 'main'])
    return { repo, remote }
  }

  test('includes remote tracking branches that do not have a local branch', async () => {
    const { repo } = createRepoWithOrigin()
    runGit(repo, ['switch', '-c', 'feature/x'])
    commitFile(repo, 'feature.txt', 'feature\n', 'feature work', 1)
    runGit(repo, ['push', '-u', 'origin', 'feature/x'])
    runGit(repo, ['switch', 'main'])
    runGit(repo, ['branch', '-D', 'feature/x'])
    runGit(repo, ['fetch', 'origin'])

    const branches = await getBranches(repo)

    expect(branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'origin/feature/x',
          remoteTracking: true,
          remoteName: 'origin',
          localName: 'feature/x',
        }),
      ]),
    )
  })

  test('hides remote tracking branches that already have a local branch', async () => {
    const { repo } = createRepoWithOrigin()
    runGit(repo, ['switch', '-c', 'feature/x'])
    commitFile(repo, 'feature.txt', 'feature\n', 'feature work', 1)
    runGit(repo, ['push', '-u', 'origin', 'feature/x'])
    runGit(repo, ['fetch', 'origin'])

    const branches = await getBranches(repo)

    expect(branches.some((branch) => branch.name === 'origin/feature/x')).toBe(false)
    expect(branches.some((branch) => branch.name === 'feature/x')).toBe(true)
  })

  test('checks out a remote tracking branch into a local tracking branch', async () => {
    const { repo } = createRepoWithOrigin()
    runGit(repo, ['switch', '-c', 'feature/x'])
    commitFile(repo, 'feature.txt', 'feature\n', 'feature work', 1)
    runGit(repo, ['push', '-u', 'origin', 'feature/x'])
    runGit(repo, ['switch', 'main'])
    runGit(repo, ['branch', '-D', 'feature/x'])
    runGit(repo, ['fetch', 'origin'])

    const result = await checkoutRemoteTrackingBranch(repo, 'origin/feature/x')

    expect(result.ok).toBe(true)
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('feature/x')
    expect(
      execFileSync('git', ['rev-parse', '--abbrev-ref', 'feature/x@{u}'], { cwd: repo, encoding: 'utf8' }).trim(),
    ).toBe('origin/feature/x')
  })

  test('rejects invalid remote tracking branch names', async () => {
    const { repo } = createRepoWithOrigin()

    await expect(checkoutRemoteTrackingBranch(repo, 'origin/-bad')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(checkoutRemoteTrackingBranch(repo, 'main')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
  })
})

describe('getLog', () => {
  test('paginates with the same ordering as the full branch log across merges', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-branches-test-'))
    runGit(tmp, ['init', '-q', '--initial-branch=main'])
    runGit(tmp, ['config', 'user.email', 'a@example.com'])
    runGit(tmp, ['config', 'user.name', 'A'])
    commitFile(tmp, 'main.txt', '1', 'main 1', 1)
    commitFile(tmp, 'main.txt', '2', 'main 2', 2)
    runGit(tmp, ['checkout', '-q', '-b', 'feature'])
    commitFile(tmp, 'feature.txt', '1', 'feature 1', 3)
    commitFile(tmp, 'feature.txt', '2', 'feature 2', 4)
    runGit(tmp, ['checkout', '-q', 'main'])
    commitFile(tmp, 'main.txt', '3', 'main 3', 5)
    runGit(tmp, ['merge', '-q', '--no-ff', 'feature', '-m', 'merge feature'], 6)

    const full = await getLog(tmp, 'main', 10)
    const firstPage = await getLog(tmp, 'main', 3)
    const secondPage = await getLog(tmp, 'main', 10, 3)

    expect(firstPage.map((entry) => entry.hash)).toEqual(full.slice(0, 3).map((entry) => entry.hash))
    expect(secondPage.map((entry) => entry.hash)).toEqual(full.slice(3).map((entry) => entry.hash))
  })
})
