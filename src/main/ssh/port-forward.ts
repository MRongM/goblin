import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { broadcastRpcEvent } from '#/main/events.ts'
import { runRemoteCommand, type RemoteCommandKind, type RemoteCommandResult } from '#/main/ssh/commands.ts'
import { normalizeRemoteTarget, type RemoteRepoTarget } from '#/shared/remote-repo.ts'
import {
  normalizeRemotePortForwardConfig,
  type RemoteListeningPort,
  type RemotePortForwardConfig,
  type RemotePortForwardSession,
  type RemotePortScanResult,
} from '#/shared/remote-ports.ts'

const SSH_CONNECT_TIMEOUT_SEC = 10
const LOCAL_HOST = '127.0.0.1' as const
const REMOTE_HOST = '127.0.0.1' as const
const MAX_STDERR_CHARS = 4096

export interface RemotePortForwardInvocation {
  command: 'ssh'
  args: string[]
}

interface ManagedSession {
  session: RemotePortForwardSession
  child: ChildProcess
  stderr: string
  stopping: boolean
}

type RemotePortForwardSpawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

interface RemotePortForwardManagerDeps {
  spawn?: RemotePortForwardSpawn
  chooseAvailableLocalPort?: (preferredPort: number) => Promise<number>
  now?: () => number
  onSessionChanged?: (session: RemotePortForwardSession) => void
  runRemote?: (
    target: RemoteRepoTarget,
    options?: { signal?: AbortSignal },
  ) => Promise<{ tool: 'ss' | 'lsof' | 'netstat' | 'none'; result: RemoteCommandResult }>
}

export interface RemotePortForwardManager {
  start(target: RemoteRepoTarget, config: RemotePortForwardConfig): Promise<RemotePortForwardSession>
  stop(target: RemoteRepoTarget, configId: string): Promise<RemotePortForwardSession | null>
  list(target: RemoteRepoTarget): RemotePortForwardSession[]
  cleanupRepo(target: RemoteRepoTarget): Promise<void>
  cleanupAll(): Promise<void>
  scan(target: RemoteRepoTarget, options?: { signal?: AbortSignal }): Promise<RemotePortScanResult>
}

export interface RemotePortForwardCleanupApp {
  on(event: 'before-quit' | 'will-quit', listener: () => void): unknown
}

