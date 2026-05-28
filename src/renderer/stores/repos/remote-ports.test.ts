import { beforeEach, describe, expect, test, vi } from 'vitest'
import { installGoblinTestBridge, resetReposStore } from '#/renderer/stores/repos/test-utils.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
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
