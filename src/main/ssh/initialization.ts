import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import * as pty from 'node-pty'

import { ensureSshConfigHost } from '#/main/ssh/config.ts'
import type {
  SshHostKeyConfirmation,
  SshInitAccessInput,
  SshInitConnectionInput,
  SshInitKeyStatus,
  SshInitPrepareResult,
  SshInitTrustHostKeyInput,
} from '#/shared/remote-repo.ts'
import type { ExecResult } from '#/shared/git-types.ts'

export const SSH_INIT_TIMEOUT_MS = 30_000
export const SSH_INIT_PASSWORD_TIMEOUT_MS = 45_000
export const SSH_DIR_MODE = 0o700
export const SSH_PRIVATE_KEY_MODE = 0o600
export const SSH_PUBLIC_KEY_MODE = 0o644

const KNOWN_HOST_KEY_TYPES = new Set([
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'sk-ecdsa-sha2-nistp256@openssh.com',
  'sk-ssh-ed25519@openssh.com',
  'ssh-ed25519',
  'ssh-rsa',
])

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/
const ECDSA_KEY_TYPE_RE = /^(?:sk-)?ecdsa-sha2-/

export interface ParsedHostKeyLine {
  hosts: string
  keyType: string
  key: string
  line: string
}

interface KeyPaths {
  sshDir: string
  privateKey: string
  publicKey: string
  knownHosts: string
  config: string
}

interface PasswordCommandInvocation {
  command: string
  args: string[]
}

type CommandRunner = (
  command: string,
  args: string[],
  options?: { cancelSignal?: AbortSignal; timeout?: number; shell?: boolean; maxBuffer?: number },
) => Promise<{ stdout: string }>

