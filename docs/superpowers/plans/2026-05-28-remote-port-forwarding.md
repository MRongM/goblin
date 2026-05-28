# Remote Port Forwarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SSH remote repository port forwarding with saved per-repo configs, manual forwarding, remote listening-port discovery, and toolbar UI.

**Architecture:** Keep renderer code declarative: it stores configs, mirrors runtime sessions, and calls typed RPC. Main process owns all SSH argument construction, local port selection, child-process lifecycle, cleanup, and remote scan command execution. Saved configs and runtime sessions are separate so tunnels never auto-restore as running after restart.

**Tech Stack:** TypeScript, React, Zustand, tRPC/valibot, Electron IPC/events, OpenSSH via `child_process.spawn`, `net`, Vitest/jsdom.

---

Project instruction override: `AGENTS.md` says not to plan or execute git commits unless the user explicitly asks. This plan intentionally omits commit steps even though the generic writing-plans skill recommends frequent commits.

## Scope Check

This is one vertical slice. The main SSH manager, RPC, renderer store, and toolbar UI are coupled because the UI is only useful once the backend can start/stop tunnels safely, and the backend needs renderer state to persist configs and expose status. The plan excludes public bind addresses, reverse forwarding, dynamic forwarding, HTTPS probing, and automatic restart of previously running tunnels.

## File Structure

- Create `src/shared/remote-ports.ts`: shared config/session/listening-port types, validation helpers, config normalization, and URL formatting.
- Create `src/shared/remote-ports.test.ts`: shared validation and normalization tests.
- Modify `src/shared/rpc.ts`: add `remote-port-session-changed` event, `remotePorts.*` handlers, schemas, and router procedures.
- Create `src/main/ssh/port-forward.ts`: SSH tunnel argument construction, local port selection, session registry, remote scan parser, start/stop/list/cleanup functions, and app cleanup hook.
- Create `src/main/ssh/port-forward.test.ts`: main-process unit tests with fake `spawn`, fake port chooser, and parser fixtures.
- Modify `src/main/rpc.ts`: wire `remotePorts.*` handlers and broadcast session-change events.
- Modify `src/main/rpc.test.ts`: mock `port-forward.ts` and verify router validation/routing.
- Modify `src/main/main.ts`: register port-forward cleanup on app shutdown.
- Modify `src/renderer/stores/repos/types.ts`: add `remotePorts` state, persisted config map, and store action signatures.
- Modify `src/renderer/stores/repos/helpers.ts`: initialize empty remote-port state.
- Modify `src/renderer/stores/repos/store.ts`: persist `remotePortConfigsByRepo` alongside `repoCache`.
- Modify `src/renderer/stores/repos/persistence.ts`: normalize persisted remote-port config maps.
- Modify `src/renderer/stores/repos/lifecycle.ts`: hydrate configs into remote repos and cleanup tunnels on close.
- Create `src/renderer/stores/repos/remote-ports.ts`: renderer actions for add/remove/start/stop/scan/list and session-change application.
- Modify `src/renderer/stores/repos/test-utils.ts`, `src/renderer/stores/repos/lifecycle-test-utils.ts`: add test helpers and default RPC mocks.
- Create `src/renderer/stores/repos/remote-ports.test.ts`: store behavior tests.
- Modify `src/renderer/stores/repos/persistence.test.ts`, `src/renderer/stores/repos/lifecycle.test.ts`, `src/renderer/stores/repos/lifecycle-hydrate.test.ts`: persistence and lifecycle coverage.
- Create `src/renderer/hooks/useRemotePortSessionEvents.ts`: subscribe to `remote-port-session-changed` events and apply them to the repo store.
- Modify `src/renderer/App.tsx`: install the remote-port event hook once.
- Create `src/renderer/components/repo-toolbar/RemotePortsPopover.tsx`: toolbar popover UI for manual configs, discovered ports, start/stop/open/copy/remove.
- Create `src/renderer/components/repo-toolbar/RemotePortsPopover.ui.test.tsx`: jsdom interaction tests.
- Modify `src/renderer/components/repo-toolbar/RepoToolbarActions.tsx`: show the `Ports` button for remote repos.
- Modify `src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx`: verify remote toolbar includes Ports and local toolbar does not.
- Modify `src/main/i18n/en.ts`, `src/main/i18n/zh.ts`, `src/main/i18n/ja.ts`, `src/main/i18n/ko.ts`: add remote-port UI and error keys.

## Task 1: Shared Remote Port Model

**Files:**

- Create: `src/shared/remote-ports.ts`
- Create: `src/shared/remote-ports.test.ts`

- [ ] **Step 1: Write shared model tests**

Create `src/shared/remote-ports.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  formatRemotePortForwardUrl,
  normalizeRemotePortForwardConfig,
  normalizeRemotePortForwardConfigs,
  normalizeRemotePortConfigMap,
  remotePortForwardConfig,
} from '#/shared/remote-ports.ts'

describe('remote port forwarding model', () => {
  test('normalizes valid configs and trims labels', () => {
    expect(
      normalizeRemotePortForwardConfig({
        id: 'cfg-1',
        remotePort: 3000,
        requestedLocalPort: 3001,
        label: ' dev server ',
      }),
    ).toEqual({
      id: 'cfg-1',
      remotePort: 3000,
      requestedLocalPort: 3001,
      label: 'dev server',
    })
  })

  test('rejects invalid ids and ports', () => {
    expect(normalizeRemotePortForwardConfig({ id: '', remotePort: 3000, requestedLocalPort: null })).toBeNull()
    expect(normalizeRemotePortForwardConfig({ id: 'bad\0id', remotePort: 3000, requestedLocalPort: null })).toBeNull()
    expect(normalizeRemotePortForwardConfig({ id: 'cfg', remotePort: 0, requestedLocalPort: null })).toBeNull()
    expect(normalizeRemotePortForwardConfig({ id: 'cfg', remotePort: 65536, requestedLocalPort: null })).toBeNull()
    expect(normalizeRemotePortForwardConfig({ id: 'cfg', remotePort: 3000, requestedLocalPort: 0 })).toBeNull()
  })

  test('normalizes arrays and drops duplicate ids after first valid config', () => {
    expect(
      normalizeRemotePortForwardConfigs([
        { id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: null },
        { id: 'cfg-1', remotePort: 4000, requestedLocalPort: null, label: null },
        { id: 'cfg-2', remotePort: 5000, requestedLocalPort: 5001, label: '' },
      ]),
    ).toEqual([
      { id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: null },
      { id: 'cfg-2', remotePort: 5000, requestedLocalPort: 5001, label: null },
    ])
  })

  test('normalizes persisted config maps', () => {
    expect(
      normalizeRemotePortConfigMap({
        'ssh://deploy@prod:22/srv/goblin': [
          { id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: null },
        ],
        bad: [{ id: 'cfg-2', remotePort: 0, requestedLocalPort: null }],
      }),
    ).toEqual({
      'ssh://deploy@prod:22/srv/goblin': [
        { id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: null },
      ],
    })
  })

  test('creates configs and formats local urls', () => {
    const config = remotePortForwardConfig({ id: 'cfg-1', remotePort: 8080, requestedLocalPort: null, label: null })

    expect(config).toEqual({ id: 'cfg-1', remotePort: 8080, requestedLocalPort: null, label: null })
    expect(formatRemotePortForwardUrl({ localHost: '127.0.0.1', actualLocalPort: 49152 })).toBe(
      'http://127.0.0.1:49152',
    )
  })
})
```