export function buildRemotePortForwardInvocation(
  target: RemoteRepoTarget,
  ports: { localPort: number; remotePort: number },
): RemotePortForwardInvocation {
  const args = [
    '-N',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SEC}`,
    '-L',
    `${LOCAL_HOST}:${ports.localPort}:${REMOTE_HOST}:${ports.remotePort}`,
  ]
  const destination = target.alias ?? `${target.user}@${target.host}`
  if (target.identityFile) args.push('-i', expandIdentityFile(target.identityFile))
  if (!target.alias) args.push('-p', String(target.port))
  args.push('--', destination)
  return { command: 'ssh', args }
}

export function createRemotePortForwardManager(deps: RemotePortForwardManagerDeps = {}): RemotePortForwardManager {
  const sessions = new Map<string, ManagedSession>()
  const spawn = deps.spawn ?? nodeSpawn
  const choosePort = deps.chooseAvailableLocalPort ?? chooseAvailableLocalPort
  const now = deps.now ?? Date.now
  const onSessionChanged = deps.onSessionChanged ?? (() => {})

  function key(target: RemoteRepoTarget, configId: string): string {
    return `${target.id}\0${configId}`
  }

  function normalizedTarget(target: RemoteRepoTarget): RemoteRepoTarget {
    const normalized = normalizeRemoteTarget(target)
    if (!normalized || normalized.id !== target.id) throw new TypeError('Invalid remote repository target')
    return normalized
  }

  const manager: RemotePortForwardManager = {
    async start(targetInput, configInput) {
      const target = normalizedTarget(targetInput)
      const config = normalizeRemotePortForwardConfig(configInput)
      if (!config) throw new TypeError('Invalid remote port forward config')
      const existing = sessions.get(key(target, config.id))
      if (existing) return existing.session

      const requested = config.requestedLocalPort ?? config.remotePort
      const actualLocalPort = await choosePort(requested)
      const invocation = buildRemotePortForwardInvocation(target, {
        localPort: actualLocalPort,
        remotePort: config.remotePort,
      })
      const child = spawn(invocation.command, invocation.args, { stdio: ['ignore', 'ignore', 'pipe'] })
      const session: RemotePortForwardSession = {
        configId: config.id,
        repoId: target.id,
        remotePort: config.remotePort,
        requestedLocalPort: config.requestedLocalPort,
        actualLocalPort,
        localHost: LOCAL_HOST,
        remoteHost: REMOTE_HOST,
        status: 'running',
        startedAt: now(),
      }
      const managed: ManagedSession = { session, child, stderr: '', stopping: false }
      sessions.set(key(target, config.id), managed)

      child.stderr?.on('data', (chunk) => {
        managed.stderr = `${managed.stderr}${String(chunk)}`.slice(-MAX_STDERR_CHARS)
      })
      child.once('error', (err) => {
        sessions.delete(key(target, config.id))
        onSessionChanged({ ...session, status: 'failed', message: err.message })
      })
      child.once('close', (code, signal) => {
        sessions.delete(key(target, config.id))
        if (managed.stopping) return
        const message = managed.stderr.trim() || `ssh exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`
        onSessionChanged({ ...session, status: 'failed', message })
      })

      onSessionChanged(session)
      return session
    },

    async stop(targetInput, configId) {
      const target = normalizedTarget(targetInput)
      const managed = sessions.get(key(target, configId))
      if (!managed) return null
      sessions.delete(key(target, configId))
      managed.stopping = true
      try {
        if (!managed.child.killed) managed.child.kill()
      } catch {}
      const session = { ...managed.session, status: 'stopped' as const }
      onSessionChanged(session)
      return session
    },

    list(targetInput) {
      const target = normalizedTarget(targetInput)
      return Array.from(sessions.values())
        .map((managed) => managed.session)
        .filter((session) => session.repoId === target.id)
    },

    async cleanupRepo(targetInput) {
      const target = normalizedTarget(targetInput)
      for (const managed of Array.from(sessions.values())) {
        if (managed.session.repoId === target.id) await manager.stop(target, managed.session.configId)
      }
    },

    async cleanupAll() {
      for (const [sessionKey, managed] of Array.from(sessions.entries())) {
        sessions.delete(sessionKey)
        managed.stopping = true
        try {
          if (!managed.child.killed) managed.child.kill()
        } catch {}
      }
    },

    async scan(targetInput, options) {
      const target = normalizedTarget(targetInput)
      const runner = deps.runRemote ?? runRemoteListeningPortScan
      const { tool, result } = await runner(target, options)
      if (!result.ok) return { ports: [], message: result.message ?? result.stderr ?? 'error.remote-port-scan-failed' }
      if (tool === 'none') return { ports: [], message: 'remote-ports.scan-unavailable' }
      return { ports: parseRemoteListeningPorts(tool, result.stdout) }
    },
  }

  return manager
}

export const remotePortForwardManager = createRemotePortForwardManager({
  onSessionChanged: (session) => broadcastRpcEvent({ type: 'remote-port-session-changed', session }),
})

export function wireRemotePortForwardCleanup(app: RemotePortForwardCleanupApp): void {
  app.on('before-quit', () => {
    void remotePortForwardManager.cleanupAll()
  })
  app.on('will-quit', () => {
    void remotePortForwardManager.cleanupAll()
  })
}

export async function chooseAvailableLocalPort(preferredPort: number): Promise<number> {
  if (await canListen(preferredPort)) return preferredPort
  return reserveEphemeralPort()
}

export function parseRemoteListeningPorts(tool: 'ss' | 'lsof' | 'netstat', output: string): RemoteListeningPort[] {
  const byPort = new Map<number, RemoteListeningPort>()
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line || /^State\b|^COMMAND\b|^Proto\b/.test(line)) continue
    const parsed =
      tool === 'ss' ? parseSsLine(line) : tool === 'lsof' ? parseLsofLine(line) : parseNetstatLine(line)
    if (parsed && !byPort.has(parsed.port)) byPort.set(parsed.port, parsed)
  }
  return Array.from(byPort.values()).sort((a, b) => a.port - b.port)
}

async function runRemoteListeningPortScan(
  target: RemoteRepoTarget,
  options?: { signal?: AbortSignal },
): Promise<{ tool: 'ss' | 'lsof' | 'netstat' | 'none'; result: RemoteCommandResult }> {
  const commands: Array<['ss' | 'lsof' | 'netstat', RemoteCommandKind]> = [
    ['ss', { type: 'rawListeningPorts', tool: 'ss' }],
    ['lsof', { type: 'rawListeningPorts', tool: 'lsof' }],
    ['netstat', { type: 'rawListeningPorts', tool: 'netstat' }],
  ]
  for (const [tool, command] of commands) {
    const result = await runRemoteCommand(target, command, { signal: options?.signal })
    if (result.ok) return { tool, result }
    if (result.message === 'cancelled') return { tool, result }
  }
  return { tool: 'none', result: { ok: true, stdout: '', stderr: '' } }
}

function parseSsLine(line: string): RemoteListeningPort | null {
  const match = line.match(/\s(\S+):(\d+)\s+\S+:\*\s*(.*)$/)
  if (!match) return null
  const process = match[3]?.match(/"([^"]+)",pid=(\d+)/)
  return portEntry(Number(match[2]), match[1] ?? null, process?.[1] ?? null, process?.[2] ?? null)
}

function parseLsofLine(line: string): RemoteListeningPort | null {
  const parts = line.split(/\s+/)
  const endpoint = line.match(/TCP\s+(\S+):(\d+)\s+\(LISTEN\)/)
  if (!endpoint) return null
  return portEntry(Number(endpoint[2]), endpoint[1] ?? null, parts[0] ?? null, parts[1] ?? null)
}

function parseNetstatLine(line: string): RemoteListeningPort | null {
  const parts = line.split(/\s+/)
  if (!/^tcp/.test(parts[0] ?? '') || !line.includes('LISTEN')) return null
  const local = parts[3] ?? ''
  const localMatch = local.match(/^(.+):(\d+)$/)
  const proc = parts.find((part) => /^\d+\//.test(part))
  const procMatch = proc?.match(/^(\d+)\/(.+)$/)
  if (!localMatch) return null
  return portEntry(Number(localMatch[2]), localMatch[1] ?? null, procMatch?.[2] ?? null, procMatch?.[1] ?? null)
}

function portEntry(
  port: number,
  address: string | null,
  processName: string | null,
  pid: string | null,
): RemoteListeningPort | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { port, protocol: 'tcp', processName, pid, address }
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, LOCAL_HOST, () => {
      server.close(() => resolve(true))
    })
  })
}

function reserveEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, LOCAL_HOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('No local port available'))))
    })
  })
}

function expandIdentityFile(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}
