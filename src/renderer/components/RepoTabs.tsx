// Top repository tab strip — one compact tab per opened repository. Click
// to focus, hover to reveal the close (×) button. The active tab gets a
// raised surface treatment so it reads as the selected workspace above the
// repository body.
//
// Drag-to-reorder uses dnd-kit (the de-facto choice in the React/shadcn/
// tanstack ecosystem). PointerSensor with a small activation distance lets
// a regular click still focus the repo without triggering a drag; keyboard
// users use Arrow keys for tab activation.
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { RepoTabStrip } from '#/renderer/components/repo-tabs/RepoTabStrip.tsx'
import type { RepoTabConnectionStatus, RepoTabSummary } from '#/renderer/components/repo-tabs/types.ts'
import { useTerminalSessionContext } from '#/renderer/components/terminal/terminal-session-context.ts'
import { openRepoFromDialog } from '#/renderer/lib/open-repo-dialog.ts'
import { resourceBusy } from '#/renderer/stores/repos/resources.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { remoteTargetSubtitle } from '#/shared/remote-repo.ts'

/** Equality fn for the summaries array. Zustand's `useShallow` does
 *  Object.is on each element — but we re-create the inner objects
 *  every selector run, so refs always differ. Compare the relevant
 *  string fields explicitly so the tab strip only re-renders when the
 *  rendered text actually changes. */
function summariesEqual(a: RepoTabSummary[], b: RepoTabSummary[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.kind !== y.kind ||
      x.targetLabel !== y.targetLabel ||
      x.diagnosticStatus !== y.diagnosticStatus ||
      x.diagnosticCategory !== y.diagnosticCategory ||
      x.diagnosticMessage !== y.diagnosticMessage ||
      x.unavailable !== y.unavailable ||
      x.unreadBellCount !== y.unreadBellCount ||
      (x.remoteDetails?.length ?? 0) !== (y.remoteDetails?.length ?? 0)
    ) {
      return false
    }
    const xRemoteDetails = x.remoteDetails ?? []
    const yRemoteDetails = y.remoteDetails ?? []
    for (let j = 0; j < xRemoteDetails.length; j++) {
      const xr = xRemoteDetails[j]!
      const yr = yRemoteDetails[j]!
      if (xr.name !== yr.name || xr.fetchUrl !== yr.fetchUrl || xr.pushUrl !== yr.pushUrl) return false
    }
  }
  return true
}

function remoteConnectionStatus(repo: RepoState): RepoTabConnectionStatus | undefined {
  if (repo.kind !== 'remote') return undefined
  if (resourceBusy(repo.resources.diagnostics)) return 'checking'
  if (repo.diagnostics?.ok === true) return 'online'
  if (repo.diagnostics?.ok === false) return 'offline'
  return 'unknown'
}

interface RepoTabsProps {
  onClone: () => void
  onAddRemote: () => void
}

export function RepoTabs({ onClone, onAddRemote }: RepoTabsProps) {
  const t = useT()
  const terminalContext = useTerminalSessionContext()
  const shortcutsDisabled = useSettingsStore((s) => s.shortcutsDisabled)
  // Build the summary array inside the selector but compare with our
  // explicit equality fn so re-derivations with identical contents
  // don't trigger a re-render. Zustand v5's primary `useReposStore`
  // hook drops the second-arg equality fn — `useStoreWithEqualityFn`
  // from `zustand/traditional` is the v5 escape hatch for cases like
  // this where shallow on Object.is misses the structurally-equal
  // case.
  const summaries = useStoreWithEqualityFn(
    useReposStore,
    (s) =>
      s.order
        .map<RepoTabSummary | null>((id) => {
          const r = s.repos[id]
          if (!r) return null
          return {
            id: r.id,
            name: r.name,
            kind: r.kind,
            targetLabel: r.remoteTarget ? remoteTargetSubtitle(r.remoteTarget) : null,
            diagnosticStatus: remoteConnectionStatus(r),
            diagnosticCategory: r.kind === 'remote' && r.diagnostics?.ok === false ? r.diagnostics.category : undefined,
            diagnosticMessage:
              r.kind === 'remote' && r.diagnostics?.ok === false ? (r.diagnostics.message ?? null) : null,
            remoteDetails: r.remote.remoteDetails ?? [],
            unavailable: r.availability.phase === 'unavailable',
            unreadBellCount: terminalContext.unreadBellCountByRepo(r.id),
          }
        })
        .filter((x): x is RepoTabSummary => x !== null),
    summariesEqual,
  )
  const activeId = useReposStore((s) => s.activeId)
  const setActive = useReposStore((s) => s.setActive)
  const closeRepo = useReposStore((s) => s.closeRepo)
  const openRepo = useReposStore((s) => s.openRepo)
  const reorderRepos = useReposStore((s) => s.reorderRepos)

  async function handleOpenLocal() {
    await openRepoFromDialog({ openRepo, t })
  }

  return (
    <RepoTabStrip
      repos={summaries}
      activeId={activeId}
      labels={{
        repositories: t('repo-tabs.repos'),
        close: t('repo-tabs.close'),
        dragToReorder: t('repo-tabs.drag-to-reorder'),
        open: t('topbar.open'),
        openLocal: t('repo-tabs.open-local'),
        openLocalShortcut: shortcutsDisabled ? null : '⌘O',
        clone: t('repo-tabs.clone'),
        cloneShortcut: shortcutsDisabled ? null : '⌘⇧O',
        addRemote: t('repo-tabs.add-remote'),
        unavailable: t('repo-unavailable.title'),
        bellUnreadCount: (count) => t('terminal.bell-unread-count', { count }),
      }}
      onActivate={setActive}
      onClose={closeRepo}
      onReorder={reorderRepos}
      onOpenLocal={handleOpenLocal}
      onClone={onClone}
      onAddRemote={onAddRemote}
    />
  )
}
