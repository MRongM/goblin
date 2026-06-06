// Persistent branch list. Each row shows branch name, worktree state, and
// lightweight sync metadata. The list supports manual ordering in the active
// branch filter while keeping row action menus controlled by the parent list.

import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type RefObject,
} from 'react'
import { RefreshCw } from 'lucide-react'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useI18nStore, useT, type Lang } from '#/renderer/stores/i18n.ts'
import { visibleBranches } from '#/renderer/stores/repos/branch-view-mode.ts'
import { BranchRow } from '#/renderer/components/branch-list/BranchRow.tsx'
import { EmptyState } from '#/renderer/components/Layout.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { ScrollArea } from '#/renderer/components/ui/scroll-area.tsx'
import { branchActionsAvailable } from '#/renderer/hooks/branch-action-state.ts'
import { resourceBusy } from '#/renderer/stores/repos/resources.ts'
import type { RepoBranchState, RepoState } from '#/renderer/stores/repos/types.ts'
import { getWorktreeSource, type WorktreeSourceMap } from '#/renderer/stores/repos/worktree-sources.ts'
import { TerminalSessionContext } from '#/renderer/components/terminal/terminal-session-context.ts'
import { terminalSessionGroupKey } from '#/renderer/components/terminal/terminal-session-utils.ts'

interface Props {
  repoId: string
  showActions?: boolean
  variant?: 'list' | 'selected-strip'
}

type OpenActionMenu = { repoId: string; branch: string }

export function BranchList({ repoId, showActions = true, variant = 'list' }: Props) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const selectBranch = useReposStore((s) => s.selectBranch)
  const reorderBranches = useReposStore((s) => s.reorderBranches)
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const refreshSnapshot = useReposStore((s) => s.refreshSnapshot)
  const selectedRef = useRef<HTMLLIElement | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [openActionMenu, setOpenActionMenu] = useState<OpenActionMenu | null>(null)
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
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      reorderBranches(repoId, String(active.id), String(over.id))
    },
    [repoId, reorderBranches],
  )
  const { repo, branches, selected, current, sourceMap } = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      const branchSearchQuery = s.branchSearchQueries[repoId] ?? ''
      return {
        repo,
        branches: repo
          ? visibleBranches({
            branches: repo.data.branches,
            viewMode: repo.ui.branchViewMode,
            branchOrder: repo.ui.branchOrder,
            searchQuery: branchSearchQuery,
          })
          : [],
        branchCount: repo?.data.branches.length ?? 0,
        branchSearchQuery,
        selected: repo?.ui.selectedBranch ?? null,
        current: repo?.data.currentBranch ?? '',
        sourceMap: s.worktreeSourcesByRepo[repoId],
      }
    },
    (a, b) =>
      a.repo === b.repo
        ? a.branchSearchQuery === b.branchSearchQuery && a.sourceMap === b.sourceMap
        : !!a.repo &&
          !!b.repo &&
          a.repo.id === b.repo.id &&
          a.repo.instanceToken === b.repo.instanceToken &&
          a.repo.data.branches === b.repo.data.branches &&
          a.repo.ui.branchViewMode === b.repo.ui.branchViewMode &&
          a.repo.ui.branchOrder === b.repo.ui.branchOrder &&
          a.branchSearchQuery === b.branchSearchQuery &&
          a.repo.data.worktreesByPath === b.repo.data.worktreesByPath &&
          a.repo.operations.branchAction === b.repo.operations.branchAction &&
          a.repo.resources.snapshot === b.repo.resources.snapshot &&
          a.sourceMap === b.sourceMap &&
          a.branchCount === b.branchCount &&
          a.selected === b.selected &&
          a.current === b.current,
  )

  useEffect(() => {
    const selectedEl = selectedRef.current
    if (selectedEl && variant === 'list') selectedEl.scrollIntoView({ block: 'nearest' })
  }, [selected, variant])

  const selectedBranch =
    repo && selected
      ? (branches.find((branch) => branch.name === selected) ??
        repo.data.branches.find((branch) => branch.name === selected))
      : null
  const renderedBranches = repo
    ? variant === 'selected-strip'
      ? selectedBranch
        ? [selectedBranch]
        : []
      : branches
    : []

  useEffect(() => {
    if (!openActionMenu) return
    if (
      openActionMenu.repoId !== repoId ||
      !showActions ||
      !renderedBranches.some((branch) => branch.name === openActionMenu.branch)
    ) {
      setOpenActionMenu(null)
    }
  }, [openActionMenu, renderedBranches, repoId, showActions])

  if (!repo) return null

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

  const renderedBranchIds = renderedBranches.map((branch) => branch.name)
  const sortable = variant === 'list' && renderedBranches.length > 1
  const list = (
    <>
      {repo.kind === 'remote' && repo.resources.snapshot.stale && repo.resources.snapshot.error && (
        <RemoteSnapshotStaleNotice repo={repo} />
      )}
      {sortable ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={renderedBranchIds} strategy={verticalListSortingStrategy}>
            <BranchRows
              repo={repo}
              branches={renderedBranches}
              selected={selected}
              current={current}
              sourceMap={sourceMap}
              lang={lang}
              selectedRef={selectedRef}
              showActions={showActions}
              openActionMenu={openActionMenu}
              setOpenActionMenu={setOpenActionMenu}
              onSelectBranch={handleSelectBranch}
              onOpenBranchStatus={handleOpenBranchStatus}
              sortable
            />
          </SortableContext>
        </DndContext>
      ) : (
        <BranchRows
          repo={repo}
          branches={renderedBranches}
          selected={selected}
          current={current}
          sourceMap={sourceMap}
          lang={lang}
          selectedRef={selectedRef}
          showActions={showActions}
          openActionMenu={openActionMenu}
          setOpenActionMenu={setOpenActionMenu}
          onSelectBranch={handleSelectBranch}
          onOpenBranchStatus={handleOpenBranchStatus}
        />
      )}
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

