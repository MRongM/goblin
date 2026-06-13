import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createBranch, createTrackingBranch } from '#/system/git/branches.ts'

const gitResultWithOptionsMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/helper.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/helper.ts')>('#/system/git/helper.ts')
  return {
    ...actual,
    gitResultWithOptions: vi.fn((cwd: string, opts: unknown, ...args: string[]) => gitResultWithOptionsMock(cwd, opts, ...args)),
  }
})

describe('branch git operations', () => {
  beforeEach(() => {
    gitResultWithOptionsMock.mockReset()
    gitResultWithOptionsMock.mockResolvedValue({ ok: true, message: 'ok' })
  })

  test('creates a local branch from a base branch', async () => {
    const signal = new AbortController().signal

    const result = await createBranch('/tmp/repo', 'feature/new', 'main', signal)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/tmp/repo',
      { signal },
      'branch',
      '--',
      'feature/new',
      'main',
    )
  })

  test('creates a local tracking branch from a remote-tracking ref', async () => {
    const signal = new AbortController().signal

    const result = await createTrackingBranch('/tmp/repo', 'feature/remote', 'origin/feature/remote', signal)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/tmp/repo',
      { signal },
      'branch',
      '--track',
      'feature/remote',
      'origin/feature/remote',
    )
  })

  test.each([
    ['-bad', 'main'],
    ['feature/new', '-bad'],
  ])('rejects invalid createBranch input %#', async (branch, baseBranch) => {
    await expect(createBranch('/tmp/repo', branch, baseBranch)).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    expect(gitResultWithOptionsMock).not.toHaveBeenCalled()
  })

  test.each([
    ['-bad', 'origin/feature/remote'],
    ['feature/remote', 'main'],
    ['feature/remote', 'origin/HEAD'],
  ])('rejects invalid createTrackingBranch input %#', async (localBranch, remoteRef) => {
    await expect(createTrackingBranch('/tmp/repo', localBranch, remoteRef)).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    expect(gitResultWithOptionsMock).not.toHaveBeenCalled()
  })
})
