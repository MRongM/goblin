// Persistent branch list. Each row shows branch name, lightweight
// scan signals, and the head commit subject, author, and relative date. The
// selected row scrolls into view automatically when the user moves with
// j/k or arrows so a long branch list doesn't strand the cursor offscreen.
//
// Worktree branches use a folder-tree glyph and a compact chip beside the
// name. We avoid tinting the whole row so selection, hover, and status
// semantics don't compete for background colour.

import { useCallback, useEffect, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import { visibleBranches } from '#/renderer/stores/repos/branch-view-mode.ts'
import { BranchRow } from '#/renderer/components/branch-list/BranchRow.tsx'
import { EmptyState } from '#/renderer/components/Layout.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { ScrollArea } from '#/renderer/components/ui/scroll-area.tsx'
import { branchActionsAvailable } from '#/renderer/hooks/branch-action-state.ts'
import { resourceBusy } from '#/renderer/stores/repos/resources.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'

interface Props {
  repoId: string
  showActions?: boolean
  variant?: 'list' | 'selected-strip'
}

export function BranchList({ repoId, showActions = true, variant = 'list' }: Props) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const selectBranch = useReposStore((s) => s.selectBranch)
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const refreshSnapshot = useReposStore((s) => s.refreshSnapshot)
  const selectedRef = useRef<HTMLLIElement | null>(null)
  const handleSelectBranch = useCallback(
    (branch: string) => {
      selectBranch(repoId, branch)
    },
    [repoId, selectBranch],
  )
  const handleOpenBranchStatus = useCallback(
    (branch: string) => {
      handleSelectBranch(branch)
      setDetailTab(repoId, 'status')
      setDetailCollapsed(false)
    },
    [repoId, handleSelectBranch, setDetailCollapsed, setDetailTab],
  )
  const { repo, branches, selected, current } = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return {
        repo,
        branches: repo ? visibleBranches(repo) : [],
        branchCount: repo?.data.branches.length ?? 0,
        selected: repo?.ui.selectedBranch ?? null,
        current: repo?.data.currentBranch ?? '',
      }
    },
    (a, b) =>
      a.repo === b.repo ||
      (!!a.repo &&
        !!b.repo &&
        a.repo.id === b.repo.id &&
        a.repo.instanceToken === b.repo.instanceToken &&
        a.repo.data.branches === b.repo.data.branches &&
        a.repo.ui.branchViewMode === b.repo.ui.branchViewMode &&
        a.repo.data.status === b.repo.data.status &&
        a.repo.resources.snapshot === b.repo.resources.snapshot &&
        a.repo.resources.branchAction === b.repo.resources.branchAction &&
        a.branchCount === b.branchCount &&
        a.selected === b.selected &&
        a.current === b.current),
  )

  // Keep the selected row in view as the user navigates with j/k.
  useEffect(() => {
    const selectedEl = selectedRef.current
    if (selectedEl && variant === 'list') selectedEl.scrollIntoView({ block: 'nearest' })
  }, [selected, variant])

  if (!repo) return null

  const selectedBranch = selected
    ? (branches.find((branch) => branch.name === selected) ??
      repo.data.branches.find((branch) => branch.name === selected))
    : null
  const renderedBranches = variant === 'selected-strip' ? (selectedBranch ? [selectedBranch] : []) : branches

  if (renderedBranches.length === 0) {
    if (repo.kind === 'remote' && repo.data.branches.length === 0 && repo.resources.snapshot.error) {
      return (
        <EmptyState
          title={t(repo.resources.snapshot.error)}
          action={
            <RetryButton
              busy={resourceBusy(repo.resources.snapshot)}
              onRetry={() => void refreshSnapshot(repo.id, { token: repo.instanceToken })}
            />
          }
        />
      )
    }
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />
  }

  const list = (
    <>
      {repo.kind === 'remote' && repo.resources.snapshot.stale && repo.resources.snapshot.error && (
        <RemoteSnapshotStaleNotice repo={repo} />
      )}
      <ul className="divide-y divide-separator">
        {renderedBranches.map((branch) => {
          return (
            <BranchRow
              key={branch.name}
              repo={repo}
              branch={branch}
              selected={selected}
              current={current}
              lang={lang}
              onSelectBranch={handleSelectBranch}
              onOpenBranchStatus={handleOpenBranchStatus}
              selectedRef={selectedRef}
              showActions={showActions && branchActionsAvailable(repo, branch)}
            />
          )
        })}
      </ul>
    </>
  )

  if (variant === 'selected-strip')
    return (
      <div className="shrink-0 overflow-hidden" role="region" aria-label={t('branches.selected')} aria-live="polite">
        {list}
      </div>
    )

  return <ScrollArea className="min-h-0 flex-1">{list}</ScrollArea>
}

function RemoteSnapshotStaleNotice({ repo }: { repo: RepoState }) {
  const t = useT()
  const refreshSnapshot = useReposStore((s) => s.refreshSnapshot)
  const busy = resourceBusy(repo.resources.snapshot)
  return (
    <div className="flex items-center justify-between gap-3 border-b border-warning-border bg-warning-surface px-4 py-2 text-xs text-warning">
      <span>
        <span className="font-medium">{t('remote.stale-title')}</span>
        <span className="text-muted-foreground"> - {t(repo.resources.snapshot.error ?? 'error.failed-read-repo')}</span>
      </span>
      <RetryButton busy={busy} onRetry={() => void refreshSnapshot(repo.id, { token: repo.instanceToken })} />
    </div>
  )
}

function RetryButton({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  const t = useT()
  return (
    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRetry}>
      <RefreshCw className={busy ? 'animate-spin' : undefined} />
      {t('action.retry-refresh')}
    </Button>
  )
}
