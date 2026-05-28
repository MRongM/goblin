import { afterEach, describe, expect, test, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const execaMock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({
  ExecaError: Error,
  execa: execaMock,
}))

afterEach(() => {
  execaMock.mockReset()
  vi.resetModules()
})

const MANUAL_TARGET: RemoteRepoTarget = {
  id: 'ssh://deploy@prod.example.com:2222/srv/goblin',
  alias: null,
  host: 'prod.example.com',
  user: 'deploy',
  port: 2222,
  remotePath: '/srv/goblin',
  displayName: 'prod.example.com:goblin',
}

const ALIAS_TARGET: RemoteRepoTarget = {
  ...MANUAL_TARGET,
  alias: 'prod',
}

describe('remote ssh command runner', () => {
  test('builds non-interactive ssh argv for manual targets', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(MANUAL_TARGET, { type: 'checkShell' })

    expect(invocation.command).toBe('ssh')
    expect(invocation.args).toEqual(
      expect.arrayContaining([
        '-T',
        '-o',
        'RequestTTY=no',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'ConnectTimeout=10',
        '-p',
        '2222',
        '--',
        'deploy@prod.example.com',
      ]),
    )
    expect(invocation.args.slice(invocation.args.indexOf('deploy@prod.example.com') + 1)).toHaveLength(1)
    expect(invocation.args.at(-1)).toMatch(/^sh -lc '/)
  })

  test('uses ssh config alias as the destination when present', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(ALIAS_TARGET, { type: 'checkGit' })

    expect(invocation.args).toContain('prod')
    expect(invocation.args).not.toContain('deploy@prod.example.com')
    expect(invocation.args).not.toContain('-p')
  })

  test('uses identity file when provided', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(
      { ...MANUAL_TARGET, identityFile: '/Users/deploy/.ssh/prod_ed25519' },
      { type: 'checkShell' },
    )

    expect(invocation.args).toEqual(expect.arrayContaining(['-i', '/Users/deploy/.ssh/prod_ed25519']))
  })

  test('expands home-relative identity files before invoking ssh', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(
      { ...MANUAL_TARGET, identityFile: '~/.ssh/prod_ed25519' },
      { type: 'checkShell' },
    )

    expect(invocation.args).toEqual(expect.arrayContaining(['-i', path.join(os.homedir(), '.ssh/prod_ed25519')]))
  })

  test('allows ssh-agent or system ssh to handle encrypted key passphrases', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(MANUAL_TARGET, { type: 'checkShell' })

    expect(invocation.args).not.toContain('BatchMode=yes')
    expect(invocation.args).not.toContain('NumberOfPasswordPrompts=0')
  })

  test('shell-quotes paths in fixed scripts', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'testDirectory',
      path: "/srv/team's app",
    })

    expect(invocation.script).toContain("test -d '/srv/team'\\''s app'")
  })

  test('quotes the shell check as one remote sh script', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(MANUAL_TARGET, { type: 'checkShell' })

    expect(invocation.script).toBe("printf '%s\\n' ok")
    expect(invocation.args.slice(invocation.args.indexOf('deploy@prod.example.com') + 1)).toEqual([
      expect.stringContaining("printf '\\''%s\\n'\\'' ok"),
    ])
  })

  test('runRemoteCommand returns stdout and transient stderr without accepting raw command text', async () => {
    execaMock.mockResolvedValue({ stdout: 'ok\n', stderr: '' })
    const { runRemoteCommand } = await import('#/main/ssh/commands.ts')

    const result = await runRemoteCommand(MANUAL_TARGET, { type: 'checkShell' })

    expect(result).toEqual({ ok: true, stdout: 'ok', stderr: '' })
    expect(execaMock).toHaveBeenCalledWith('ssh', expect.any(Array), expect.objectContaining({ timeout: 15_000 }))
  })
})
