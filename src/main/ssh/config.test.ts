import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const execaMock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({
  ExecaError: Error,
  execa: execaMock,
}))

afterEach(() => {
  execaMock.mockReset()
  vi.resetModules()
})

describe('ssh config host resolution', () => {
  test('parses concrete Host aliases and excludes wildcard or negated patterns', async () => {
    const { parseSshConfigHosts } = await import('#/main/ssh/config.ts')

    expect(
      parseSshConfigHosts(`
Host prod staging
  HostName prod.example.com
  User deploy
Host *
  User nobody
Host !blocked
  HostName blocked.example.com
Host dev?
  HostName dev.example.com
`),
    ).toEqual([
      { alias: 'prod', hostName: 'prod.example.com', user: 'deploy' },
      { alias: 'staging', hostName: 'prod.example.com', user: 'deploy' },
    ])
  })

  test('resolves ssh config aliases with ssh -G without connecting', async () => {
    execaMock.mockResolvedValue({
      stdout: 'hostname prod.example.com\nuser deploy\nport 2222\n',
      stderr: '',
    })
    const { resolveRemoteTarget } = await import('#/main/ssh/config.ts')

    const resolved = await resolveRemoteTarget({ mode: 'config', alias: 'prod', remotePath: '/srv/goblin' })

    expect(execaMock).toHaveBeenCalledWith('ssh', ['-G', 'prod'], expect.objectContaining({ timeout: 10_000 }))
    expect(resolved.target).toEqual({
      id: 'ssh://deploy@prod.example.com:2222/srv/goblin',
      alias: 'prod',
      host: 'prod.example.com',
      user: 'deploy',
      port: 2222,
      remotePath: '/srv/goblin',
      displayName: 'prod:goblin',
    })
  })

  test('resolves ssh config aliases with an identity file', async () => {
    execaMock.mockResolvedValue({
      stdout: 'hostname prod.example.com\nuser deploy\nport 2222\n',
      stderr: '',
    })
    const { resolveRemoteTarget } = await import('#/main/ssh/config.ts')

    const resolved = await resolveRemoteTarget({
      mode: 'config',
      alias: 'prod',
      remotePath: '/srv/goblin',
      identityFile: '~/.ssh/prod_ed25519',
    })

    expect(resolved.target).toMatchObject({ identityFile: '~/.ssh/prod_ed25519' })
  })

  test('manual targets resolve directly and keep alias null', async () => {
    const { resolveRemoteTarget } = await import('#/main/ssh/config.ts')

    const resolved = await resolveRemoteTarget({
      mode: 'manual',
      host: 'prod.example.com',
      user: 'deploy',
      port: 2222,
      remotePath: '/srv/goblin',
    })

    expect(execaMock).not.toHaveBeenCalled()
    expect(resolved.target.alias).toBeNull()
    expect(resolved.target.id).toBe('ssh://deploy@prod.example.com:2222/srv/goblin')
  })

  test('manual targets preserve an identity file', async () => {
    const { resolveRemoteTarget } = await import('#/main/ssh/config.ts')

    const resolved = await resolveRemoteTarget({
      mode: 'manual',
      host: 'prod.example.com',
      user: 'deploy',
      port: 2222,
      remotePath: '/srv/goblin',
      identityFile: '~/.ssh/prod_ed25519',
    })

    expect(execaMock).not.toHaveBeenCalled()
    expect(resolved.target).toMatchObject({ identityFile: '~/.ssh/prod_ed25519' })
  })
})

describe('ssh config host updates', () => {
  test('appends a default identity Host block when the alias is missing', async () => {
    const homeDir = await tempHome()
    const configPath = path.join(homeDir, '.ssh', 'config')
    await mkdir(path.dirname(configPath), { recursive: true })
    await writeFile(configPath, 'Host staging\n  HostName staging.example.com\n')
    const { ensureSshConfigHost } = await import('#/main/ssh/config.ts')

    const status = await ensureSshConfigHost(
      { host: 'prod.example.com', user: 'deploy', port: 2222, identityFile: '~/.ssh/id_ed25519' },
      configPath,
    )
    const config = await readFile(configPath, 'utf-8')

    expect(status).toBe('created')
    expect(config).toContain(
      [
        'Host prod.example.com',
        '  HostName prod.example.com',
        '  User deploy',
        '  Port 2222',
        '  IdentityFile ~/.ssh/id_ed25519',
        '  IdentitiesOnly yes',
      ].join('\n'),
    )
  })

  test('keeps an existing Host alias unchanged', async () => {
    const homeDir = await tempHome()
    const configPath = path.join(homeDir, '.ssh', 'config')
    const existing = 'Host prod.example.com\n  HostName private.example.com\n  User admin\n'
    await mkdir(path.dirname(configPath), { recursive: true })
    await writeFile(configPath, existing)
    const { ensureSshConfigHost } = await import('#/main/ssh/config.ts')

    const status = await ensureSshConfigHost(
      { host: 'prod.example.com', user: 'deploy', port: 22, identityFile: '~/.ssh/id_ed25519' },
      configPath,
    )

    expect(status).toBe('existing')
    await expect(readFile(configPath, 'utf-8')).resolves.toBe(existing)
  })
})

async function tempHome(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'goblin-ssh-config-'))
}
