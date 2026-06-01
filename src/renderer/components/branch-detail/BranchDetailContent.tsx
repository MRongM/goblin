import { ArrowLeft, FolderTree, RefreshCw } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useT } from '#/renderer/stores/i18n.ts'
import type { DetailTab, RepoState, RepoWorkspaceLayout } from '#/renderer/stores/repos/types.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { EmptyState, ScrollPane } from '#/renderer/components/Layout.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { CommitDetail } from '#/renderer/components/CommitDetail.tsx'
import { LogList } from '#/renderer/components/LogList.tsx'
import { StatusList } from '#/renderer/components/StatusList.tsx'
import { ListSkeleton } from '#/renderer/components/Skeleton.tsx'
import { BranchStatus } from '#/renderer/components/branch-detail/BranchStatus.tsx'
import { TerminalSlot } from '#/renderer/components/terminal/TerminalSlot.tsx'
import type { SelectedBranchDetailPresentation } from '#/renderer/components/branch-detail/model.ts'
import { isShortcutBlockingLayerOpen } from '#/renderer/lib/layers.ts'
import { detailTabForWorktree } from '#/renderer/lib/detail-tabs.ts'
import type { TerminalSessionBase } from '#/renderer/components/terminal/types.ts'

interface Props {
  repo: RepoState
  detail: SelectedBranchDetailPresentation
  detailId: string
  contentId: string
  layout: RepoWorkspaceLayout
}

interface TabPanelProps {
  detailId: string
  tabId: DetailTab
  busy?: boolean
  children: ReactNode
}

type BranchDetailBranch = NonNullable<SelectedBranchDetailPresentation['branch']>

export function BranchDetailContent({ repo, detail, detailId, contentId, layout }: Props) {
  const t = useT()
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const { branch } = detail
  const canOpenTerminal = !!branchTerminalBase(repo, branch)
  useEffect(() => {
    if (!branch) return
    const nextTab = detailTabForWorktree(repo.ui.detailTab, !!branchTerminalBase(repo, branch))
    if (nextTab !== repo.ui.detailTab) setDetailTab(repo.id, nextTab)
  }, [branch, repo.id, repo.kind, repo.remoteTarget, repo.ui.detailTab, setDetailTab])
  if (!branch)
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />

  return (
    <div id={contentId} className="flex min-h-0 flex-1 flex-col">
      {repo.ui.detailTab === 'status' && (
        <BranchStatusTab
          detailId={detailId}
          repo={repo}
          detail={detail}
          layout={layout}
          busy={detail.loading.pullRequests}
        />
      )}
      {repo.ui.detailTab === 'changes' && (
        <BranchChangesTab
          detailId={detailId}
          repo={repo}
          branch={branch}
          selectedStatus={detail.selectedStatus}
          statusLoading={detail.loading.status}
          statusError={detail.errors.status}
          statusStale={detail.stale.status}
        />
      )}
      {repo.ui.detailTab === 'commits' && (
        <BranchCommitsTab
          detailId={detailId}
          repo={repo}
          branch={branch}
          branchLog={detail.branchLog}
          commitDetail={repo.ui.commitDetail}
          busy={detail.loading.commits}
          initialLoading={detail.loading.logInitial}
          appendLoading={detail.loading.logAppend}
          logError={detail.errors.log}
          logStale={detail.stale.log}
        />
      )}
      {repo.ui.detailTab === 'terminal' && canOpenTerminal && (
        <BranchTerminalTab detailId={detailId} repo={repo} branch={branch} />
      )}
    </div>
  )
}

function BranchTabPanel({ detailId, tabId, busy = false, children }: TabPanelProps) {
  return (
    <div
      id={`${detailId}-${tabId}-panel`}
      role="tabpanel"
      aria-busy={busy || undefined}
      aria-labelledby={`${detailId}-${tabId}-tab`}
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}
    </div>
  )
}

function BranchStatusTab({
  detailId,
  repo,
  detail,
  layout,
  busy,
}: {
  detailId: string
  repo: RepoState
  detail: SelectedBranchDetailPresentation
  layout: RepoWorkspaceLayout
  busy?: boolean
}) {
  return (
    <BranchTabPanel detailId={detailId} tabId="status" busy={busy}>
      <ScrollPane>
        <BranchStatus repo={repo} detail={detail} layout={layout} />
      </ScrollPane>
    </BranchTabPanel>
  )
}

function BranchChangesTab({
  detailId,
  repo,
  branch,
  selectedStatus,
  statusLoading,
  statusError,
  statusStale,
}: {
  detailId: string
  repo: RepoState
  branch: BranchDetailBranch
  selectedStatus: SelectedBranchDetailPresentation['selectedStatus']
  statusLoading: boolean
  statusError: string | null
  statusStale: boolean
}) {
  const t = useT()
  const refreshStatus = useReposStore((s) => s.refreshStatus)
  // Keep this tab-level count separate from StatusList's empty-state check: the tab decides the scroll boundary.
  const totalEntries = selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)
  const retry =
    repo.kind === 'remote'
      ? () => void refreshStatus(repo.id, { token: repo.instanceToken })
      : undefined

  return (
    <BranchTabPanel detailId={detailId} tabId="changes" busy={statusLoading}>
      {branch.worktree?.path && statusLoading && !repo.data.statusLoaded ? (
        <ListSkeleton rows={8} variant="status" />
      ) : branch.worktree?.path && !repo.data.statusLoaded && statusError ? (
        <EmptyState title={t(statusError)} action={retry && <RetryButton busy={statusLoading} onRetry={retry} />} />
      ) : branch.worktree?.path ? (
        totalEntries > 0 ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {statusStale && statusError && (
              <StaleNotice
                message={statusError}
                titleKey={repo.kind === 'remote' ? 'remote.stale-title' : 'status.stale-title'}
                busy={statusLoading}
                onRetry={retry}
              />
            )}
            <ScrollPane>
              <StatusList status={selectedStatus} emptyTitleKey="status.clean-title" emptyBodyKey="status.clean-body" />
            </ScrollPane>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {statusStale && statusError && (
              <StaleNotice
                message={statusError}
                titleKey={repo.kind === 'remote' ? 'remote.stale-title' : 'status.stale-title'}
                busy={statusLoading}
                onRetry={retry}
              />
            )}
            <StatusList status={selectedStatus} emptyTitleKey="status.clean-title" emptyBodyKey="status.clean-body" />
          </div>
        )
      ) : (
        <EmptyState
          icon={<FolderTree size={16} />}
          title={t('status.no-worktree-title')}
          body={t('status.no-worktree-body')}
        />
      )}
    </BranchTabPanel>
  )
}