- [ ] **Step 2: Run the shared model test and verify red**

Run:

```sh
bun run test "src/shared/remote-ports.test.ts"
```

Expected: FAIL because `src/shared/remote-ports.ts` does not exist.

- [ ] **Step 3: Add shared model implementation**

Create `src/shared/remote-ports.ts`:

```ts
export interface RemotePortForwardConfig {
  id: string
  remotePort: number
  requestedLocalPort: number | null
  label: string | null
}

export type RemotePortForwardStatus = 'starting' | 'running' | 'stopped' | 'failed'

export interface RemotePortForwardSession {
  configId: string
  repoId: string
  remotePort: number
  requestedLocalPort: number | null
  actualLocalPort: number
  localHost: '127.0.0.1'
  remoteHost: '127.0.0.1'
  status: RemotePortForwardStatus
  startedAt: number
  message?: string
}

export interface RemoteListeningPort {
  port: number
  protocol: 'tcp'
  processName: string | null
  pid: string | null
  address: string | null
}

export interface RemotePortScanResult {
  ports: RemoteListeningPort[]
  message?: string
}

export interface RemotePortForwardConfigInput {
  id?: unknown
  remotePort?: unknown
  requestedLocalPort?: unknown
  label?: unknown
}

export interface RemotePortForwardUrlInput {
  localHost: '127.0.0.1'
  actualLocalPort: number
}

export function remotePortForwardConfig(input: {
  id: string
  remotePort: number
  requestedLocalPort: number | null
  label: string | null
}): RemotePortForwardConfig {
  const config = normalizeRemotePortForwardConfig(input)
  if (!config) throw new TypeError('Invalid remote port forward config')
  return config
}

export function normalizeRemotePortForwardConfig(input: RemotePortForwardConfigInput): RemotePortForwardConfig | null {
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const remotePort = normalizePort(input.remotePort)
  const requestedLocalPort =
    input.requestedLocalPort === null || input.requestedLocalPort === undefined || input.requestedLocalPort === ''
      ? null
      : normalizePort(input.requestedLocalPort)
  const label = normalizeLabel(input.label)
  if (!safeText(id) || remotePort === null || requestedLocalPort === undefined) return null
  return { id, remotePort, requestedLocalPort, label }
}

export function normalizeRemotePortForwardConfigs(value: unknown): RemotePortForwardConfig[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const configs: RemotePortForwardConfig[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const config = normalizeRemotePortForwardConfig(item as RemotePortForwardConfigInput)
    if (!config || seen.has(config.id)) continue
    seen.add(config.id)
    configs.push(config)
  }
  return configs
}

export function normalizeRemotePortConfigMap(value: unknown): Record<string, RemotePortForwardConfig[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([repoId, raw]) => [repoId, normalizeRemotePortForwardConfigs(raw)] as const)
    .filter(([repoId, configs]) => safeText(repoId) && configs.length > 0)
  return Object.fromEntries(entries)
}

export function isValidRemotePort(value: unknown): value is number {
  return normalizePort(value) !== null
}

export function formatRemotePortForwardUrl(input: RemotePortForwardUrlInput): string {
  return `http://${input.localHost}:${input.actualLocalPort}`
}

function normalizePort(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return null
  return value >= 1 && value <= 65535 ? value : null
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const label = value.trim()
  return safeText(label) ? label : null
}

function safeText(value: string): boolean {
  return value.length > 0 && !value.includes('\0')
}
```

- [ ] **Step 4: Run the shared model test and verify green**

Run:

```sh
bun run test "src/shared/remote-ports.test.ts"
```

Expected: PASS.

## Task 2: Main SSH Port Forward Manager

**Files:**

- Create: `src/main/ssh/port-forward.ts`
- Create: `src/main/ssh/port-forward.test.ts`

- [ ] **Step 1: Write manager tests**

Create `src/main/ssh/port-forward.test.ts`:

```ts
import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const TARGET: RemoteRepoTarget = {
  id: 'ssh://deploy@prod.example.com:2222/srv/goblin',
  alias: null,
  host: 'prod.example.com',
  user: 'deploy',
  port: 2222,
  remotePath: '/srv/goblin',
  displayName: 'prod.example.com:goblin',
}

const ALIAS_TARGET: RemoteRepoTarget = { ...TARGET, alias: 'prod' }

class FakeChildProcess extends EventEmitter {
  stderr = new EventEmitter()
  killed = false

  kill() {
    this.killed = true
    this.emit('close', 0, null)
    return true
  }
}

function fakeSpawnFactory(children: FakeChildProcess[]) {
  return vi.fn(() => {
    const child = new FakeChildProcess()
    children.push(child)
    return child as unknown as ChildProcess
  })
}

