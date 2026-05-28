import { afterEach, describe, expect, test, vi } from 'vitest'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const execaMock = vi.hoisted(() => vi.fn())
const existsSyncMock = vi.hoisted(() => vi.fn(() => true))
const statSyncMock = vi.hoisted(() => vi.fn(() => ({ isDirectory: () => true })))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/Users/test'),
  },
}))

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  statSync: statSyncMock,
}))

vi.mock('execa', () => ({
  execa: execaMock,
}))

const TARGET: RemoteRepoTarget = {
  id: 'ssh://deploy@prod.example.com:2222/srv/goblin',
  alias: null,
  host: 'prod.example.com',
  user: 'deploy',
  port: 2222,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

afterEach(() => {
  execaMock.mockReset()
  existsSyncMock.mockReset()
  existsSyncMock.mockReturnValue(true)
  statSyncMock.mockReset()
  statSyncMock.mockReturnValue({ isDirectory: () => true })
  vi.resetModules()
})

describe('remote terminal opening', () => {
  test('opens an SSH session in Terminal.app through AppleScript argv', async () => {
    execaMock.mockResolvedValue({ stdout: '' })
    const { openRemoteInPreferredTerminal } = await import('#/main/system/terminals.ts')

    await expect(openRemoteInPreferredTerminal(TARGET, '/srv/goblin-feature-x', 'terminal')).resolves.toEqual({
      ok: true,
      message: '/srv/goblin-feature-x',
    })

    expect(execaMock).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      [
        '-e',
        expect.stringContaining('do script commandText'),
        expect.stringContaining("ssh -tt -o StrictHostKeyChecking=yes"),
      ],
      expect.objectContaining({ timeout: 10_000 }),
    )
  })

  test('opens an SSH session in Ghostty with structured ssh argv', async () => {
    const child = Promise.resolve({})
    Object.assign(child, { unref: vi.fn() })
    execaMock.mockReturnValue(child)
    const { openRemoteInPreferredTerminal } = await import('#/main/system/terminals.ts')

    await expect(openRemoteInPreferredTerminal(TARGET, '/srv/goblin-feature-x', 'ghostty')).resolves.toEqual({
      ok: true,
      message: '/srv/goblin-feature-x',
    })

    expect(execaMock).toHaveBeenCalledWith(
      'open',
      expect.arrayContaining(['-na', 'Ghostty.app', '--args', '-e', 'ssh', '-tt', '-p', '2222']),
      expect.objectContaining({ detached: true, timeout: 10_000 }),
    )
  })

  test('rejects malformed remote paths before launching a terminal', async () => {
    const { openRemoteInPreferredTerminal } = await import('#/main/system/terminals.ts')

    await expect(openRemoteInPreferredTerminal(TARGET, 'relative/path', 'terminal')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-path',
    })
    expect(execaMock).not.toHaveBeenCalled()
  })
})