function BranchRows({
  repo,
  branches,
  selected,
  current,
  sourceMap,
  lang,
  selectedRef,
  showActions,
  openActionMenu,
  setOpenActionMenu,
  onSelectBranch,
  onOpenBranchStatus,
  sortable = false,
}: {
  repo: RepoState
  branches: RepoBranchState[]
  selected: string | null
  current: string
  sourceMap?: WorktreeSourceMap
  lang: Lang
  selectedRef: RefObject<HTMLLIElement | null>
  showActions: boolean
  openActionMenu: OpenActionMenu | null
  setOpenActionMenu: (value: OpenActionMenu | null | ((current: OpenActionMenu | null) => OpenActionMenu | null)) => void
  onSelectBranch: (branch: string) => void
  onOpenBranchStatus: (branch: string) => void
  sortable?: boolean
}) {
  const terminalContext = useContext(TerminalSessionContext)
  const worktreeAiCliBusy = useCallback(
    (branch: RepoBranchState): boolean => {
      const worktreePath = branch.worktree?.path
      if (!worktreePath || !terminalContext) return false
      const groupKey = terminalSessionGroupKey(
        repo.kind === 'remote'
          ? { kind: 'remote', repoId: repo.id, worktreePath }
          : { kind: 'local', repoRoot: repo.id, worktreePath },
      )
      return terminalContext.aiCliBusyByGroup(groupKey)
    },
    [repo.id, repo.kind, terminalContext],
  )

  return (
    <ul className="divide-y divide-separator">
      {branches.map((branch) => {
        const row = (
          <BranchRow
            key={branch.name}
            repo={repo}
            branch={branch}
            selected={selected}
            current={current}
            source={getWorktreeSource(sourceMap, branch.name, branch.worktree?.path)}
            lang={lang}
            selectedRef={selectedRef}
            showActions={showActions && branchActionsAvailable(repo, branch)}
            worktreeAiCliBusy={worktreeAiCliBusy(branch)}
            onSelectBranch={onSelectBranch}
            onOpenBranchStatus={onOpenBranchStatus}
            actionMenuOpen={openActionMenu?.repoId === repo.id && openActionMenu.branch === branch.name}
            onActionMenuOpenChange={(open) =>
              setOpenActionMenu((current) =>
                open
                  ? { repoId: repo.id, branch: branch.name }
                  : current?.repoId === repo.id && current.branch === branch.name
                    ? null
                    : current,
              )
            }
          />
        )
        return sortable ? <SortableBranchRow key={branch.name} row={row} branchName={branch.name} /> : row
      })}
    </ul>
  )
}

function SortableBranchRow({
  row,
  branchName,
}: {
  row: ReactElement<ComponentProps<typeof BranchRow>>
  branchName: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: branchName })
  const stableTransform = transform ? { ...transform, scaleX: 1, scaleY: 1 } : null
  return (
    <BranchRow
      {...row.props}
      drag={{
        attributes,
        listeners,
        setNodeRef,
        style: {
          transform: CSS.Transform.toString(stableTransform),
          transition,
        },
        isDragging,
      }}
    />
  )
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