function StaleNotice({
  message,
  titleKey,
  busy = false,
  onRetry,
}: {
  message: string
  titleKey: string
  busy?: boolean
  onRetry?: () => void
}) {
  const t = useT()
  return (
    <div className="flex items-center justify-between gap-3 border-b border-warning-border bg-warning-surface px-4 py-2 text-xs text-warning">
      <span>
        <span className="font-medium">{t(titleKey)}</span>
        <span className="text-muted-foreground"> - {t(message)}</span>
      </span>
      {onRetry && <RetryButton busy={busy} onRetry={onRetry} />}
    </div>
  )
}

function BranchCommitsTab({
  detailId,
  repo,
  branch,
  branchLog,
  commitDetail,
  busy,
  initialLoading,
  appendLoading,
  logError,
  logStale,
}: {
  detailId: string
  repo: RepoState
  branch: BranchDetailBranch
  branchLog: SelectedBranchDetailPresentation['branchLog']
  commitDetail: RepoState['ui']['commitDetail']
  busy: boolean
  initialLoading: boolean
  appendLoading: boolean
  logError: string | null
  logStale: boolean
}) {
  const t = useT()
  const refreshBranchLog = useReposStore((s) => s.refreshBranchLog)
  const retry =
    repo.kind === 'remote'
      ? () => void refreshBranchLog(repo.id, branch.name, { token: repo.instanceToken })
      : undefined

  return (
    <BranchTabPanel detailId={detailId} tabId="commits" busy={busy}>
      {commitDetail.phase === 'open' ? (
        <CommitDetail repoId={repo.id} detail={commitDetail.detail} />
      ) : commitDetail.phase === 'opening' ? (
        <OpeningCommitDetail repoId={repo.id} />
      ) : initialLoading ? (
        <ListSkeleton variant="log" />
      ) : !branchLog?.entries.length && logError ? (
        <EmptyState title={t(logError)} action={retry && <RetryButton busy={busy} onRetry={retry} />} />
      ) : branchLog?.entries.length ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {logStale && logError && (
            <StaleNotice
              message={logError}
              titleKey={repo.kind === 'remote' ? 'remote.stale-title' : 'log.stale-title'}
              busy={busy}
              onRetry={retry}
            />
          )}
          <ScrollPane>
            <LogList
              repoId={repo.id}
              log={branchLog.entries}
              branch={branch.name}
              selectedHash={branchLog.selectedHash ?? null}
              hasMore={branchLog.hasMore}
              loading={appendLoading}
            />
          </ScrollPane>
        </div>
      ) : (
        <LogList repoId={repo.id} log={[]} branch={branch.name} selectedHash={null} />
      )}
    </BranchTabPanel>
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

function BranchTerminalTab({
  detailId,
  repo,
  branch,
}: {
  detailId: string
  repo: RepoState
  branch: BranchDetailBranch
}) {
  const base = branchTerminalBase(repo, branch)
  if (!base) return null
  return (
    <BranchTabPanel detailId={detailId} tabId="terminal">
      <TerminalSlot base={base} />
    </BranchTabPanel>
  )
}

function branchTerminalBase(repo: RepoState, branch: BranchDetailBranch | null | undefined): TerminalSessionBase | null {
  if (!branch?.worktree?.path) return null
  if (repo.kind === 'remote') {
    if (!repo.remoteTarget) return null
    return {
      kind: 'remote',
      repoId: repo.id,
      target: repo.remoteTarget,
      branch: branch.name,
      worktreePath: branch.worktree.path,
    }
  }
  return { kind: 'local', repoRoot: repo.id, branch: branch.name, worktreePath: branch.worktree.path }
}

function OpeningCommitDetail({ repoId }: { repoId: string }) {
  const t = useT()
  const closeCommit = useReposStore((s) => s.closeCommit)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isShortcutBlockingLayerOpen()) return
      closeCommit(repoId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repoId, closeCommit])

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
      <div className="flex items-start gap-3 border-b border-separator bg-muted px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => closeCommit(repoId)}
          className="mt-0.5 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          aria-label={t('error.back')}
          title={t('error.back')}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1 space-y-2 py-0.5">
          <span className="block h-3 w-24 animate-pulse rounded bg-accent" />
          <span className="block h-3 w-2/3 animate-pulse rounded bg-accent" />
        </div>
      </div>
      <ListSkeleton rows={8} variant="log" />
    </div>
  )
}
