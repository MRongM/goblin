import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const VALID_HOST_KEY =
  'prod.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBLRXK4hTXfUJq2LVeY3rYg3u7vevVZlA8I8R1ow4vJq'

describe('SSH initialization helpers', () => {
  test('formats known_hosts names for default and custom ports', async () => {
    const { knownHostName } = await import('#/main/ssh/initialization.ts')

    expect(knownHostName('prod.example.com', 22)).toBe('prod.example.com')
    expect(knownHostName('prod.example.com', 2222)).toBe('[prod.example.com]:2222')
  })

  test('parses ssh-keyscan lines and computes SHA256 fingerprints', async () => {
    const { fingerprintHostKey, parseHostKeyLine } = await import('#/main/ssh/initialization.ts')
    const line = VALID_HOST_KEY

    const parsed = parseHostKeyLine(line)

    expect(parsed).toEqual({
      hosts: 'prod.example.com',
      keyType: 'ssh-ed25519',
      key: 'AAAAC3NzaC1lZDI1NTE5AAAAIBLRXK4hTXfUJq2LVeY3rYg3u7vevVZlA8I8R1ow4vJq',
      line,
    })
    expect(fingerprintHostKey(parsed!)).toBe('SHA256:sFYmGowS/78KGyzxKzgV/2bWuzd+pH645OAkTWHC21o')
  })

  test('rejects comments and malformed host key lines', async () => {
    const { parseHostKeyLine } = await import('#/main/ssh/initialization.ts')

    expect(parseHostKeyLine('# prod')).toBeNull()
    expect(parseHostKeyLine('')).toBeNull()
    expect(parseHostKeyLine('prod.example.com ssh-ed25519')).toBeNull()
    expect(parseHostKeyLine('prod.example.com not-a-key AAAA')).toBeNull()
  })

  test('rejects malformed and empty host key blobs', async () => {
    const { parseHostKeyLine } = await import('#/main/ssh/initialization.ts')

    expect(parseHostKeyLine('prod.example.com ssh-ed25519 !!!')).toBeNull()
    expect(parseHostKeyLine('prod.example.com ssh-ed25519 not-base64')).toBeNull()
    expect(parseHostKeyLine('prod.example.com ssh-ed25519 ====')).toBeNull()
    expect(parseHostKeyLine('prod.example.com ssh-ed25519 AAAA')).toBeNull()
    expect(parseHostKeyLine('prod.example.com ssh-rsa AAAAB3NzaC1yc2E=')).toBeNull()
    expect(parseHostKeyLine(`prod.example.com ecdsa-sha2-nistp256 ${sshStringBlob('ecdsa-sha2-nistp256')}`)).toBeNull()
  })

  test('rejects known_hosts marker lines', async () => {
    const { parseHostKeyLine } = await import('#/main/ssh/initialization.ts')
    const key = VALID_HOST_KEY.split(/\s+/)[2]!

    expect(parseHostKeyLine(`@revoked prod.example.com ssh-ed25519 ${key}`)).toBeNull()
    expect(parseHostKeyLine(`@cert-authority prod.example.com ssh-ed25519 ${key}`)).toBeNull()
    expect(parseHostKeyLine(`@unknown prod.example.com ssh-ed25519 ${key}`)).toBeNull()
  })

  test('redacts secrets from command output', async () => {
    const { redactSshInitOutput } = await import('#/main/ssh/initialization.ts')

    expect(redactSshInitOutput('deploy password: secret-value\nPermission denied', 'secret-value')).toBe(
      'deploy password: [redacted]\nPermission denied',
    )
  })
})

