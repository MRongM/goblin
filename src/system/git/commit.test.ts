import { beforeEach, describe, expect, test } from 'vitest'
import { vi } from 'vitest'
import { commitAllChanges } from '#/system/git/commit.ts'

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

describe('commitAllChanges', () => {
  beforeEach(() => {
    gitResultWithOptionsMock.mockReset()
    gitResultWithOptionsMock.mockResolvedValue({ ok: true, message: '' })
  })

  test('calls git add -A then git commit -m with correct args', async () => {
    const signal = new AbortController().signal
    await commitAllChanges('/repo/worktree', 'feat: add thing', signal)

    expect(gitResultWithOptionsMock).toHaveBeenNthCalledWith(
      1, '/repo/worktree', { signal }, 'add', '-A',
    )
    expect(gitResultWithOptionsMock).toHaveBeenNthCalledWith(
      2, '/repo/worktree', { signal }, 'commit', '-m', 'feat: add thing',
    )
  })

  test('short-circuits if git add fails', async () => {
    gitResultWithOptionsMock.mockResolvedValueOnce({ ok: false, message: 'permission denied' })

    const result = await commitAllChanges('/repo/worktree', 'msg')

    expect(result).toEqual({ ok: false, message: 'permission denied' })
    expect(gitResultWithOptionsMock).toHaveBeenCalledTimes(1)
  })

  test('returns commit result on success', async () => {
    gitResultWithOptionsMock
      .mockResolvedValueOnce({ ok: true, message: '' })
      .mockResolvedValueOnce({ ok: true, message: '[main abc1234] feat: add thing' })

    const result = await commitAllChanges('/repo/worktree', 'feat: add thing')

    expect(result).toEqual({ ok: true, message: '[main abc1234] feat: add thing' })
  })
})
