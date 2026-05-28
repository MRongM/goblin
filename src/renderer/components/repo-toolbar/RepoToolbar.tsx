import { useStoreWithEqualityFn } from 'zustand/traditional'
import { BranchViewModeControl } from '#/renderer/components/repo-toolbar/BranchViewModeControl.tsx'
import { RepoToolbarActions } from '#/renderer/components/repo-toolbar/RepoToolbarActions.tsx'
import { WorkspaceLayoutControl } from '#/renderer/components/repo-toolbar/WorkspaceLayoutControl.tsx'
import { Toolbar } from '#/renderer/components/Layout.tsx'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { tildify } from '#/renderer/lib/paths.ts'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { remoteTargetSubtitle } from '#/shared/remote-repo.ts'

interface Props {
  repoId: string
}

// Keep this equality in sync with fields read by RepoToolbar children.
function repoToolbarEqual(a: RepoState | undefined, b: RepoState | undefined): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.name === b.name &&
      a.kind === b.kind &&
      a.remoteTarget === b.remoteTarget &&
      a.diagnostics?.category === b.diagnostics?.category &&
      a.diagnostics?.ok === b.diagnostics?.ok &&
      a.instanceToken === b.instanceToken &&
      a.data.branches === b.data.branches &&
      a.data.currentBranch === b.data.currentBranch &&
      a.ui.selectedBranch === b.ui.selectedBranch &&
      a.ui.branchViewMode === b.ui.branchViewMode &&
      a.data.logsByBranch === b.data.logsByBranch &&
      a.resources.snapshot === b.resources.snapshot &&
      a.resources.status === b.resources.status &&
      a.resources.fetch === b.resources.fetch &&
      a.resources.diagnostics === b.resources.diagnostics &&
      a.resources.logsByBranch === b.resources.logsByBranch &&
      a.resources.pullRequests === b.resources.pullRequests &&
      a.resources.branchAction === b.resources.branchAction &&
      a.cache.source === b.cache.source &&
      a.cache.savedAt === b.cache.savedAt &&
      a.remote.fetchFailed === b.remote.fetchFailed &&
      a.remote.fetchError === b.remote.fetchError)
  )
}

export function RepoToolbar({ repoId }: Props) {
  const { repo, workspaceLayout } = useStoreWithEqualityFn(
    useReposStore,
    (s) => ({ repo: s.repos[repoId], workspaceLayout: s.workspaceLayout }),
    (a, b) => repoToolbarEqual(a.repo, b.repo) && a.workspaceLayout === b.workspaceLayout,
  )
  const setBranchViewMode = useReposStore((s) => s.setBranchViewMode)
  const setWorkspaceLayout = useReposStore((s) => s.setWorkspaceLayout)
  if (!repo) return null
  const subtitle = repo.remoteTarget ? remoteTargetSubtitle(repo.remoteTarget) : tildify(repo.id)
  const diagnosticCategory = repo.kind === 'remote' && repo.diagnostics?.ok === false ? repo.diagnostics.category : null

  return (
    <Toolbar variant="repo" className="gap-3">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <div className="min-w-0 max-w-48 shrink truncate text-sm font-semibold text-foreground" title={repo.name}>
          {repo.name}
        </div>
        <div className="min-w-0 truncate text-xs text-muted-foreground" title={subtitle}>
          {subtitle}
        </div>
        {diagnosticCategory && (
          <Badge variant="warning" size="xs" title={repo.diagnostics?.message ?? diagnosticCategory}>
            {diagnosticCategory}
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <RepoToolbarActions repo={repo} />
        <BranchViewModeControl
          value={repo.ui.branchViewMode}
          disabled={repo.kind === 'remote' || repo.data.branches.length === 0}
          onChange={(viewMode) => setBranchViewMode(repo.id, viewMode)}
        />
        <WorkspaceLayoutControl value={workspaceLayout} onChange={setWorkspaceLayout} />
      </div>
    </Toolbar>
  )
}
