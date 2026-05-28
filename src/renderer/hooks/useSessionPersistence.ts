import { useEffect } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { rpc } from '#/renderer/rpc.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

function sessionEntriesEqual(a: RepoSessionEntry[], b: RepoSessionEntry[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!
    const y = b[i]!
    if (x.kind !== y.kind || x.id !== y.id) return false
    if (x.kind === 'remote' && y.kind === 'remote' && x.target !== y.target) return false
  }
  return true
}

export function useSessionPersistence() {
  const activeId = useReposStore((s) => s.activeId)
  const openRepos = useStoreWithEqualityFn(
    useReposStore,
    (s) =>
      s.order
        .map<RepoSessionEntry | null>((id) => {
          const repo = s.repos[id]
          if (!repo) return null
          if (repo.kind === 'remote') {
            return repo.remoteTarget ? { kind: 'remote', id: repo.id, target: repo.remoteTarget } : null
          }
          return { kind: 'local', id: repo.id }
        })
        .filter((entry): entry is RepoSessionEntry => entry !== null),
    sessionEntriesEqual,
  )
  const detailCollapsed = useReposStore((s) => s.detailCollapsed)
  const detailFocusMode = useReposStore((s) => s.detailFocusMode)
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const detailPaneSizes = useReposStore((s) => s.detailPaneSizes)
  const sessionReady = useReposStore((s) => s.sessionReady)

  useEffect(() => {
    if (!sessionReady) return
    void rpc.settings.saveSession
      .mutate({
        session: {
          openRepos,
          activeRepo: activeId,
          detailCollapsed,
          detailFocusMode,
          workspaceLayout,
          detailPaneSizes,
        },
      })
      .catch((err) => {
        console.warn('[session] save failed', err)
      })
  }, [sessionReady, openRepos, activeId, detailCollapsed, detailFocusMode, workspaceLayout, detailPaneSizes])
}
