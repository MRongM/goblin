import pLimit from 'p-limit'
import { lastPathSegment } from '#/renderer/lib/paths.ts'
import { emptyRepo, inFlightFetchById, updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import { normalizeBranchOrder } from '#/renderer/stores/repos/branch-view-mode.ts'
import { hydrateCachedRepo } from '#/renderer/stores/repos/persistence.ts'
import { disposeRepoRuntime } from '#/renderer/stores/repos/runtime.ts'
import { runInitialRepoLoad } from '#/renderer/stores/repos/refresh-workflows.ts'
import { cancelResource, finishResourceError, finishResourceSuccess, startResource } from '#/renderer/stores/repos/resources.ts'
import type { MissingRepo, OpenRepoResult, ReposGet, ReposSet, ReposStore } from '#/renderer/stores/repos/types.ts'
import { normalizeRemoteTarget, type RemoteRepoTarget, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import { rpc } from '#/renderer/rpc.ts'

interface ResolvedRepo {
  id: string
  name: string
}

interface ProbeResult {
  input: string
  reason: string | null
  repo: ResolvedRepo | null
}

interface InitialRepoRefresh {
  id: string
  token: number
}

const SESSION_PROBE_CONCURRENCY = 4

async function resolveRepoPath(
  p: string,
  onError?: (err: unknown) => void,
  fallbackError = 'error.failed-read-repo',
): Promise<ProbeResult> {
  try {
    const probe = await rpc.repo.probe.query({ cwd: p })
    if (!probe?.ok || !probe.root) return { input: p, reason: probe?.message ?? 'error.not-git-repo', repo: null }
    return {
      input: p,
      reason: null,
      repo: { id: probe.root, name: probe.name ?? lastPathSegment(probe.root) },
    }
  } catch (err) {
    onError?.(err)
    return { input: p, reason: err instanceof Error ? err.message : fallbackError, repo: null }
  }
}

function orderedInsert(order: string[], id: string, rankById?: ReadonlyMap<string, number>): string[] {
  if (!rankById) return [...order, id]
  const rank = rankById.get(id)
  if (rank === undefined) return [...order, id]
  const next = [...order]
  const index = next.findIndex((existing) => {
    const existingRank = rankById.get(existing)
    return existingRank !== undefined && existingRank > rank
  })
  next.splice(index === -1 ? next.length : index, 0, id)
  return next
}

function addResolvedRepo(
  s: Pick<ReposStore, 'repos' | 'repoCache' | 'branchOrdersByRepo' | 'order'>,
  resolvedRepo: ResolvedRepo,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean } {
  const { id, name } = resolvedRepo
  if (s.repos[id]) return { repos: s.repos, order: s.order, changed: false }
  const repo = hydrateCachedRepo(emptyRepo(id, name), s.repoCache[id])
  const branchOrder = s.branchOrdersByRepo[id] ?? []
  repo.ui.branchOrder =
    repo.data.branches.length > 0 ? normalizeBranchOrder(repo.data.branches, branchOrder) : branchOrder
  return {
    repos: { ...s.repos, [id]: repo },
    order: orderedInsert(s.order, id, rankById),
    changed: true,
  }
}

function addRemoteRepo(
  s: Pick<ReposStore, 'repos' | 'branchOrdersByRepo' | 'order' | 'remotePortConfigsByRepo'>,
  target: RemoteRepoTarget,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean } {
  if (s.repos[target.id]) return { repos: s.repos, order: s.order, changed: false }
  const repo = emptyRepo(target.id, target.displayName, { kind: 'remote', remoteTarget: target })
  repo.ui.branchOrder = s.branchOrdersByRepo[target.id] ?? []
  repo.remotePorts.configs = s.remotePortConfigsByRepo[target.id] ?? []
  return {
    repos: {
      ...s.repos,
      [target.id]: repo,
    },
    order: orderedInsert(s.order, target.id, rankById),
    changed: true,
  }
}

function activeAfterHydrateStep(
  s: Pick<ReposStore, 'activeId'>,
  repos: Record<string, unknown>,
  order: string[],
  activeRepo: string | null,
  managedActiveId: string | null,
): string | null {
  if (s.activeId && s.activeId !== managedActiveId && repos[s.activeId]) return s.activeId
  if (activeRepo && repos[activeRepo]) return activeRepo
  return order[0] ?? null
}

function refreshInitialRepoState(get: ReposGet, refresh: InitialRepoRefresh) {
  const repo = get().repos[refresh.id]
  if (!repo || repo.instanceToken !== refresh.token) return
  runInitialRepoLoad(get, refresh)
}

function normalizeHydrateEntry(value: RepoSessionEntry | string): RepoSessionEntry | null {
  if (typeof value === 'string') return { kind: 'local', id: value }
  if (value.kind === 'local') return value
  const target = normalizeRemoteTarget(value.target)
  return target && value.id === target.id ? { kind: 'remote', id: target.id, target } : null
}

export function createLifecycleActions(set: ReposSet, get: ReposGet) {
  return {
    async openRepo(p: string, options?: { activate?: boolean }): Promise<OpenRepoResult> {
      const resolved = await resolveRepoPath(p, undefined, 'error.not-git-repo')
      if (!resolved.repo) return { ok: false, message: resolved.reason ?? 'error.not-git-repo' }
      const repo = resolved.repo
      const { id } = repo
      const activate = options?.activate !== false
      let initialRefresh: InitialRepoRefresh | null = null
      void rpc.settings.addRecentRepo.mutate({ repoPath: id }).catch(() => {
        /* recent menu is best-effort */
      })

      // Branch on the two axes (already in store? activating?) so each
      // case writes only what actually changes. zustand v5 short-circuits
      // notification when the setter returns the *same* state reference
      // (`Object.is(next, prev)`), so returning `s` when there's nothing
      // to do skips both the merge and the listener fan-out.
      set((s) => {
        const existingRepo = s.repos[id]
        const { repos, order, changed } = addResolvedRepo(s, repo)
        const repoToRefresh = changed ? repos[id] : existingRepo
        if (repoToRefresh) initialRefresh = { id, token: repoToRefresh.instanceToken }
        if (!changed) {
          // Already active or caller doesn't want to focus → genuine no-op.
          if (!activate || s.activeId === id) return s
          return { activeId: id }
        }
        return activate ? { repos, order, activeId: id } : { repos, order }
      })

      if (initialRefresh) refreshInitialRepoState(get, initialRefresh)
      return { ok: true, id }
    },

    async openRemoteRepo(targetInput: RemoteRepoTarget, options?: { activate?: boolean }): Promise<OpenRepoResult> {
      const target = normalizeRemoteTarget(targetInput)
      if (!target || targetInput.id !== target.id) return { ok: false, message: 'error.invalid-arguments' }
      const activate = options?.activate !== false
      set((s) => {
        const { repos, order, changed } = addRemoteRepo(s, target)
        if (!changed) {
          if (!activate || s.activeId === target.id) return s
          return { activeId: target.id }
        }
        return activate ? { repos, order, activeId: target.id } : { repos, order }
      })
      const repo = get().repos[target.id]
      if (repo) {
        void get().refreshRemoteDiagnostics(repo.id, { token: repo.instanceToken })
        void get().refreshSnapshot(repo.id, { token: repo.instanceToken })
      }
      return { ok: true, id: target.id }
    },

    closeRepo(id: string) {
      const closing = get().repos[id]
      // Drop any in-flight fetch tracking so a new openRepo of the same
      // path doesn't think a fetch is already running.
      inFlightFetchById.delete(id)
      disposeRepoRuntime(id)
      // Tell main to abort any cancellable network op for this repo —
      // otherwise a `git push` started right before the user closed the
      // tab keeps running for up to the network timeout, charged to a
      // tab that no longer exists. Fire-and-forget; failure is fine.
      void rpc.repo.abort.mutate({ cwd: id }).catch(() => {
        /* main may have nothing to abort — ignore */
      })
      if (closing?.kind === 'remote' && closing.remoteTarget) {
        void rpc.remotePorts.cleanupRepo.mutate({ target: closing.remoteTarget }).catch(() => {
          /* remote port cleanup is best-effort on tab close */
        })
      }
      set((s) => {
        if (!s.repos[id]) return s
        const repos = { ...s.repos }
        delete repos[id]
        const order = s.order.filter((x) => x !== id)
        let activeId = s.activeId
        // Slide focus to the right neighbour; fall back to the left if
        // we just removed the rightmost tab.
        if (activeId === id) {
          const idx = s.order.indexOf(id)
          activeId = order[idx] ?? order[idx - 1] ?? null
        }
        return { repos, order, activeId }
      })
    },

    async hydrateSession(openRepos: Array<RepoSessionEntry | string>, activeRepo: string | null) {
      // Probe in parallel; entries that are no longer git repos (folder
      // moved/deleted, external drive not mounted) get reported via
      // `missingFromSession` so the user sees a "couldn't reopen N repos"
      // notice in the tab strip instead of wondering where their tabs went.
      const rankById = new Map<string, number>()
      const missingByIndex: Array<MissingRepo | undefined> = []
      let managedActiveId: string | null = null
      const limitProbe = pLimit(SESSION_PROBE_CONCURRENCY)
      await Promise.all(
        openRepos.map((rawEntry, index) =>
          limitProbe(async () => {
            const entry = normalizeHydrateEntry(rawEntry)
            if (!entry) return
            if (entry.kind === 'remote') {
              if (!rankById.has(entry.id)) rankById.set(entry.id, index)
              set((s) => {
                const { repos, order } = addRemoteRepo(s, entry.target, rankById)
                const activeId = activeAfterHydrateStep(s, repos, order, activeRepo, managedActiveId)
                if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = activeId
                if (repos === s.repos && order === s.order && activeId === s.activeId) return s
                return { repos, order, activeId }
              })
              const repo = get().repos[entry.id]
              if (repo) {
                void get().refreshRemoteDiagnostics(repo.id, { token: repo.instanceToken })
                void get().refreshSnapshot(repo.id, { token: repo.instanceToken })
              }
              return
            }
            const p = entry.id
            const probe = await resolveRepoPath(p, (err) => {
              console.warn(`[session] probe failed for ${p}:`, err)
            })
            if (!probe.repo) {
              missingByIndex[index] = { path: probe.input, reason: probe.reason ?? 'error.failed-read-repo' }
              return
            }

            const resolvedRepo = probe.repo
            if (!rankById.has(resolvedRepo.id)) rankById.set(resolvedRepo.id, index)
            let initialRefresh: InitialRepoRefresh | null = null
            set((s) => {
              const { repos, order } = addResolvedRepo(s, resolvedRepo, rankById)
              const repo = repos[resolvedRepo.id]
              if (repo) initialRefresh = { id: repo.id, token: repo.instanceToken }
              const activeId = activeAfterHydrateStep(s, repos, order, activeRepo, managedActiveId)
              if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = activeId
              if (repos === s.repos && order === s.order && activeId === s.activeId) return s
              return { repos, order, activeId }
            })
            // See `openRepo`: status backs the selected-branch detail badge,
            // so we hydrate it for every restored repo, not just the active
            // one — switching after boot shouldn't reveal a stale 0.
            if (initialRefresh) refreshInitialRepoState(get, initialRefresh)
          }),
        ),
      )

      set((s) => {
        const activeId = activeAfterHydrateStep(s, s.repos, s.order, activeRepo, managedActiveId)
        if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = activeId
        return {
          activeId,
          sessionReady: true,
          missingFromSession: missingByIndex.filter((x): x is MissingRepo => !!x),
        }
      })
    },

    dismissMissing() {
      set({ missingFromSession: [] })
    },

    async refreshRemoteDiagnostics(id: string, options?: { token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore || repoBefore.kind !== 'remote' || !repoBefore.remoteTarget) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      updateIfFresh(set, id, token, (r) => {
        startResource(r.resources.diagnostics, { hasData: r.diagnostics !== null })
      })
      try {
        const diagnostics = await rpc.remote.testRepository.query({ target: repoBefore.remoteTarget })
        updateIfFresh(set, id, token, (r) => {
          r.diagnostics = diagnostics
          if (diagnostics.category === 'cancelled') {
            cancelResource(r.resources.diagnostics)
          } else if (diagnostics.ok) {
            finishResourceSuccess(r.resources.diagnostics)
          } else {
            finishResourceError(r.resources.diagnostics, diagnostics.category ?? diagnostics.message ?? 'unknown')
          }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        updateIfFresh(set, id, token, (r) => {
          finishResourceError(r.resources.diagnostics, message)
        })
      }
    },
  }
}