describe('SSH initialization orchestration', () => {
  test('generates id_ed25519 when the default key pair is missing', async () => {
    const homeDir = await tempHome()
    const run = execaStub()
    const { prepareSshInit } = await import('#/main/ssh/initialization.ts')

    const result = await prepareSshInit({ host: 'prod.example.com', user: 'deploy', port: 22 }, { homeDir, run })

    expect(result).toMatchObject({ ok: true, keyStatus: 'generated' })
    expect(run).toHaveBeenCalledWith(
      'ssh-keygen',
      expect.arrayContaining(['-t', 'ed25519', '-f', path.join(homeDir, '.ssh', 'id_ed25519'), '-N', '']),
      expect.objectContaining({ timeout: 30_000 }),
    )
  })

  test('recreates the public key when only id_ed25519.pub is missing', async () => {
    const homeDir = await tempHome()
    const sshDir = path.join(homeDir, '.ssh')
    await mkdir(sshDir, { recursive: true })
    await writeFile(path.join(sshDir, 'id_ed25519'), 'private')
    const run = execaStub()
    const { prepareSshInit } = await import('#/main/ssh/initialization.ts')

    const result = await prepareSshInit({ host: 'prod.example.com', user: 'deploy', port: 22 }, { homeDir, run })
    const publicKey = await readFile(path.join(sshDir, 'id_ed25519.pub'), 'utf-8')

    expect(result).toMatchObject({ ok: true, keyStatus: 'public-key-recreated' })
    expect(publicKey).toBe('ssh-ed25519 LOCALPUB\n')
  })

  test('returns host key confirmation for unknown hosts', async () => {
    const homeDir = await tempHome()
    const run = execaStub()
    const { prepareSshInit } = await import('#/main/ssh/initialization.ts')

    const result = await prepareSshInit({ host: 'prod.example.com', user: 'deploy', port: 2222 }, { homeDir, run })

    expect(result).toMatchObject({
      ok: true,
      hostKeyStatus: 'needs-confirmation',
      confirmation: { host: 'prod.example.com', port: 2222, keyType: 'ssh-ed25519' },
    })
  })

  test('requires confirmation for changed host keys', async () => {
    const homeDir = await tempHome()
    const sshDir = path.join(homeDir, '.ssh')
    await mkdir(sshDir, { recursive: true })
    await writeFile(path.join(sshDir, 'id_ed25519'), 'private')
    await writeFile(path.join(sshDir, 'id_ed25519.pub'), 'ssh-ed25519 LOCALPUB\n')
    await writeFile(path.join(sshDir, 'known_hosts'), `prod.example.com ssh-ed25519 ${ed25519KeyBlob(1)}\n`)
    const run = execaStub()
    const { prepareSshInit } = await import('#/main/ssh/initialization.ts')

    const result = await prepareSshInit({ host: 'prod.example.com', user: 'deploy', port: 22 }, { homeDir, run })

    expect(result).toMatchObject({
      ok: true,
      keyStatus: 'existing',
      hostKeyStatus: 'changed',
      confirmation: { host: 'prod.example.com', port: 22, keyType: 'ssh-ed25519' },
    })
  })

  test('trustSshHostKey appends a verified known_hosts line built in main', async () => {
    const homeDir = await tempHome()
    const { fingerprintHostKey, parseHostKeyLine, trustSshHostKey } = await import('#/main/ssh/initialization.ts')
    const fingerprint = fingerprintHostKey(parseHostKeyLine(VALID_HOST_KEY)!)

    const result = await trustSshHostKey(
      { host: 'prod.example.com', port: 2222, key: VALID_HOST_KEY, fingerprint },
      { homeDir },
    )
    const knownHosts = await readFile(path.join(homeDir, '.ssh', 'known_hosts'), 'utf-8')

    expect(result.ok).toBe(true)
    expect(knownHosts).toBe(
      `[prod.example.com]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBLRXK4hTXfUJq2LVeY3rYg3u7vevVZlA8I8R1ow4vJq\n`,
    )
  })

  test('trustSshHostKey replaces matching known_hosts entries and preserves other hosts', async () => {
    const homeDir = await tempHome()
    const sshDir = path.join(homeDir, '.ssh')
    await mkdir(sshDir, { recursive: true })
    await writeFile(
      path.join(sshDir, 'known_hosts'),
      [
        '# existing hosts',
        `prod.example.com ssh-ed25519 ${ed25519KeyBlob(1)}`,
        `staging.example.com ssh-ed25519 ${ed25519KeyBlob(2)}`,
        '',
      ].join('\n'),
    )
    const { fingerprintHostKey, parseHostKeyLine, trustSshHostKey } = await import('#/main/ssh/initialization.ts')
    const fingerprint = fingerprintHostKey(parseHostKeyLine(VALID_HOST_KEY)!)

    const result = await trustSshHostKey(
      { host: 'prod.example.com', port: 22, key: VALID_HOST_KEY, fingerprint },
      { homeDir },
    )
    const knownHosts = await readFile(path.join(sshDir, 'known_hosts'), 'utf-8')

    expect(result.ok).toBe(true)
    expect(knownHosts).toBe(
      [
        '# existing hosts',
        `staging.example.com ssh-ed25519 ${ed25519KeyBlob(2)}`,
        'prod.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBLRXK4hTXfUJq2LVeY3rYg3u7vevVZlA8I8R1ow4vJq',
        '',
      ].join('\n'),
    )
  })

  test('initializeSshAccess installs the public key through password-authenticated ssh and redacts failures', async () => {
    const homeDir = await tempHome()
    const sshDir = path.join(homeDir, '.ssh')
    await mkdir(sshDir, { recursive: true })
    await writeFile(path.join(sshDir, 'id_ed25519'), 'private')
    await writeFile(path.join(sshDir, 'id_ed25519.pub'), 'ssh-ed25519 LOCALPUB\n')
    const run = execaStub()
    const runPasswordCommand = vi.fn(async () => ({ ok: false, message: 'password: secret\nPermission denied' }))
    const { initializeSshAccess } = await import('#/main/ssh/initialization.ts')

    const result = await initializeSshAccess(
      { host: 'prod.example.com', user: 'deploy', port: 22, password: 'secret' },
      { homeDir, run, runPasswordCommand },
    )

    expect(runPasswordCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'ssh',
        args: expect.arrayContaining([
          '-o',
          'StrictHostKeyChecking=yes',
          '-o',
          'PubkeyAuthentication=no',
          '-o',
          'PreferredAuthentications=password,keyboard-interactive',
          '-o',
          'NumberOfPasswordPrompts=1',
          '-p',
          '22',
          'deploy@prod.example.com',
        ]),
      }),
      'secret',
      expect.objectContaining({ timeoutMs: 45_000 }),
    )
    expect(result).toEqual({ ok: false, message: 'password: [redacted]\nPermission denied' })
  })

  test('initializeSshAccess appends ssh config after successful ssh-copy-id installation', async () => {
    const homeDir = await tempHome()
    const sshDir = path.join(homeDir, '.ssh')
    await mkdir(sshDir, { recursive: true })
    await writeFile(path.join(sshDir, 'id_ed25519'), 'private')
    await writeFile(path.join(sshDir, 'id_ed25519.pub'), 'ssh-ed25519 LOCALPUB\n')
    const run = execaStub()
    const runPasswordCommand = vi.fn(async () => ({ ok: true, message: 'installed' }))
    const { initializeSshAccess } = await import('#/main/ssh/initialization.ts')

    const result = await initializeSshAccess(
      { host: 'prod.example.com', user: 'deploy', port: 2222, password: 'secret' },
      { homeDir, run, runPasswordCommand },
    )
    const config = await readFile(path.join(sshDir, 'config'), 'utf-8')

    expect(result).toEqual({ ok: true, message: 'installed' })
    expect(config).toBe(
      [
        'Host prod.example.com',
        '  HostName prod.example.com',
        '  User deploy',
        '  Port 2222',
        '  IdentityFile ~/.ssh/id_ed25519',
        '  IdentitiesOnly yes',
        '',
      ].join('\n'),
    )
  })
})

