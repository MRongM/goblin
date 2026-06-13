import { useStoreWithEqualityFn } from 'zustand/traditional'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { BranchStatus } from '#/web/components/branch-detail/BranchStatus.tsx'
import type { BranchDetailRepo } from '#/web/components/branch-detail/model.ts'
import { getSelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'

interface ProjectStatusPanelProps {
  repoId: string
  layout: RepoWorkspaceLayout
}

function projectStatusRepoEqual(a: BranchDetailRepo | undefined, b: BranchDetailRepo | undefined): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.instanceToken === b.instanceToken &&
      a.data.branches === b.data.branches &&
      a.data.currentBranch === b.data.currentBranch &&
      a.data.status === b.data.status &&
      a.data.statusLoaded === b.data.statusLoaded &&
      a.data.worktreesByPath === b.data.worktreesByPath &&
      a.ui.selectedBranch === b.ui.selectedBranch &&
      a.ui.detailTab === b.ui.detailTab &&
      a.resources.status === b.resources.status &&
      a.resources.pullRequests === b.resources.pullRequests &&
      a.operations.branchAction === b.operations.branchAction &&
      a.operations.fetch === b.operations.fetch &&
      a.operations.manualRefresh === b.operations.manualRefresh &&
      a.remote.target === b.remote.target &&
      a.remote.hasRemotes === b.remote.hasRemotes &&
      a.remote.hasBrowserRemote === b.remote.hasBrowserRemote &&
      a.remote.hasGitHubRemote === b.remote.hasGitHubRemote &&
      a.remote.browserRemoteProvider === b.remote.browserRemoteProvider &&
      a.remote.remoteProviders === b.remote.remoteProviders)
  )
}

export function ProjectStatusPanel({ repoId, layout }: ProjectStatusPanelProps) {
  const t = useT()
  const repo = useStoreWithEqualityFn(
    useReposStore,
    (state) => {
      const repo = state.repos[repoId]
      return repo
        ? {
            id: repo.id,
            instanceToken: repo.instanceToken,
            data: {
              branches: repo.data.branches,
              currentBranch: repo.data.currentBranch,
              status: repo.data.status,
              statusLoaded: repo.data.statusLoaded,
              worktreesByPath: repo.data.worktreesByPath,
            },
            ui: {
              selectedBranch: repo.ui.selectedBranch,
              detailTab: repo.ui.detailTab,
            },
            resources: {
              status: repo.resources.status,
              pullRequests: repo.resources.pullRequests,
            },
            operations: {
              branchAction: repo.operations.branchAction,
              fetch: repo.operations.fetch,
              manualRefresh: repo.operations.manualRefresh,
            },
            remote: {
              target: repo.remote.target,
              hasRemotes: repo.remote.hasRemotes,
              hasBrowserRemote: repo.remote.hasBrowserRemote,
              hasGitHubRemote: repo.remote.hasGitHubRemote,
              browserRemoteProvider: repo.remote.browserRemoteProvider,
              remoteProviders: repo.remote.remoteProviders,
            },
          }
        : undefined
    },
    projectStatusRepoEqual,
  )

  if (!repo) return null

  const detail = getSelectedBranchDetailPresentation(repo)
  if (!detail.branch) {
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />
  }

  return (
    <ScrollPane>
      <BranchStatus detail={detail} layout={layout} />
    </ScrollPane>
  )
}
