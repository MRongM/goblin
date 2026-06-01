import { type CSSProperties, type HTMLAttributes, type RefObject } from 'react'
import { ArrowDown, ArrowUp, Check, FolderTree, GitBranch } from 'lucide-react'
import { useT, type Lang } from '#/renderer/stores/i18n.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { BranchActionsMenu } from '#/renderer/components/BranchActionsMenu.tsx'
import { cn } from '#/renderer/lib/cn.ts'
import { formatRelativeTime } from '#/renderer/lib/dates.ts'
import { lastPathSegment } from '#/renderer/lib/paths.ts'
import type { BranchInfo } from '#/renderer/types.ts'

interface BranchRowProps {
  repo: RepoState
  branch: BranchInfo
  selected: string | null
  current: string
  lang: Lang
  onSelectBranch: (branch: string) => void
  onOpenBranchStatus: (branch: string) => void
  selectedRef: RefObject<HTMLLIElement | null>
  showActions?: boolean
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
  lang,
  onSelectBranch,
  onOpenBranchStatus,
  selectedRef,
  showActions = true,
  drag,
}: BranchRowProps) {
  const t = useT()
  const isSelected = branch.name === selected
  const isCurrent = branch.name === current
  const hasWorktree = !!branch.worktreePath
  const isWorktree = hasWorktree && !isCurrent
  const worktreeName = branch.worktreePath ? lastPathSegment(branch.worktreePath) || branch.worktreePath : ''
  const commitTime = formatRelativeTime(branch.lastCommitDate, lang)
  const commitMeta = branch.lastCommitAuthor ? `${branch.lastCommitAuthor} · ${commitTime}` : commitTime
  const ariaParts = [
    branch.name,
    isCurrent ? t('branch-status.current') : null,
    branch.isDefault ? t('branches.default') : null,
    hasWorktree ? `${t('branches.worktree')}: ${worktreeName}` : null,
    branch.worktreeDirty ? t('branches.dirty') : null,
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
      <div className="pointer-events-none relative z-10 grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 px-4 py-2">
        <span className="flex size-4 shrink-0 items-center justify-center pt-0.5">
          {isCurrent ? (
            <Check size={14} className="text-success" />
          ) : isWorktree ? (
            <FolderTree size={14} className={branch.worktreeDirty ? 'text-attention' : 'text-brand-text'} />
          ) : (
            <GitBranch size={14} className="text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">{branch.name}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {branch.isDefault && (
                <Badge variant="outline" className="font-mono text-muted-foreground">
                  {t('branches.default')}
                </Badge>
              )}
              {hasWorktree ? (
                <Badge
                  variant={branch.worktreeDirty ? 'attention' : 'outline'}
                  className={cn(
                    'max-w-[10rem] gap-1 font-mono',
                    branch.worktreeDirty ? undefined : 'text-muted-foreground',
                  )}
                  title={branch.worktreePath}
                >
                  <FolderTree size={10} className="shrink-0" />
                  <span className="min-w-0 truncate">{worktreeName}</span>
                </Badge>
              ) : null}
              {branch.trackingGone && (
                <Badge variant="attention" className="font-mono">
                  {t('branches.gone')}
                </Badge>
              )}
              {branch.ahead > 0 && (
                <Delta
                  direction="ahead"
                  count={branch.ahead}
                  label={t('branch-status.sync.ahead', { n: branch.ahead })}
                />
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
          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate" title={branch.lastCommitMessage || undefined}>
              {branch.lastCommitMessage || '—'}
            </span>
            <span className="shrink-0 whitespace-nowrap" title={commitMeta}>
              {commitMeta}
            </span>
          </span>
        </span>
      </div>
      {showActions && (
        <div className="pointer-events-none relative z-20 flex shrink-0 items-center py-2 pr-4">
          <div className="pointer-events-auto">
            <BranchActionsMenu repo={repo} branch={branch} />
          </div>
        </div>
      )}
    </li>
  )
}