describe('remote port forward manager', () => {
  test('builds ssh tunnel argv for manual targets', async () => {
    const { buildRemotePortForwardInvocation } = await import('#/main/ssh/port-forward.ts')

    const invocation = buildRemotePortForwardInvocation(TARGET, { localPort: 49152, remotePort: 3000 })

    expect(invocation.command).toBe('ssh')
    expect(invocation.args).toEqual(
      expect.arrayContaining([
        '-N',
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'ConnectTimeout=10',
        '-L',
        '127.0.0.1:49152:127.0.0.1:3000',
        '-p',
        '2222',
        '--',
        'deploy@prod.example.com',
      ]),
    )
  })

  test('uses ssh config alias without explicit port option', async () => {
    const { buildRemotePortForwardInvocation } = await import('#/main/ssh/port-forward.ts')

    const invocation = buildRemotePortForwardInvocation(ALIAS_TARGET, { localPort: 3000, remotePort: 3000 })

    expect(invocation.args).toContain('prod')
    expect(invocation.args).not.toContain('deploy@prod.example.com')
    expect(invocation.args).not.toContain('-p')
  })

  test('starts idempotently and returns actual local port', async () => {
    const children: FakeChildProcess[] = []
    const spawn = fakeSpawnFactory(children)
    const { createRemotePortForwardManager } = await import('#/main/ssh/port-forward.ts')
    const manager = createRemotePortForwardManager({
      spawn,
      chooseAvailableLocalPort: async () => 49152,
      now: () => 123,
      onSessionChanged: vi.fn(),
    })
    const config = { id: 'cfg-1', remotePort: 3000, requestedLocalPort: 3000, label: null }

    const first = await manager.start(TARGET, config)
    const second = await manager.start(TARGET, config)

    expect(first).toEqual({
      configId: 'cfg-1',
      repoId: TARGET.id,
      remotePort: 3000,
      requestedLocalPort: 3000,
      actualLocalPort: 49152,
      localHost: '127.0.0.1',
      remoteHost: '127.0.0.1',
      status: 'running',
      startedAt: 123,
    })
    expect(second).toEqual(first)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  test('stop kills only the matching session', async () => {
    const children: FakeChildProcess[] = []
    const { createRemotePortForwardManager } = await import('#/main/ssh/port-forward.ts')
    const manager = createRemotePortForwardManager({
      spawn: fakeSpawnFactory(children),
      chooseAvailableLocalPort: async (port) => port,
      now: () => 123,
      onSessionChanged: vi.fn(),
    })
    await manager.start(TARGET, { id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: null })
    await manager.start(TARGET, { id: 'cfg-2', remotePort: 4000, requestedLocalPort: null, label: null })

    const stopped = await manager.stop(TARGET, 'cfg-1')

    expect(stopped?.status).toBe('stopped')
    expect(children[0]?.killed).toBe(true)
    expect(children[1]?.killed).toBe(false)
    expect(manager.list(TARGET).map((item) => item.configId)).toEqual(['cfg-2'])
  })

  test('records unexpected process exits as failed sessions', async () => {
    const children: FakeChildProcess[] = []
    const onSessionChanged = vi.fn()
    const { createRemotePortForwardManager } = await import('#/main/ssh/port-forward.ts')
    const manager = createRemotePortForwardManager({
      spawn: fakeSpawnFactory(children),
      chooseAvailableLocalPort: async () => 3000,
      now: () => 123,
      onSessionChanged,
    })
    await manager.start(TARGET, { id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: null })

    children[0]?.stderr.emit('data', Buffer.from('bind failed'))
    children[0]?.emit('close', 255, null)

    expect(onSessionChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ configId: 'cfg-1', status: 'failed', message: 'bind failed' }),
    )
    expect(manager.list(TARGET)).toEqual([])
  })

  test('parses common remote listening port outputs', async () => {
    const { parseRemoteListeningPorts } = await import('#/main/ssh/port-forward.ts')

    expect(
      parseRemoteListeningPorts(
        'ss',
        [
          'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
          'LISTEN 0 4096 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=123,fd=18))',
        ].join('\n'),
      ),
    ).toEqual([{ port: 3000, protocol: 'tcp', processName: 'node', pid: '123', address: '127.0.0.1' }])

    expect(parseRemoteListeningPorts('lsof', 'node 123 deploy 18u IPv4 TCP 127.0.0.1:5173 (LISTEN)')).toEqual([
      { port: 5173, protocol: 'tcp', processName: 'node', pid: '123', address: '127.0.0.1' },
    ])

    expect(parseRemoteListeningPorts('netstat', 'tcp 0 0 127.0.0.1:8080 0.0.0.0:* LISTEN 456/python')).toEqual([
      { port: 8080, protocol: 'tcp', processName: 'python', pid: '456', address: '127.0.0.1' },
    ])
  })
})
```

- [ ] **Step 2: Run manager tests and verify red**

Run:

```sh
bun run test "src/main/ssh/port-forward.test.ts"
```

Expected: FAIL because `src/main/ssh/port-forward.ts` does not exist.

- [ ] **Step 3: Add the manager implementation**

Create `src/main/ssh/port-forward.ts`:

```ts
import { app } from 'electron'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
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

interface RemotePortForwardManagerDeps {
  spawn?: typeof nodeSpawn
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

  return {
    async start(targetInput, configInput) {
      const target = normalizedTarget(targetInput)
      const config = normalizeRemotePortForwardConfig(configInput)
      if (!config) throw new TypeError('Invalid remote port forward config')
      const existing = sessions.get(key(target, config.id))
      if (existing) return existing.session
      const requested = config.requestedLocalPort ?? config.remotePort
      const actualLocalPort = await choosePort(requested)
      const invocation = buildRemotePortForwardInvocation(target, { localPort: actualLocalPort, remotePort: config.remotePort })
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
        if (managed.session.repoId === target.id) await this.stop(target, managed.session.configId)
      }
    },

    async cleanupAll() {
      for (const managed of Array.from(sessions.values())) {
        sessions.delete(`${managed.session.repoId}\0${managed.session.configId}`)
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
}

export const remotePortForwardManager = createRemotePortForwardManager()

export function wireRemotePortForwardCleanup(): void {
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

function portEntry(port: number, address: string | null, processName: string | null, pid: string | null): RemoteListeningPort | null {
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
```

- [ ] **Step 4: Add raw listening-port command support**

Modify `src/main/ssh/commands.ts` so `RemoteCommandKind` includes:

```ts
  | { type: 'rawListeningPorts'; tool: 'ss' | 'lsof' | 'netstat' }
```

Add this case to `scriptForCommand`:

```ts
    case 'rawListeningPorts':
      return command.tool === 'ss'
        ? 'ss -ltnp'
        : command.tool === 'lsof'
          ? 'lsof -iTCP -sTCP:LISTEN -P -n'
          : 'netstat -ltnp'
```

- [ ] **Step 5: Run manager and SSH command tests**

Run:

```sh
bun run test "src/main/ssh/port-forward.test.ts" "src/main/ssh/commands.test.ts"
```

Expected: PASS.

## Task 3: RPC Surface And Main Cleanup Wiring

**Files:**

- Modify: `src/shared/rpc.ts`
- Modify: `src/main/rpc.ts`
- Modify: `src/main/rpc.test.ts`
- Modify: `src/main/main.ts`

- [ ] **Step 1: Add RPC tests**

In `src/main/rpc.test.ts`, add a mock near the other main mocks:

```ts
const remotePortMocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  list: vi.fn(),
  scan: vi.fn(),
  cleanupRepo: vi.fn(),
}))

vi.mock('#/main/ssh/port-forward.ts', () => ({
  remotePortForwardManager: remotePortMocks,
  wireRemotePortForwardCleanup: vi.fn(),
}))
```

Append tests inside the existing `describe('main repo rpc cancellation', () => { ... })` block:

```ts
  test('routes remote port start through the manager', async () => {
    remotePortMocks.start.mockResolvedValue({
      configId: 'cfg-1',
      repoId: REMOTE_TARGET.id,
      remotePort: 3000,
      requestedLocalPort: null,
      actualLocalPort: 3000,
      localHost: '127.0.0.1',
      remoteHost: '127.0.0.1',
      status: 'running',
      startedAt: 123,
    })

    const result = await invokeRpc('remotePorts.start', {
      target: REMOTE_TARGET,
      config: { id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: null },
    })

    expect(result).toEqual({
      ok: true,
      data: {
        configId: 'cfg-1',
        repoId: REMOTE_TARGET.id,
        remotePort: 3000,
        requestedLocalPort: null,
        actualLocalPort: 3000,
        localHost: '127.0.0.1',
        remoteHost: '127.0.0.1',
        status: 'running',
        startedAt: 123,
      },
    })
    expect(remotePortMocks.start).toHaveBeenCalledWith(REMOTE_TARGET, {
      id: 'cfg-1',
      remotePort: 3000,
      requestedLocalPort: null,
      label: null,
    })
  })

