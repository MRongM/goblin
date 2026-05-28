import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, test, vi } from 'vitest'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

vi.mock('#/main/events.ts', () => ({
  broadcastRpcEvent: vi.fn(),
}))

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
