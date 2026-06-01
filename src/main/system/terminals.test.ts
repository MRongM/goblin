import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  getTerminalAppAvailability,
  openInPreferredTerminal,
  openRemoteInPreferredTerminal,
} from '#/main/system/terminals.ts'
import { isAppleTerminalInstalled, openInAppleTerminal, openRemoteInAppleTerminal } from '#/main/system/apple-terminal.ts'
import { isGhosttyInstalled, openInGhostty, openRemoteInGhostty } from '#/main/system/ghostty.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

vi.mock('#/main/system/ghostty.ts', () => ({
  isGhosttyInstalled: vi.fn(() => false),
  openInGhostty: vi.fn(async (path: string) => ({ ok: true, message: path })),
  openRemoteInGhostty: vi.fn(async (_target: RemoteRepoTarget, path: string) => ({ ok: true, message: path })),
}))

vi.mock('#/main/system/apple-terminal.ts', () => ({
  isAppleTerminalInstalled: vi.fn(async () => true),
  openInAppleTerminal: vi.fn(async (path: string) => ({ ok: true, message: path })),
  openRemoteInAppleTerminal: vi.fn(async (_target: RemoteRepoTarget, path: string) => ({ ok: true, message: path })),
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

describe('openInPreferredTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('opens Terminal.app explicitly even when detection reports unavailable', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(false)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(false)

    await expect(openInPreferredTerminal('/repo', 'terminal')).resolves.toEqual({
      ok: true,
      message: '/repo',
    })
    expect(openInAppleTerminal).toHaveBeenCalledWith('/repo')
  })

  test('prefers Ghostty in auto mode when it is installed', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(true)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await openInPreferredTerminal('/repo', 'auto')

    expect(openInGhostty).toHaveBeenCalledWith('/repo')
    expect(openInAppleTerminal).not.toHaveBeenCalled()
  })

  test('falls back to Terminal.app in auto mode without waiting on detection', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(false)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(false)

    await expect(openInPreferredTerminal('/repo', 'auto')).resolves.toEqual({
      ok: true,
      message: '/repo',
    })

    expect(openInAppleTerminal).toHaveBeenCalledWith('/repo')
  })

  test('reports async Terminal.app availability for settings', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(true)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(false)

    await expect(getTerminalAppAvailability()).resolves.toEqual({
      ghostty: true,
      terminal: false,
    })
  })
})

describe('openRemoteInPreferredTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('opens Terminal.app explicitly for remote repositories', async () => {
    await expect(openRemoteInPreferredTerminal(TARGET, '/srv/goblin-feature-x', 'terminal')).resolves.toEqual({
      ok: true,
      message: '/srv/goblin-feature-x',
    })

    expect(openRemoteInAppleTerminal).toHaveBeenCalledWith(TARGET, '/srv/goblin-feature-x')
  })

  test('prefers Ghostty in auto mode for remote repositories when it is installed', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(true)

    await openRemoteInPreferredTerminal(TARGET, '/srv/goblin-feature-x', 'auto')

    expect(openRemoteInGhostty).toHaveBeenCalledWith(TARGET, '/srv/goblin-feature-x')
    expect(openRemoteInAppleTerminal).not.toHaveBeenCalled()
  })
})
