import { describe, expect, test } from 'vitest'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import type { RemoteCommandKind, RemoteCommandResult } from '#/main/ssh/commands.ts'

const TARGET: RemoteRepoTarget = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: 'prod',
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

describe('remote directory picker backend', () => {
  test('rejects non-absolute paths', async () => {
    const { listRemoteDirectory } = await import('#/main/ssh/path-picker.ts')

    await expect(listRemoteDirectory(TARGET, 'srv/goblin', { run: async () => ({ ok: true, stdout: '', stderr: '' }) }))
      .rejects.toThrow('Remote path must be absolute')
  })

  test('lists direct directories and marks repo statuses', async () => {
    const { listRemoteDirectory } = await import('#/main/ssh/path-picker.ts')
    const result = await listRemoteDirectory(TARGET, '/srv', {
      run: async (command: RemoteCommandKind): Promise<RemoteCommandResult> => {
        if (command.type === 'listDirectories') {
          return { ok: true, stdout: '/srv/goblin\n/srv/nested\n/srv/folder', stderr: '' }
        }
        if (command.type === 'revParseTopLevel' && command.path === '/srv/goblin') {
          return { ok: true, stdout: '/srv/goblin', stderr: '' }
        }
        if (command.type === 'revParseTopLevel' && command.path === '/srv/nested') {
          return { ok: true, stdout: '/srv', stderr: '' }
        }
        return { ok: false, stdout: '', stderr: 'not a repository', message: 'not a repository' }
      },
    })

    expect(result.entries).toEqual([
      { path: '/srv/goblin', name: 'goblin', status: 'repo' },
      { path: '/srv/nested', name: 'nested', status: 'in repo' },
      { path: '/srv/folder', name: 'folder', status: 'folder' },
    ])
  })

  test('represents unreadable children and truncates after 200 entries', async () => {
    const { listRemoteDirectory } = await import('#/main/ssh/path-picker.ts')
    const paths = Array.from({ length: 205 }, (_, index) => `/srv/dir-${index}`)
    const result = await listRemoteDirectory(TARGET, '/srv', {
      run: async (command: RemoteCommandKind): Promise<RemoteCommandResult> => {
        if (command.type === 'listDirectories') return { ok: true, stdout: paths.join('\n'), stderr: '' }
        if (command.type === 'revParseTopLevel' && command.path === '/srv/dir-0') {
          return { ok: false, stdout: '', stderr: 'Permission denied', message: 'Permission denied' }
        }
        return { ok: false, stdout: '', stderr: 'not a repository', message: 'not a repository' }
      },
    })

    expect(result.entries).toHaveLength(200)
    expect(result.truncated).toBe(true)
    expect(result.entries[0]).toMatchObject({ path: '/srv/dir-0', status: 'unreadable' })
  })

  test('bounds child directory classification concurrency', async () => {
    const { listRemoteDirectory } = await import('#/main/ssh/path-picker.ts')
    const paths = Array.from({ length: 24 }, (_, index) => `/srv/dir-${index}`)
    let active = 0
    let maxActive = 0

    await listRemoteDirectory(TARGET, '/srv', {
      run: async (command: RemoteCommandKind): Promise<RemoteCommandResult> => {
        if (command.type === 'listDirectories') return { ok: true, stdout: paths.join('\n'), stderr: '' }
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 0))
        active -= 1
        return { ok: false, stdout: '', stderr: 'not a repository', message: 'not a repository' }
      },
    })

    expect(maxActive).toBeLessThanOrEqual(8)
  })
})
