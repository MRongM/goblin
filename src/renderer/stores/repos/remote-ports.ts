import { replaceRepoState, updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import type { ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'
import { rpc } from '#/renderer/rpc.ts'
import {
  normalizeRemotePortForwardConfig,
  type RemotePortForwardConfig,
  type RemotePortForwardSession,
} from '#/shared/remote-ports.ts'

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

function createConfigId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `remote-port-${Date.now().toString(36)}`
}

export function createRemotePortActions(set: ReposSet, get: ReposGet) {
  return {
    addRemotePortForward(
      id: string,
      input: { id?: string; remotePort: number; requestedLocalPort: number | null; label: string | null },
    ): RemotePortForwardConfig | null {
      const repo = get().repos[id]
      if (!repo || repo.kind !== 'remote') return null
      const config = normalizeRemotePortForwardConfig({ ...input, id: input.id ?? createConfigId() })
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
