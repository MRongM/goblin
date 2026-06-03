import { type CSSProperties, type HTMLAttributes, type RefObject } from 'react'
import { ArrowDown, ArrowUp, Check, FolderTree, GitBranch } from 'lucide-react'
import { useT, type Lang } from '#/renderer/stores/i18n.ts'
import type { RepoBranchState, RepoState } from '#/renderer/stores/repos/types.ts'
import { getBranchWorktreeState } from '#/renderer/stores/repos/worktree-state.ts'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { BranchActionsMenu } from '#/renderer/components/BranchActionsMenu.tsx'
import { cn } from '#/renderer/lib/cn.ts'
import { formatRelativeTime } from '#/renderer/lib/dates.ts'
import type { WorktreeSourceInfo } from '#/shared/worktree-source.ts'

interface BranchRowProps {
  repo: RepoState
  branch: RepoBranchState
  selected: string | null
  current: string
  source?: WorktreeSourceInfo
  lang: Lang
  onSelectBranch: (branch: string) => void
  onOpenBranchStatus: (branch: string) => void
  selectedRef: RefObject<HTMLLIElement | null>
  showActions?: boolean
  actionMenuOpen?: boolean
  onActionMenuOpenChange?: (open: boolean) => void
  drag?: {
    attributes?: HTMLAttributes<HTMLElement>
    listeners?: Record<string, unknown>
    setNodeRef: (node: HTMLLIElement | null) => void
    style?: CSSProperties
    isDragging?: boolean
  }
}

function Delta({ direction, count, label }: { direction: 'ahead' | 'behind'; count: number; label: string }) {
  const Icon = direction === 'ahead' ? ArrowUp : ArrowDown
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center gap-0.5 font-mono text-xs',
        direction === 'ahead' ? 'text-success' : 'text-attention',
      )}
    >
      <Icon size={11} />
      {count}
    </span>
  )
}

