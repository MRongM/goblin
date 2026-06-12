import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resetHardToPreviousCommit } from '#/system/git/reset.ts'

const gitResultWithOptionsMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/helper.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/helper.ts')>('#/system/git/helper.ts')
  return {
    ...actual,
    gitResultWithOptions: vi.fn((cwd: string, opts: unknown, ...args: string[]) =>
      gitResultWithOptionsMock(cwd, opts, ...args),
    ),
  }
})

describe('resetHardToPreviousCommit', () => {
  beforeEach(() => {
    gitResultWithOptionsMock.mockReset()
    gitResultWithOptionsMock.mockResolvedValue({ ok: true, message: 'HEAD is now at abc1234 previous commit' })
  })

  test('calls git reset --hard HEAD~1 with correct cwd', async () => {
    const signal = new AbortController().signal
    await resetHardToPreviousCommit('/repo/worktree', signal)

    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/repo/worktree', { signal }, 'reset', '--hard', 'HEAD~1',
    )
  })

  test('passes through success result', async () => {
    const result = await resetHardToPreviousCommit('/repo/worktree')
    expect(result).toEqual({ ok: true, message: 'HEAD is now at abc1234 previous commit' })
  })

  test('passes through git error', async () => {
    gitResultWithOptionsMock.mockResolvedValue({ ok: false, message: 'fatal: ambiguous argument' })
    const result = await resetHardToPreviousCommit('/repo/worktree')
    expect(result).toEqual({ ok: false, message: 'fatal: ambiguous argument' })
  })
})