  test('rejects invalid remote port configs at the router boundary', async () => {
    const result = await invokeRpc('remotePorts.start', {
      target: REMOTE_TARGET,
      config: { id: 'cfg-1', remotePort: 0, requestedLocalPort: null, label: null },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('BAD_REQUEST')
  })
```

- [ ] **Step 2: Run RPC test and verify red**

Run:

```sh
bun run test "src/main/rpc.test.ts"
```

Expected: FAIL because `remotePorts.*` is not in the shared router or handlers.

- [ ] **Step 3: Extend shared RPC types and router**

In `src/shared/rpc.ts`, import remote-port types:

```ts
import type {
  RemotePortForwardConfig,
  RemotePortForwardSession,
  RemotePortScanResult,
} from '#/shared/remote-ports.ts'
```

Add an event variant:

```ts
  | { type: 'remote-port-session-changed'; session: RemotePortForwardSession }
```

Add handlers to `AppRpcHandlers`:

```ts
  remotePorts: {
    start: (input: { target: RemoteRepoTarget; config: RemotePortForwardConfig }) => Promise<RemotePortForwardSession>
    stop: (input: { target: RemoteRepoTarget; configId: string }) => Promise<RemotePortForwardSession | null>
    list: (input: { target: RemoteRepoTarget }) => Promise<RemotePortForwardSession[]>
    scan: (input: { target: RemoteRepoTarget }) => Promise<RemotePortScanResult>
    cleanupRepo: (input: { target: RemoteRepoTarget }) => Promise<void>
  }
```

Add schemas near `RemoteTargetSchema`:

```ts
const PortNumberInput = v.pipe(FiniteNumber, v.integer(), v.minValue(1), v.maxValue(65535))
const RemotePortForwardConfigSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  remotePort: PortNumberInput,
  requestedLocalPort: v.nullable(PortNumberInput),
  label: v.nullable(v.string()),
})
```

Add router procedures:

```ts
    remotePorts: t.router({
      start: p
        .input(v.object({ target: RemoteTargetSchema, config: RemotePortForwardConfigSchema }))
        .mutation(({ input }) => handlers.remotePorts.start(input)),
      stop: p
        .input(v.object({ target: RemoteTargetSchema, configId: v.string() }))
        .mutation(({ input }) => handlers.remotePorts.stop(input)),
      list: p.input(v.object({ target: RemoteTargetSchema })).query(({ input }) => handlers.remotePorts.list(input)),
      scan: p.input(v.object({ target: RemoteTargetSchema })).query(({ input }) => handlers.remotePorts.scan(input)),
      cleanupRepo: p
        .input(v.object({ target: RemoteTargetSchema }))
        .mutation(({ input }) => handlers.remotePorts.cleanupRepo(input)),
    }),
```

- [ ] **Step 4: Wire main handlers**

In `src/main/rpc.ts`, import the manager:

```ts
import { remotePortForwardManager } from '#/main/ssh/port-forward.ts'
```

Add this sibling next to `remote` in `createRpcHandlers()`:

```ts
    remotePorts: {
      start: async ({ target, config }) => remotePortForwardManager.start(normalizedRemoteTargetOrThrow(target), config),
      stop: async ({ target, configId }) =>
        remotePortForwardManager.stop(normalizedRemoteTargetOrThrow(target), configId),
      list: async ({ target }) => remotePortForwardManager.list(normalizedRemoteTargetOrThrow(target)),
      scan: async ({ target }) => remotePortForwardManager.scan(normalizedRemoteTargetOrThrow(target), {
        signal: currentRpcSignal(),
      }),
      cleanupRepo: async ({ target }) => {
        await remotePortForwardManager.cleanupRepo(normalizedRemoteTargetOrThrow(target))
      },
    },
```

- [ ] **Step 5: Broadcast session-change events**

Change the singleton in `src/main/ssh/port-forward.ts` to pass an event callback:

```ts
import { broadcastRpcEvent } from '#/main/events.ts'
```

```ts
export const remotePortForwardManager = createRemotePortForwardManager({
  onSessionChanged: (session) => broadcastRpcEvent({ type: 'remote-port-session-changed', session }),
})
```

- [ ] **Step 6: Wire app cleanup**

In `src/main/main.ts`, import:

```ts
import { wireRemotePortForwardCleanup } from '#/main/ssh/port-forward.ts'
```

Call it after `wireTerminalIpc()`:

```ts
  wireRemotePortForwardCleanup()
```

- [ ] **Step 7: Run RPC test and typecheck**

Run:

```sh
bun run test "src/main/rpc.test.ts"
bun run typecheck
```

Expected: both PASS.

## Task 4: Renderer State, Persistence, And Lifecycle

**Files:**

- Modify: `src/renderer/stores/repos/types.ts`
- Modify: `src/renderer/stores/repos/helpers.ts`
- Modify: `src/renderer/stores/repos/store.ts`
- Modify: `src/renderer/stores/repos/persistence.ts`
- Modify: `src/renderer/stores/repos/lifecycle.ts`
- Create: `src/renderer/stores/repos/remote-ports.ts`
- Modify: `src/renderer/stores/repos/test-utils.ts`
- Modify: `src/renderer/stores/repos/lifecycle-test-utils.ts`
- Create: `src/renderer/stores/repos/remote-ports.test.ts`
- Modify: `src/renderer/stores/repos/persistence.test.ts`
- Modify: `src/renderer/stores/repos/lifecycle.test.ts`
- Modify: `src/renderer/stores/repos/lifecycle-hydrate.test.ts`

- [ ] **Step 1: Write store tests**

Create `src/renderer/stores/repos/remote-ports.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { installGoblinTestBridge, resetReposStore } from '#/renderer/stores/repos/test-utils.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const TARGET: RemoteRepoTarget = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: null,
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

beforeEach(() => {
  resetReposStore()
})

async function openRemote() {
  installGoblinTestBridge({
    'remote.testRepository': () => ({ target: TARGET, ok: true, stages: [] }),
    'remote.snapshot': () => ({ branches: [], current: '' }),
    'remotePorts.list': () => [],
  })
  await useReposStore.getState().openRemoteRepo(TARGET)
}

describe('remote port store actions', () => {
  test('adds and persists a remote port config', async () => {
    await openRemote()

    const config = useReposStore.getState().addRemotePortForward(TARGET.id, {
      remotePort: 3000,
      requestedLocalPort: null,
      label: 'dev',
    })

    expect(config).toMatchObject({ remotePort: 3000, requestedLocalPort: null, label: 'dev' })
    expect(useReposStore.getState().repos[TARGET.id]?.remotePorts.configs).toEqual([config])
    expect(useReposStore.getState().remotePortConfigsByRepo[TARGET.id]).toEqual([config])
  })

  test('starts and stops a remote port session', async () => {
    const start = vi.fn(() => ({
      configId: 'cfg-1',
      repoId: TARGET.id,
      remotePort: 3000,
      requestedLocalPort: null,
      actualLocalPort: 49152,
      localHost: '127.0.0.1',
      remoteHost: '127.0.0.1',
      status: 'running',
      startedAt: 123,
    }))
    const stop = vi.fn(() => ({
      configId: 'cfg-1',
      repoId: TARGET.id,
      remotePort: 3000,
      requestedLocalPort: null,
      actualLocalPort: 49152,
      localHost: '127.0.0.1',
      remoteHost: '127.0.0.1',
      status: 'stopped',
      startedAt: 123,
    }))
    installGoblinTestBridge({
      'remote.testRepository': () => ({ target: TARGET, ok: true, stages: [] }),
      'remote.snapshot': () => ({ branches: [], current: '' }),
      'remotePorts.list': () => [],
      'remotePorts.start': start,
      'remotePorts.stop': stop,
    })
    await useReposStore.getState().openRemoteRepo(TARGET)
    useReposStore.getState().addRemotePortForward(TARGET.id, {
      id: 'cfg-1',
      remotePort: 3000,
      requestedLocalPort: null,
      label: null,
    })

    await useReposStore.getState().startRemotePortForward(TARGET.id, 'cfg-1')
    expect(useReposStore.getState().repos[TARGET.id]?.remotePorts.sessions['cfg-1']?.actualLocalPort).toBe(49152)

    await useReposStore.getState().stopRemotePortForward(TARGET.id, 'cfg-1')
    expect(useReposStore.getState().repos[TARGET.id]?.remotePorts.sessions['cfg-1']).toBeUndefined()
  })

  test('applies remote port session changed events only to matching remote repos', async () => {
    await openRemote()

    useReposStore.getState().applyRemotePortSessionChanged({
      configId: 'cfg-1',
      repoId: TARGET.id,
      remotePort: 3000,
      requestedLocalPort: null,
      actualLocalPort: 3000,
      localHost: '127.0.0.1',
      remoteHost: '127.0.0.1',
      status: 'running',
      startedAt: 123,
    })

    expect(useReposStore.getState().repos[TARGET.id]?.remotePorts.sessions['cfg-1']?.status).toBe('running')

    useReposStore.getState().applyRemotePortSessionChanged({
      configId: 'cfg-1',
      repoId: TARGET.id,
      remotePort: 3000,
      requestedLocalPort: null,
      actualLocalPort: 3000,
      localHost: '127.0.0.1',
      remoteHost: '127.0.0.1',
      status: 'failed',
      startedAt: 123,
      message: 'ssh exited',
    })

    expect(useReposStore.getState().repos[TARGET.id]?.remotePorts.sessions['cfg-1']?.status).toBe('failed')
  })
})
```

- [ ] **Step 2: Run store test and verify red**

Run:

```sh
bun run test "src/renderer/stores/repos/remote-ports.test.ts"
```

Expected: FAIL because the store state/actions are not defined.

- [ ] **Step 3: Extend repo types**

In `src/renderer/stores/repos/types.ts`, import remote-port types:

```ts
import type {
  RemoteListeningPort,
  RemotePortForwardConfig,
  RemotePortForwardSession,
} from '#/shared/remote-ports.ts'
```

Add state interfaces:

```ts
export interface RepoRemotePortsState {
  configs: RemotePortForwardConfig[]
  sessions: Record<string, RemotePortForwardSession>
  actionBusyByConfig: Record<string, boolean>
  scan: {
    phase: 'idle' | 'loading'
    ports: RemoteListeningPort[]
    message: string | null
    error: string | null
  }
}
```

Add `remotePorts: RepoRemotePortsState` to `RepoState`.

Add `remotePortConfigsByRepo: Record<string, RemotePortForwardConfig[]>` to `ReposStore`.

Add action signatures to `ReposStore`:

```ts
  addRemotePortForward: (
    id: string,
    input: { id?: string; remotePort: number; requestedLocalPort: number | null; label: string | null },
  ) => RemotePortForwardConfig | null
  removeRemotePortForward: (id: string, configId: string) => Promise<void>
  startRemotePortForward: (id: string, configId: string) => Promise<void>
  stopRemotePortForward: (id: string, configId: string) => Promise<void>
  scanRemotePorts: (id: string) => Promise<void>
  refreshRemotePortSessions: (id: string) => Promise<void>
  applyRemotePortSessionChanged: (session: RemotePortForwardSession) => void
```

- [ ] **Step 4: Initialize empty state**

In `src/renderer/stores/repos/helpers.ts`, import the state type and add:

```ts
export function emptyRemotePorts(): RepoRemotePortsState {
  return {
    configs: [],
    sessions: {},
    actionBusyByConfig: {},
    scan: {
      phase: 'idle',
      ports: [],
      message: null,
      error: null,
    },
  }
}
```

Add `remotePorts: emptyRemotePorts()` inside `emptyRepo()`.

- [ ] **Step 5: Add remote-port store module**

Create `src/renderer/stores/repos/remote-ports.ts`:

```ts
import { replaceRepoState, updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import type { ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'
import {
  normalizeRemotePortForwardConfig,
  type RemotePortForwardConfig,
  type RemotePortForwardSession,
} from '#/shared/remote-ports.ts'
import { rpc } from '#/renderer/rpc.ts'

function setPersistedConfig(
  configsByRepo: Record<string, RemotePortForwardConfig[]>,
  repoId: string,
  configs: RemotePortForwardConfig[],
): Record<string, RemotePortForwardConfig[]> {
  const next = { ...configsByRepo }
  if (configs.length === 0) delete next[repoId]
  else next[repoId] = configs
  return next
}

export function createRemotePortActions(set: ReposSet, get: ReposGet) {
  return {
    addRemotePortForward(
      id: string,
      input: { id?: string; remotePort: number; requestedLocalPort: number | null; label: string | null },
    ): RemotePortForwardConfig | null {
      const repo = get().repos[id]
      if (!repo || repo.kind !== 'remote') return null
      const config = normalizeRemotePortForwardConfig({ ...input, id: input.id ?? globalThis.crypto.randomUUID() })
      if (!config) return null
      set((s) => {
        const current = s.repos[id]
        if (!current || current.kind !== 'remote') return s
        const configs = [...current.remotePorts.configs.filter((item) => item.id !== config.id), config]
        return {
          ...replaceRepoState(s, current, (r) => {
            r.remotePorts.configs = configs
          }),
          remotePortConfigsByRepo: setPersistedConfig(s.remotePortConfigsByRepo, id, configs),
        }
      })
      return config
    },

    async removeRemotePortForward(id: string, configId: string): Promise<void> {
      await get().stopRemotePortForward(id, configId)
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.kind !== 'remote') return s
        const configs = repo.remotePorts.configs.filter((config) => config.id !== configId)
        return {
          ...replaceRepoState(s, repo, (r) => {
            r.remotePorts.configs = configs
            delete r.remotePorts.sessions[configId]
            delete r.remotePorts.actionBusyByConfig[configId]
          }),
          remotePortConfigsByRepo: setPersistedConfig(s.remotePortConfigsByRepo, id, configs),
        }
      })
    },

    async startRemotePortForward(id: string, configId: string): Promise<void> {
      const repo = get().repos[id]
      if (!repo || repo.kind !== 'remote' || !repo.remoteTarget) return
      const token = repo.instanceToken
      const config = repo.remotePorts.configs.find((item) => item.id === configId)
      if (!config || repo.remotePorts.actionBusyByConfig[configId]) return
      updateIfFresh(set, id, token, (r) => {
        r.remotePorts.actionBusyByConfig[configId] = true
      })
      try {
        const session = await rpc.remotePorts.start.mutate({ target: repo.remoteTarget, config })
        updateIfFresh(set, id, token, (r) => {
          r.remotePorts.sessions[configId] = session
          delete r.remotePorts.actionBusyByConfig[configId]
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        updateIfFresh(set, id, token, (r) => {
          r.remotePorts.sessions[configId] = {
            configId,
            repoId: id,
            remotePort: config.remotePort,
            requestedLocalPort: config.requestedLocalPort,
            actualLocalPort: config.requestedLocalPort ?? config.remotePort,
            localHost: '127.0.0.1',
            remoteHost: '127.0.0.1',
            status: 'failed',
            startedAt: Date.now(),
            message,
          }
          delete r.remotePorts.actionBusyByConfig[configId]
        })
      }
    },

    async stopRemotePortForward(id: string, configId: string): Promise<void> {
      const repo = get().repos[id]
      if (!repo || repo.kind !== 'remote' || !repo.remoteTarget) return
      const token = repo.instanceToken
      updateIfFresh(set, id, token, (r) => {
        r.remotePorts.actionBusyByConfig[configId] = true
      })
      try {
        await rpc.remotePorts.stop.mutate({ target: repo.remoteTarget, configId })
        updateIfFresh(set, id, token, (r) => {
          delete r.remotePorts.sessions[configId]
          delete r.remotePorts.actionBusyByConfig[configId]
        })
      } catch {
        updateIfFresh(set, id, token, (r) => {
          delete r.remotePorts.actionBusyByConfig[configId]
        })
      }
    },

    async scanRemotePorts(id: string): Promise<void> {
      const repo = get().repos[id]
      if (!repo || repo.kind !== 'remote' || !repo.remoteTarget || repo.remotePorts.scan.phase === 'loading') return
      const token = repo.instanceToken
      updateIfFresh(set, id, token, (r) => {
        r.remotePorts.scan.phase = 'loading'
        r.remotePorts.scan.error = null
      })
      try {
        const result = await rpc.remotePorts.scan.query({ target: repo.remoteTarget })
        updateIfFresh(set, id, token, (r) => {
          r.remotePorts.scan.phase = 'idle'
          r.remotePorts.scan.ports = result.ports
          r.remotePorts.scan.message = result.message ?? null
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        updateIfFresh(set, id, token, (r) => {
          r.remotePorts.scan.phase = 'idle'
          r.remotePorts.scan.error = message
        })
      }
    },

    async refreshRemotePortSessions(id: string): Promise<void> {
      const repo = get().repos[id]
      if (!repo || repo.kind !== 'remote' || !repo.remoteTarget) return
      const token = repo.instanceToken
      const sessions = await rpc.remotePorts.list.query({ target: repo.remoteTarget })
      updateIfFresh(set, id, token, (r) => {
        r.remotePorts.sessions = Object.fromEntries(sessions.map((session) => [session.configId, session]))
      })
    },

    applyRemotePortSessionChanged(session: RemotePortForwardSession): void {
      set((s) => {
        const repo = s.repos[session.repoId]
        if (!repo || repo.kind !== 'remote') return s
        return replaceRepoState(s, repo, (r) => {
          r.remotePorts.sessions[session.configId] = session
          delete r.remotePorts.actionBusyByConfig[session.configId]
        })
      })
    },
  }
}
```

- [ ] **Step 6: Wire store creation and persistence**

In `src/renderer/stores/repos/store.ts`, import:

```ts
import { createRemotePortActions } from '#/renderer/stores/repos/remote-ports.ts'
import { normalizeRemotePortConfigMap } from '#/shared/remote-ports.ts'
```

Extend persisted state:

```ts
interface PersistedReposStore {
  repoCache: Record<string, CachedRepoState>
  remotePortConfigsByRepo: Record<string, RemotePortForwardConfig[]>
}
```

Add `remotePortConfigsByRepo: {}` to initial state and `resetReposStore()`.

Spread the actions:

```ts
      ...createRemotePortActions(set, get),
```

Change `partialize`:

```ts
      partialize: (state): PersistedReposStore => ({
        repoCache: state.repoCache,
        remotePortConfigsByRepo: state.remotePortConfigsByRepo,
      }),
```

Change `merge`:

```ts
      merge: (persisted, current) => ({
        ...current,
        repoCache: normalizeRepoCache((persisted as RawPersistedReposStore | null)?.repoCache),
        remotePortConfigsByRepo: normalizeRemotePortConfigMap(
          (persisted as RawPersistedReposStore | null)?.remotePortConfigsByRepo,
        ),
      }),
```

- [ ] **Step 7: Hydrate configs into remote repos and cleanup on close**

In `src/renderer/stores/repos/lifecycle.ts`, when creating a remote repo in `addRemoteRepo`, assign saved configs:

```ts
      const repo = emptyRepo(target.id, target.displayName, { kind: 'remote', remoteTarget: target })
      repo.remotePorts.configs = s.remotePortConfigsByRepo[target.id] ?? []
```

In `closeRepo`, before or after `rpc.repo.abort`, add remote cleanup:

```ts
      const closing = get().repos[id]
      if (closing?.kind === 'remote' && closing.remoteTarget) {
        void rpc.remotePorts.cleanupRepo.mutate({ target: closing.remoteTarget }).catch(() => {})
      }
```

- [ ] **Step 8: Add default RPC mocks**

In `src/renderer/stores/repos/lifecycle-test-utils.ts`, add handlers:

```ts
    'remotePorts.list': () => [],
    'remotePorts.cleanupRepo': () => undefined,
```

In `src/renderer/stores/repos/test-utils.ts`, reset `remotePortConfigsByRepo: {}`.

- [ ] **Step 9: Add persistence and lifecycle assertions**

In `src/renderer/stores/repos/persistence.test.ts`, add:

```ts
  test('normalizes persisted remote port configs without persisting sessions', () => {
    const normalized = normalizeRemotePortConfigMap({
      [REMOTE_TARGET.id]: [{ id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: 'dev' }],
    })

    expect(normalized).toEqual({
      [REMOTE_TARGET.id]: [{ id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: 'dev' }],
    })
    expect(JSON.stringify(normalized)).not.toMatch(/actualLocalPort|running|startedAt/)
  })
```

In `src/renderer/stores/repos/lifecycle.test.ts`, add:

```ts
  test('closeRepo cleans up remote port forwards for remote repos only', async () => {
    const cleanupCalls: string[] = []
    installGoblin({
      'remote.testRepository': async () => ({ target: REMOTE_TARGET, ok: true, stages: [] }),
      'remotePorts.cleanupRepo': ({ target }: { target: RemoteRepoTarget }) => cleanupCalls.push(target.id),
    })

    await useReposStore.getState().openRemoteRepo(REMOTE_TARGET)
    useReposStore.getState().closeRepo(REMOTE_TARGET.id)

    expect(cleanupCalls).toEqual([REMOTE_TARGET.id])
  })
```

- [ ] **Step 10: Run store-related tests**

Run:

```sh
bun run test "src/renderer/stores/repos/remote-ports.test.ts" "src/renderer/stores/repos/persistence.test.ts" "src/renderer/stores/repos/lifecycle.test.ts" "src/renderer/stores/repos/lifecycle-hydrate.test.ts"
```

Expected: PASS.

## Task 5: Renderer Event Hook

**Files:**

- Create: `src/renderer/hooks/useRemotePortSessionEvents.ts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add the hook**

Create `src/renderer/hooks/useRemotePortSessionEvents.ts`:

```ts
import { useEffect } from 'react'
import { onRpcEventType } from '#/renderer/rpc.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'

export function useRemotePortSessionEvents(): void {
  useEffect(() => {
    const off = onRpcEventType('remote-port-session-changed', (event) => {
      useReposStore.getState().applyRemotePortSessionChanged(event.session)
    })
    return off
  }, [])
}
```

- [ ] **Step 2: Install the hook**

In `src/renderer/App.tsx`, import:

```ts
import { useRemotePortSessionEvents } from '#/renderer/hooks/useRemotePortSessionEvents.ts'
```

Call it next to the other app-level hooks:

```ts
  useRemotePortSessionEvents()
```

- [ ] **Step 3: Run renderer typecheck**

Run:

```sh
bun run typecheck
```

Expected: PASS.

## Task 6: Remote Ports Toolbar UI

**Files:**

- Create: `src/renderer/components/repo-toolbar/RemotePortsPopover.tsx`
- Create: `src/renderer/components/repo-toolbar/RemotePortsPopover.ui.test.tsx`
- Modify: `src/renderer/components/repo-toolbar/RepoToolbarActions.tsx`
- Modify: `src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx`
- Modify: `src/main/i18n/en.ts`
- Modify: `src/main/i18n/zh.ts`
- Modify: `src/main/i18n/ja.ts`
- Modify: `src/main/i18n/ko.ts`

- [ ] **Step 1: Write UI interaction tests**

Create `src/renderer/components/repo-toolbar/RemotePortsPopover.ui.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RemotePortsPopover } from '#/renderer/components/repo-toolbar/RemotePortsPopover.tsx'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'

const storeActions = vi.hoisted(() => ({
  addRemotePortForward: vi.fn(),
  removeRemotePortForward: vi.fn(),
  startRemotePortForward: vi.fn(),
  stopRemotePortForward: vi.fn(),
  scanRemotePorts: vi.fn(),
}))

vi.mock('#/renderer/stores/repos/store.ts', () => ({
  useReposStore: (selector: any) => selector(storeActions),
}))

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

function remoteRepo(): RepoState {
  const repo = emptyRepo('ssh://deploy@prod:22/srv/goblin', 'prod:goblin', {
    kind: 'remote',
    remoteTarget: {
      id: 'ssh://deploy@prod:22/srv/goblin',
      alias: null,
      host: 'prod',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      displayName: 'prod:goblin',
    },
  })
  repo.remotePorts.configs = [{ id: 'cfg-1', remotePort: 3000, requestedLocalPort: 3000, label: 'dev' }]
  repo.remotePorts.sessions = {
    'cfg-1': {
      configId: 'cfg-1',
      repoId: repo.id,
      remotePort: 3000,
      requestedLocalPort: 3000,
      actualLocalPort: 49152,
      localHost: '127.0.0.1',
      remoteHost: '127.0.0.1',
      status: 'running',
      startedAt: 123,
    },
  }
  repo.remotePorts.scan.ports = [{ port: 5173, protocol: 'tcp', processName: 'vite', pid: '123', address: '127.0.0.1' }]
  return repo
}

describe('RemotePortsPopover', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    Object.values(storeActions).forEach((fn) => fn.mockReset())
    storeActions.addRemotePortForward.mockReturnValue({ id: 'new', remotePort: 8080, requestedLocalPort: null, label: null })
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  })

  test('shows running url and requested local port hint', async () => {
    await act(async () => {
      root.render(<RemotePortsPopover repo={remoteRepo()} />)
    })

    expect(document.body.textContent).toContain('http://127.0.0.1:49152')
    expect(document.body.textContent).toContain('remote-ports.requested-local')
  })

  test('adds a manual remote port config', async () => {
    await act(async () => {
      root.render(<RemotePortsPopover repo={remoteRepo()} />)
    })

    const remoteInput = document.querySelector<HTMLInputElement>('#remote-port-forward-remote-port')
    expect(remoteInput).not.toBeNull()
    await act(async () => {
      remoteInput!.value = '8080'
      remoteInput!.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector<HTMLFormElement>('[data-remote-port-form]')?.dispatchEvent(
        new SubmitEvent('submit', { bubbles: true, cancelable: true }),
      )
    })

    expect(storeActions.addRemotePortForward).toHaveBeenCalledWith(remoteRepo().id, {
      remotePort: 8080,
      requestedLocalPort: null,
      label: null,
    })
  })
})
```

- [ ] **Step 2: Run UI test and verify red**

Run:

```sh
bun run test "src/renderer/components/repo-toolbar/RemotePortsPopover.ui.test.tsx"
```

Expected: FAIL because `RemotePortsPopover.tsx` does not exist.

- [ ] **Step 3: Add the popover component**

Create `src/renderer/components/repo-toolbar/RemotePortsPopover.tsx`:

```tsx
import { Copy, ExternalLink, Plug, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '#/renderer/components/ui/button.tsx'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '#/renderer/components/ui/popover.tsx'
import { Tip } from '#/renderer/components/Tip.tsx'
import { useT } from '#/renderer/stores/i18n.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { formatRemotePortForwardUrl, type RemotePortForwardConfig } from '#/shared/remote-ports.ts'

interface Props {
  repo: RepoState
}

export function RemotePortsPopover({ repo }: Props) {
  const t = useT()
  const [remotePort, setRemotePort] = useState('')
  const [localPort, setLocalPort] = useState('')
  const addRemotePortForward = useReposStore((s) => s.addRemotePortForward)
  const removeRemotePortForward = useReposStore((s) => s.removeRemotePortForward)
  const startRemotePortForward = useReposStore((s) => s.startRemotePortForward)
  const stopRemotePortForward = useReposStore((s) => s.stopRemotePortForward)
  const scanRemotePorts = useReposStore((s) => s.scanRemotePorts)
  const runningCount = Object.values(repo.remotePorts.sessions).filter((session) => session.status === 'running').length

  function parsePort(value: string): number | null {
    if (!value.trim()) return null
    const n = Number(value)
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
  }

  function addManual(event: React.FormEvent) {
    event.preventDefault()
    const parsedRemote = parsePort(remotePort)
    const parsedLocal = parsePort(localPort)
    if (!parsedRemote || (localPort.trim() && !parsedLocal)) return
    const config = addRemotePortForward(repo.id, {
      remotePort: parsedRemote,
      requestedLocalPort: parsedLocal,
      label: null,
    })
    if (config) {
      setRemotePort('')
      setLocalPort('')
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" aria-label={t('remote-ports.title')}>
          <Plug />
          {t('remote-ports.button')}
          {runningCount > 0 && (
            <Badge variant="success" className="font-mono tabular-nums">
              {runningCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <PopoverHeader className="border-b border-separator px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <PopoverTitle>{t('remote-ports.title')}</PopoverTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={repo.remotePorts.scan.phase === 'loading'}
              onClick={() => void scanRemotePorts(repo.id)}
              aria-label={t('remote-ports.scan')}
              title={t('remote-ports.scan')}
            >
              <RefreshCw className={repo.remotePorts.scan.phase === 'loading' ? 'animate-spin' : undefined} />
            </Button>
          </div>
        </PopoverHeader>

        <div className="space-y-3 p-3">
          <form data-remote-port-form className="grid grid-cols-[1fr_1fr_auto] gap-2" onSubmit={addManual}>
            <input
              id="remote-port-forward-remote-port"
              value={remotePort}
              onChange={(event) => setRemotePort(event.target.value)}
              placeholder={t('remote-ports.remote-port')}
              className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            />
            <input
              value={localPort}
              onChange={(event) => setLocalPort(event.target.value)}
              placeholder={t('remote-ports.local-port')}
              className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            />
            <Button type="submit" variant="outline">
              {t('remote-ports.add')}
            </Button>
          </form>

          <div className="space-y-1.5">
            {repo.remotePorts.configs.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                {t('remote-ports.empty')}
              </div>
            ) : (
              repo.remotePorts.configs.map((config) => (
                <RemotePortRow
                  key={config.id}
                  repo={repo}
                  config={config}
                  onStart={() => void startRemotePortForward(repo.id, config.id)}
                  onStop={() => void stopRemotePortForward(repo.id, config.id)}
                  onRemove={() => void removeRemotePortForward(repo.id, config.id)}
                />
              ))
            )}
          </div>

          {(repo.remotePorts.scan.message || repo.remotePorts.scan.error) && (
            <div className="text-xs text-muted-foreground">{repo.remotePorts.scan.error ?? repo.remotePorts.scan.message}</div>
          )}

          {repo.remotePorts.scan.ports.length > 0 && (
            <div className="space-y-1.5 border-t border-separator pt-3">
              <div className="text-xs font-medium text-foreground">{t('remote-ports.discovered')}</div>
              {repo.remotePorts.scan.ports.map((port) => (
                <div key={`${port.port}:${port.pid ?? ''}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate font-mono">:{port.port}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{port.processName ?? t('remote-ports.unknown-process')}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      addRemotePortForward(repo.id, {
                        remotePort: port.port,
                        requestedLocalPort: port.port,
                        label: port.processName,
                      })
                    }
                  >
                    {t('remote-ports.forward')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function RemotePortRow({
  repo,
  config,
  onStart,
  onStop,
  onRemove,
}: {
  repo: RepoState
  config: RemotePortForwardConfig
  onStart: () => void
  onStop: () => void
  onRemove: () => void
}) {
  const t = useT()
  const session = repo.remotePorts.sessions[config.id]
  const busy = repo.remotePorts.actionBusyByConfig[config.id] === true
  const url = session?.status === 'running' ? formatRemotePortForwardUrl(session) : null
  const requested = session?.requestedLocalPort ?? config.requestedLocalPort
  const requestedMismatch = session?.status === 'running' && requested !== null && requested !== session.actualLocalPort

  return (
    <div className="rounded-md border border-border px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">
            {config.label ?? t('remote-ports.mapping', { remotePort: config.remotePort })}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {url ?? t('remote-ports.local-target', { localPort: config.requestedLocalPort ?? config.remotePort })}
          </div>
          {requestedMismatch && <div className="text-[11px] text-muted-foreground">{t('remote-ports.requested-local', { port: requested })}</div>}
          {session?.message && <div className="truncate text-[11px] text-danger">{session.message}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={session?.status === 'running' ? 'success' : session?.status === 'failed' ? 'danger' : 'outline'}>
            {session?.status ?? 'stopped'}
          </Badge>
          {url && (
            <>
              <Tip label={t('remote-ports.copy-url')}>
                <Button type="button" variant="ghost" size="icon" className="size-6" onClick={() => void navigator.clipboard.writeText(url)}>
                  <Copy />
                </Button>
              </Tip>
              <Tip label={t('remote-ports.open-url')}>
                <Button type="button" variant="ghost" size="icon" className="size-6" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
                  <ExternalLink />
                </Button>
              </Tip>
            </>
          )}
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={session?.status === 'running' ? onStop : onStart}>
            {t(session?.status === 'running' ? 'remote-ports.stop' : 'remote-ports.start')}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-6" disabled={busy} onClick={onRemove} aria-label={t('remote-ports.remove')}>
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add toolbar integration**

In `src/renderer/components/repo-toolbar/RepoToolbarActions.tsx`, import:

```ts
import { RemotePortsPopover } from '#/renderer/components/repo-toolbar/RemotePortsPopover.tsx'
```

In the remote repo branch, render the popover before refresh:

```tsx
        <RemotePortsPopover repo={repo} />
```

- [ ] **Step 5: Add i18n keys**

Add these keys to `src/main/i18n/en.ts` and matching translations to `zh.ts`, `ja.ts`, and `ko.ts`:

```ts
  'remote-ports.button': 'Ports',
  'remote-ports.title': 'Remote ports',
  'remote-ports.scan': 'Scan remote ports',
  'remote-ports.remote-port': 'Remote port',
  'remote-ports.local-port': 'Local port',
  'remote-ports.add': 'Add',
  'remote-ports.empty': 'No forwarded ports.',
  'remote-ports.discovered': 'Discovered ports',
  'remote-ports.forward': 'Forward',
  'remote-ports.start': 'Start',
  'remote-ports.stop': 'Stop',
  'remote-ports.remove': 'Remove forwarded port',
  'remote-ports.copy-url': 'Copy URL',
  'remote-ports.open-url': 'Open in browser',
  'remote-ports.mapping': 'Remote :{remotePort}',
  'remote-ports.local-target': '127.0.0.1:{localPort}',
  'remote-ports.requested-local': 'requested {port}',
  'remote-ports.unknown-process': 'unknown process',
  'remote-ports.scan-unavailable': 'No remote port scanner is available.',
```

- [ ] **Step 6: Update toolbar test**

In `src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx`, add `remotePorts` action selectors to the store mock:

```ts
      addRemotePortForward: vi.fn(),
      removeRemotePortForward: vi.fn(),
      startRemotePortForward: vi.fn(),
      stopRemotePortForward: vi.fn(),
      scanRemotePorts: vi.fn(),
```

Update the remote toolbar assertion:

```ts
    expect(html).toContain('remote-ports.button')
```

- [ ] **Step 7: Run UI tests**

Run:

```sh
bun run test "src/renderer/components/repo-toolbar/RemotePortsPopover.ui.test.tsx" "src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx"
```

Expected: PASS.

## Task 7: Final Verification And Fixes

**Files:**

- Review all files changed by Tasks 1-6.

- [ ] **Step 1: Run focused remote-port test set**

Run:

```sh
bun run test "src/shared/remote-ports.test.ts" "src/main/ssh/port-forward.test.ts" "src/main/rpc.test.ts" "src/renderer/stores/repos/remote-ports.test.ts" "src/renderer/components/repo-toolbar/RemotePortsPopover.ui.test.tsx"
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```sh
bun run test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```sh
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect implementation for safety boundaries**

Run:

```sh
rg -n "0\\.0\\.0\\.0|-R\\b|-D\\b|BatchMode|PasswordAuthentication|passphrase|privateKey|shellQuote\\(|sh -lc" "src/main/ssh/port-forward.ts" "src/renderer/components/repo-toolbar/RemotePortsPopover.tsx" "src/renderer/stores/repos/remote-ports.ts"
```

Expected:

- No `0.0.0.0`, `-R`, or `-D`.
- No password, passphrase, or private key content handling.
- No renderer-side shell command construction.
- `sh -lc` should not appear in the port-forward manager.

- [ ] **Step 5: Manual smoke test**

Run the app:

```sh
bun run dev
```

Expected:

- Remote repo toolbar shows `Ports`.
- Add a manual remote port config.
- Start it and verify the row shows `http://127.0.0.1:<actualLocalPort>`.
- Stop it and verify the running badge disappears.
- Scan remote ports and verify failure is non-blocking if the host lacks `ss`, `lsof`, and `netstat`.
- Close the remote repo tab and verify no tunnel remains running.