export function BranchRow({
  repo,
  branch,
  selected,
  current,
  source,
  lang,
  onSelectBranch,
  onOpenBranchStatus,
  selectedRef,
  showActions = true,
  actionMenuOpen,
  onActionMenuOpenChange,
  drag,
}: BranchRowProps) {
  const t = useT()
  const isSelected = branch.name === selected
  const isCurrent = branch.name === current
  const worktreePath = branch.worktree?.path ?? ''
  const hasWorktree = !!worktreePath
  const isWorktree = hasWorktree && !isCurrent
  const worktreeState = getBranchWorktreeState(repo, branch)
  const worktreeDirty = worktreeState?.dirty ?? false
  const worktreeSource = source && isWorktree ? source : null
  const sourceLabel =
    worktreeSource
      ? t(worktreeSource.confidence === 'exact' ? 'branches.source-exact' : 'branches.source-inferred', {
          branch: worktreeSource.sourceBranch,
        })
      : null
  const commitTime = formatRelativeTime(branch.lastCommitDate, lang)
  const commitMeta = branch.lastCommitAuthor ? `${branch.lastCommitAuthor} · ${commitTime}` : commitTime
  const ariaParts = [
    branch.name,
    isCurrent ? t('branch-status.current') : null,
    branch.isDefault ? t('branches.default') : null,
    hasWorktree ? t(worktreeDirty ? 'branches.dirty' : 'branches.worktree') : null,
    worktreePath || null,
    sourceLabel,
    branch.trackingGone ? t('branches.gone') : null,
    branch.ahead > 0 ? t('branch-status.sync.ahead', { n: branch.ahead }) : null,
    branch.behind > 0 ? t('branch-status.sync.behind', { n: branch.behind }) : null,
    branch.lastCommitMessage || null,
    commitMeta,
  ].filter(Boolean)
  const setRowRef = (node: HTMLLIElement | null) => {
    drag?.setNodeRef(node)
    if (isSelected) {
      ;(selectedRef as { current: HTMLLIElement | null }).current = node
    }
  }

  return (
    <li
      ref={drag ? setRowRef : isSelected ? selectedRef : undefined}
      style={drag?.style}
      {...drag?.attributes}
      {...drag?.listeners}
      title={ariaParts.join(', ')}
      onClick={() => onSelectBranch(branch.name)}
      onDoubleClick={() => onOpenBranchStatus(branch.name)}
      className={cn(
        'relative grid touch-none select-none items-stretch cursor-pointer',
        showActions ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1',
        'transition-colors duration-100',
        isSelected ? 'bg-selected text-selected-foreground hover:bg-selected' : 'hover:bg-muted',
        drag?.isDragging && 'z-10 bg-card shadow-sm',
      )}
    >
      <div className="pointer-events-none relative z-10 grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 px-4 py-2">
        <span className="flex w-4 shrink-0 items-center justify-center">
          {isCurrent ? (
            <Check size={14} className="text-success" />
          ) : isWorktree ? (
            <FolderTree size={14} className={worktreeDirty ? 'text-attention' : 'text-brand-text'} />
          ) : (
            <GitBranch size={14} className={isSelected ? 'text-selected-muted-foreground' : 'text-muted-foreground'} />
          )}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'min-w-0 truncate text-sm font-medium',
              isSelected ? 'text-selected-foreground' : 'text-foreground',
            )}
          >
            {branch.name}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {branch.isDefault && (
              <Badge variant="outline" className="text-muted-foreground">
                {t('branches.default')}
              </Badge>
            )}
            {hasWorktree && worktreeDirty ? (
              <Badge variant="attention" className="gap-1">
                <FolderTree size={10} />
                {t('branches.dirty')}
              </Badge>
            ) : isWorktree ? (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <FolderTree size={10} />
                {t('branches.worktree')}
              </Badge>
            ) : null}
            {worktreeSource && sourceLabel && (
              <Badge
                variant={worktreeSource.confidence === 'exact' ? 'secondary' : 'outline'}
                className={cn(
                  'max-w-40 truncate',
                  worktreeSource.confidence === 'inferred' && 'border-warning-border text-warning',
                )}
                title={sourceLabel}
              >
                {sourceLabel}
              </Badge>
            )}
            {branch.trackingGone && <Badge variant="attention">{t('branches.gone')}</Badge>}
            {branch.ahead > 0 && (
              <Delta direction="ahead" count={branch.ahead} label={t('branch-status.sync.ahead', { n: branch.ahead })} />
            )}
            {branch.behind > 0 && (
              <Delta
                direction="behind"
                count={branch.behind}
                label={t('branch-status.sync.behind', { n: branch.behind })}
              />
            )}
          </span>
        </span>
        {worktreePath && (
          <span
            className={cn(
              'col-start-2 min-w-0 truncate font-mono text-xs',
              isSelected ? 'text-selected-muted-foreground' : 'text-muted-foreground',
            )}
            title={worktreePath}
          >
            {worktreePath}
          </span>
        )}
        <span
          className={cn(
            'col-start-2 flex min-w-0 items-center gap-2 text-xs',
            isSelected ? 'text-selected-muted-foreground' : 'text-muted-foreground',
          )}
        >
          <span className="min-w-0 truncate" title={branch.lastCommitMessage || undefined}>
            {branch.lastCommitMessage || '—'}
          </span>
          <span className="shrink-0 whitespace-nowrap" title={commitMeta}>
            {commitMeta}
          </span>
        </span>
      </div>
      {showActions && (
        <div className="pointer-events-none relative z-20 flex shrink-0 items-center py-2 pr-4">
          <div className="pointer-events-auto">
            <BranchActionsMenu
              repo={repo}
              branch={branch}
              open={actionMenuOpen}
              onOpenChange={onActionMenuOpenChange}
            />
          </div>
        </div>
      )}
    </li>
  )
}