type PasswordCommandRunner = (
  invocation: PasswordCommandInvocation,
  password: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<ExecResult>

interface InitOptions {
  signal?: AbortSignal
  homeDir?: string
  run?: CommandRunner
  runPasswordCommand?: PasswordCommandRunner
}

export function knownHostName(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`
}

export function parseHostKeyLine(line: string): ParsedHostKeyLine | null {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('@')) return null

  const fields = trimmed.split(/\s+/)
  const hosts = fields[0]
  const keyType = fields[1]
  const key = fields[2]

  if (!hosts || !keyType || !key) return null
  if (!KNOWN_HOST_KEY_TYPES.has(keyType)) return null
  if (!decodeHostKeyBlob(key, keyType)) return null

  return { hosts, keyType, key, line }
}

export function fingerprintHostKey(parts: ParsedHostKeyLine): string {
  const keyBlob = decodeHostKeyBlob(parts.key, parts.keyType)
  if (!keyBlob) {
    throw new Error('Invalid SSH host key blob')
  }

  const digest = createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '')
  return `SHA256:${digest}`
}

export function redactSshInitOutput(text: string, password: string): string {
  let redacted = text.replace(/(password:\s*)[^\r\n]*/gi, '$1[redacted]')
  if (password.length > 0) {
    redacted = redacted.replaceAll(password, '[redacted]')
  }
  return redacted
}

function decodeHostKeyBlob(key: string, keyType: string): Buffer | null {
  if (!BASE64_RE.test(key)) return null
  if (key.length % 4 === 1) return null

  const decoded = Buffer.from(key, 'base64')
  if (decoded.length === 0) return null

  const canonicalInput = key.replace(/=+$/, '')
  const canonicalDecoded = decoded.toString('base64').replace(/=+$/, '')
  if (canonicalInput !== canonicalDecoded) return null

  const parsedKeyType = readSshField(decoded, 0)
  if (!parsedKeyType) return null
  if (parsedKeyType.value.toString('ascii') !== keyType) return null

  if (keyType === 'ssh-ed25519' || keyType === 'sk-ssh-ed25519@openssh.com') {
    if (!hasSshFields(decoded, parsedKeyType.nextOffset, 1)) return null
  } else if (keyType === 'ssh-rsa' || ECDSA_KEY_TYPE_RE.test(keyType)) {
    if (!hasSshFields(decoded, parsedKeyType.nextOffset, 2)) return null
  }

  return decoded
}

function hasSshFields(buffer: Buffer, offset: number, count: number): boolean {
  let nextOffset = offset

  for (let index = 0; index < count; index += 1) {
    const field = readSshField(buffer, nextOffset)
    if (!field || field.value.length === 0) return false
    nextOffset = field.nextOffset
  }

  return true
}

function readSshField(buffer: Buffer, offset: number): { value: Buffer; nextOffset: number } | null {
  if (offset + 4 > buffer.length) return null

  const length = buffer.readUInt32BE(offset)
  const start = offset + 4
  const end = start + length
  if (end > buffer.length) return null

  return { value: buffer.subarray(start, end), nextOffset: end }
}

export async function prepareSshInit(
  input: SshInitConnectionInput,
  options: InitOptions = {},
): Promise<SshInitPrepareResult> {
  const run = options.run ?? execa
  const paths = keyPaths(options.homeDir)
  try {
    const keyStatus = await ensureDefaultKey(paths, run, options.signal)
    const hostKey = await inspectHostKey(input.host, input.port, paths, run, options.signal)
    if (hostKey.status === 'trusted') return { ok: true, keyStatus, hostKeyStatus: 'trusted' }
    if (hostKey.status === 'needs-confirmation') {
      return { ok: true, keyStatus, hostKeyStatus: 'needs-confirmation', confirmation: hostKey.confirmation }
    }
    if (hostKey.status === 'changed') {
      return { ok: true, keyStatus, hostKeyStatus: 'changed', confirmation: hostKey.confirmation }
    }
    return { ok: false, keyStatus, message: 'error.ssh-host-key-scan-failed' }
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) }
  }
}

export async function trustSshHostKey(input: SshInitTrustHostKeyInput, options: InitOptions = {}): Promise<ExecResult> {
  try {
    const parsed = parseHostKeyLine(input.key)
    if (!parsed) return { ok: false, message: 'error.invalid-arguments' }
    if (fingerprintHostKey(parsed) !== input.fingerprint) return { ok: false, message: 'error.ssh-host-key-mismatch' }

    const paths = keyPaths(options.homeDir)
    await ensureSshDir(paths)
    await writeTrustedHostKey(
      paths.knownHosts,
      knownHostName(input.host, input.port),
      `${parsed.keyType} ${parsed.key}`,
    )
    return { ok: true, message: 'ssh host key trusted' }
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) }
  }
}

export async function initializeSshAccess(input: SshInitAccessInput, options: InitOptions = {}): Promise<ExecResult> {
  const run = options.run ?? execa
  const runPasswordCommand = options.runPasswordCommand ?? runPasswordPtyCommand
  const paths = keyPaths(options.homeDir)
  try {
    await ensureDefaultKey(paths, run, options.signal)
    const publicKey = (await fs.readFile(paths.publicKey, 'utf-8')).trim()
    if (!publicKey) return { ok: false, message: 'error.ssh-public-key-missing' }

    const invocation = buildInstallInvocation(input, publicKey)
    const result = await runPasswordCommand(invocation, input.password, {
      signal: options.signal,
      timeoutMs: SSH_INIT_PASSWORD_TIMEOUT_MS,
    })
    if (!result.ok) return { ok: false, message: redactSshInitOutput(result.message, input.password) }

    await ensureSshConfigHost({ host: input.host, user: input.user, port: input.port }, paths.config)
    return result
  } catch (err) {
    return { ok: false, message: redactSshInitOutput(safeErrorMessage(err), input.password) }
  }
}

function keyPaths(homeDir = os.homedir()): KeyPaths {
  const sshDir = path.join(homeDir, '.ssh')
  return {
    sshDir,
    privateKey: path.join(sshDir, 'id_ed25519'),
    publicKey: path.join(sshDir, 'id_ed25519.pub'),
    knownHosts: path.join(sshDir, 'known_hosts'),
    config: path.join(sshDir, 'config'),
  }
}

async function ensureSshDir(paths: KeyPaths): Promise<void> {
  await fs.mkdir(paths.sshDir, { recursive: true, mode: SSH_DIR_MODE })
  await fs.chmod(paths.sshDir, SSH_DIR_MODE)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function ensureDefaultKey(paths: KeyPaths, run: CommandRunner, signal?: AbortSignal): Promise<SshInitKeyStatus> {
  await ensureSshDir(paths)
  const privateExists = await pathExists(paths.privateKey)
  const publicExists = await pathExists(paths.publicKey)
  if (privateExists && publicExists) return 'existing'
  if (privateExists) {
    const { stdout } = await run('ssh-keygen', ['-y', '-f', paths.privateKey], {
      cancelSignal: signal,
      timeout: SSH_INIT_TIMEOUT_MS,
    })
    await fs.writeFile(paths.publicKey, `${stdout.trim()}\n`, { mode: SSH_PUBLIC_KEY_MODE })
    return 'public-key-recreated'
  }

  await run('ssh-keygen', ['-t', 'ed25519', '-f', paths.privateKey, '-N', '', '-C', `goblin@${os.hostname()}`], {
    cancelSignal: signal,
    timeout: SSH_INIT_TIMEOUT_MS,
  })
  await fs.chmod(paths.privateKey, SSH_PRIVATE_KEY_MODE)
  return 'generated'
}

async function inspectHostKey(
  host: string,
  port: number,
  paths: KeyPaths,
  run: CommandRunner,
  signal?: AbortSignal,
): Promise<
  | { status: 'trusted' }
  | { status: 'needs-confirmation'; confirmation: SshHostKeyConfirmation }
  | { status: 'changed'; confirmation: SshHostKeyConfirmation }
  | { status: 'unavailable' }
> {
  const scanned = await scanHostKeys(host, port, run, signal)
  const known = await readKnownHostKeys(paths, host, port)
  if (known.length === 0) {
    const first = scanned[0]
    if (!first) return { status: 'unavailable' }
    return {
      status: 'needs-confirmation',
      confirmation: {
        host,
        port,
        key: first.line,
        keyType: first.keyType,
        fingerprint: fingerprintHostKey(first),
      },
    }
  }

  const scannedFingerprints = new Set(scanned.map(fingerprintHostKey))
  if (known.some((key) => scannedFingerprints.has(fingerprintHostKey(key)))) return { status: 'trusted' }
  const first = scanned[0]
  if (!first) return { status: 'unavailable' }
  return {
    status: 'changed',
    confirmation: {
      host,
      port,
      key: first.line,
      keyType: first.keyType,
      fingerprint: fingerprintHostKey(first),
    },
  }
}

async function scanHostKeys(
  host: string,
  port: number,
  run: CommandRunner,
  signal?: AbortSignal,
): Promise<ParsedHostKeyLine[]> {
  const { stdout } = await run('ssh-keyscan', ['-p', String(port), '-T', '10', host], {
    cancelSignal: signal,
    timeout: SSH_INIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  })
  return stdout
    .split(/\r?\n/)
    .map(parseHostKeyLine)
    .filter((line): line is ParsedHostKeyLine => line !== null)
}

async function readKnownHostKeys(paths: KeyPaths, host: string, port: number): Promise<ParsedHostKeyLine[]> {
  try {
    const content = await fs.readFile(paths.knownHosts, 'utf-8')
    const hostName = knownHostName(host, port)
    return content
      .split(/\r?\n/)
      .map(parseHostKeyLine)
      .filter((line): line is ParsedHostKeyLine => line !== null && line.hosts.split(',').includes(hostName))
  } catch {
    return []
  }
}

async function writeTrustedHostKey(knownHostsPath: string, hostName: string, keyMaterial: string): Promise<void> {
  const trustedLine = `${hostName} ${keyMaterial}`
  let content = ''
  try {
    content = await fs.readFile(knownHostsPath, 'utf-8')
  } catch {}

  const lines = content.length === 0 ? [] : content.split(/\r?\n/)
  const normalizedLines = lines.at(-1) === '' ? lines.slice(0, -1) : lines
  const keptLines = normalizedLines.filter((line) => !knownHostsLineMatchesHost(line, hostName))
  keptLines.push(trustedLine)
  await fs.writeFile(knownHostsPath, `${keptLines.join('\n')}\n`)
}

function knownHostsLineMatchesHost(line: string, hostName: string): boolean {
  const parsed = parseHostKeyLine(line)
  return parsed ? parsed.hosts.split(',').includes(hostName) : false
}

function buildInstallInvocation(input: SshInitAccessInput, publicKey: string): PasswordCommandInvocation {
  const destination = `${input.user}@${input.host}`
  const script = [
    'umask 077',
    'mkdir -p "$HOME/.ssh"',
    'touch "$HOME/.ssh/authorized_keys"',
    `grep -qxF ${shellQuote(publicKey)} "$HOME/.ssh/authorized_keys" || printf '%s\\n' ${shellQuote(
      publicKey,
    )} >> "$HOME/.ssh/authorized_keys"`,
    'chmod 700 "$HOME/.ssh"',
    'chmod 600 "$HOME/.ssh/authorized_keys"',
  ].join('; ')
  return {
    command: 'ssh',
    args: [
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'PubkeyAuthentication=no',
      '-o',
      'PreferredAuthentications=password,keyboard-interactive',
      '-o',
      'NumberOfPasswordPrompts=1',
      '-p',
      String(input.port),
      destination,
      `sh -lc ${shellQuote(script)}`,
    ],
  }
}

function runPasswordPtyCommand(
  invocation: PasswordCommandInvocation,
  password: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    let passwordSent = false
    const child = pty.spawn(invocation.command, invocation.args, {
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' },
    })

    const finish = (result: ExecResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill()
      } catch {}
      resolve(result)
    }

    const timer = setTimeout(
      () => finish({ ok: false, message: 'timeout' }),
      options.timeoutMs ?? SSH_INIT_PASSWORD_TIMEOUT_MS,
    )
    options.signal?.addEventListener('abort', () => finish({ ok: false, message: 'cancelled' }), { once: true })
    child.onData((data) => {
      output += data
      if (!passwordSent && /password:\s*$/i.test(output)) {
        passwordSent = true
        child.write(`${password}\r`)
      }
    })
    child.onExit(({ exitCode }) => {
      const message = redactSshInitOutput(output, password)
      finish(exitCode === 0 ? { ok: true, message } : { ok: false, message })
    })
  })
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
