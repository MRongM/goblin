import { describe, expect, test } from 'vitest'
import {
  normalizeRemoteRepoId,
  normalizeRemoteTarget,
  remoteDisplayName,
  remoteTargetSubtitle,
  remoteWorktreePathLabel,
} from '#/shared/remote-repo.ts'

describe('remote repository identity', () => {
  test('normalizes stable ssh repository ids', () => {
    expect(normalizeRemoteRepoId({ user: 'deploy', host: 'prod', port: 22, remotePath: '/srv/goblin' })).toBe(
      'ssh://deploy@prod:22/srv/goblin',
    )
  })

  test('does not include aliases in the normalized id', () => {
    const base = normalizeRemoteRepoId({ user: 'deploy', host: 'prod.example.com', port: 2222, remotePath: '/srv/app' })
    const withAlias = normalizeRemoteRepoId({
      alias: 'prod',
      user: 'deploy',
      host: 'prod.example.com',
      port: 2222,
      remotePath: '/srv/app',
    })

    expect(withAlias).toBe(base)
  })

  test('preserves identity file metadata without changing the stable repository id', () => {
    const base = normalizeRemoteTarget({
      user: 'deploy',
      host: 'prod',
      port: 22,
      remotePath: '/srv/goblin',
    })
    const withKey = normalizeRemoteTarget({
      user: 'deploy',
      host: 'prod',
      port: 22,
      remotePath: '/srv/goblin',
      identityFile: '~/.ssh/prod_ed25519',
    })

    expect(withKey?.id).toBe(base?.id)
    expect(withKey?.identityFile).toBe('~/.ssh/prod_ed25519')
  })

  test('derives compact display and subtitle text', () => {
    const target = normalizeRemoteTarget({
      alias: 'prod',
      user: 'deploy',
      host: 'prod.example.com',
      port: 2222,
      remotePath: '/srv/goblin',
    })

    expect(target?.displayName).toBe('prod:goblin')
    expect(remoteDisplayName({ alias: null, host: 'prod.example.com', remotePath: '/srv/goblin' })).toBe(
      'prod.example.com:goblin',
    )
    expect(remoteTargetSubtitle(target!)).toBe('deploy@prod.example.com:/srv/goblin')
  })

  test('formats remote worktree paths with connection context for display only', () => {
    const target = normalizeRemoteTarget({
      user: 'deploy',
      host: 'prod.example.com',
      port: 2222,
      remotePath: '/srv/goblin',
    })

    expect(remoteWorktreePathLabel(target!, '/srv/goblin-feature-x')).toBe('deploy@prod.example.com:/srv/goblin-feature-x')
  })

  test('rejects invalid inputs and strips secret-like fields', () => {
    expect(normalizeRemoteTarget({ host: '', user: 'deploy', port: 22, remotePath: '/srv/goblin' })).toBeNull()
    expect(normalizeRemoteTarget({ host: 'prod', user: 'deploy', port: 0, remotePath: '/srv/goblin' })).toBeNull()
    expect(normalizeRemoteTarget({ host: 'prod', user: 'deploy', port: 65536, remotePath: '/srv/goblin' })).toBeNull()
    expect(normalizeRemoteTarget({ host: 'prod', user: 'deploy', port: 22, remotePath: 'srv/goblin' })).toBeNull()

    const unsafeInput: Record<string, unknown> = {
      host: 'prod',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      password: 'secret',
      passphrase: 'secret',
      privateKey: 'secret',
      stderr: 'sensitive stderr',
      terminalOutput: 'sensitive output',
    }
    const target = normalizeRemoteTarget(unsafeInput)

    expect(target).toEqual({
      id: 'ssh://deploy@prod:22/srv/goblin',
      alias: null,
      host: 'prod',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      displayName: 'prod:goblin',
    })
  })

  test('rejects unsafe identity file metadata and still strips secret-like fields', () => {
    const target = normalizeRemoteTarget({
      host: 'prod',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      identityFile: 'bad\0key',
      password: 'secret',
      passphrase: 'secret',
      privateKey: 'secret',
    } as Record<string, unknown>)

    expect(target).toEqual({
      id: 'ssh://deploy@prod:22/srv/goblin',
      alias: null,
      host: 'prod',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      displayName: 'prod:goblin',
    })
  })
})
