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
  id: 'ssh://deploy@prod.example.com:22/srv/goblin',
  alias: 'prod',
  host: 'prod.example.com',
  user: 'deploy',
  port: 22,
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

describe('remote editor opening', () => {
  test('builds VS Code-compatible remote SSH args with alias authority', async () => {
    const { remoteEditorArgs } = await import('#/main/system/open-app.ts')

    expect(remoteEditorArgs(TARGET, '/srv/goblin-feature-x')).toEqual([
      '--remote',
      'ssh-remote+prod',
      '/srv/goblin-feature-x',
    ])
  })

  test('falls back to user at host authority when no alias exists', async () => {
    const { remoteEditorArgs } = await import('#/main/system/open-app.ts')

    expect(remoteEditorArgs({ ...TARGET, alias: null }, '/srv/goblin-feature-x')).toEqual([
      '--remote',
      'ssh-remote+deploy@prod.example.com',
      '/srv/goblin-feature-x',
    ])
  })

  test('routes preferred remote editor through the resolved backend', async () => {
    execaMock.mockResolvedValue({ failed: false, stderr: '', shortMessage: '', message: '' })
    const { openRemoteInPreferredEditor } = await import('#/main/system/editors.ts')

    const result = openRemoteInPreferredEditor(TARGET, '/srv/goblin-feature-x', 'vscode')

    expect(result).not.toBeNull()
    await expect(result).resolves.toEqual({
      ok: true,
      message: '/srv/goblin-feature-x',
    })
    expect(execaMock).toHaveBeenCalledWith(
      expect.stringContaining('Visual Studio Code.app/Contents/Resources/app/bin/code'),
      ['--remote', 'ssh-remote+prod', '/srv/goblin-feature-x'],
      expect.objectContaining({ timeout: 10_000, reject: false }),
    )
  })

  test.each([
    ['cursor' as const, 'Cursor.app/Contents/Resources/app/bin/cursor'],
    ['windsurf' as const, 'Windsurf.app/Contents/Resources/app/bin/windsurf'],
  ])('routes %s remote editor through its app CLI', async (pref, cliSuffix) => {
    execaMock.mockResolvedValue({ failed: false, stderr: '', shortMessage: '', message: '' })
    const { openRemoteInPreferredEditor } = await import('#/main/system/editors.ts')

    const result = openRemoteInPreferredEditor(TARGET, '/srv/goblin-feature-x', pref)

    expect(result).not.toBeNull()
    await expect(result).resolves.toEqual({ ok: true, message: '/srv/goblin-feature-x' })
    expect(execaMock).toHaveBeenCalledWith(
      expect.stringContaining(cliSuffix),
      ['--remote', 'ssh-remote+prod', '/srv/goblin-feature-x'],
      expect.objectContaining({ timeout: 10_000, reject: false }),
    )
  })

  test('returns invalid path before invoking the editor for malformed remote paths', async () => {
    const { openRemoteInPreferredEditor } = await import('#/main/system/editors.ts')

    const result = openRemoteInPreferredEditor(TARGET, 'relative/path', 'vscode')

    expect(result).not.toBeNull()
    await expect(result).resolves.toEqual({
      ok: false,
      message: 'error.invalid-path',
    })
    expect(execaMock).not.toHaveBeenCalled()
  })
})