function sshStringBlob(value: string): string {
  return Buffer.concat([sshString(value)]).toString('base64')
}

function sshString(value: string | Buffer): Buffer {
  const valueBuffer = typeof value === 'string' ? Buffer.from(value, 'ascii') : value
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32BE(valueBuffer.length)
  return Buffer.concat([lengthBuffer, valueBuffer])
}

function ed25519KeyBlob(fill: number): string {
  return Buffer.concat([sshString('ssh-ed25519'), sshString(Buffer.alloc(32, fill))]).toString('base64')
}

async function tempHome(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'goblin-ssh-init-'))
}

function execaStub(scanKey = VALID_HOST_KEY) {
  return vi.fn(async (command: string, args: string[]) => {
    if (command === 'ssh-keygen' && args.includes('-y')) return { stdout: 'ssh-ed25519 LOCALPUB' }
    if (command === 'ssh-keygen') {
      const keyPath = args[args.indexOf('-f') + 1]
      if (keyPath) {
        await mkdir(path.dirname(keyPath), { recursive: true })
        await writeFile(keyPath, 'private')
        await writeFile(`${keyPath}.pub`, 'ssh-ed25519 LOCALPUB\n')
      }
      return { stdout: '' }
    }
    if (command === 'ssh-keyscan') return { stdout: scanKey }
    if (command === 'command') return { stdout: '' }
    return { stdout: '' }
  }) as any
}
