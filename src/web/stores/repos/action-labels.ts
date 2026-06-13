import type { RepoBranchActionKind } from '#/web/stores/repos/branch-action-types.ts'
import type { RepoEventAction } from '#/web/stores/repos/types.ts'
export interface RepoActionLabel {
  labelKey: string
  labelParams?: Record<string, string | number>
}

const BRANCH_ACTION_LOADING_LABEL_KEYS: Record<RepoBranchActionKind, string> = {
  checkout: 'action.checkout-loading',
  pull: 'action.pull-loading',
  push: 'action.push-loading',
  createBranch: 'action.create-branch-creating-title',
  trackRemoteBranch: 'action.track-remote-branch-creating-title',
  createWorktree: 'action.create-worktree-creating-title',
  deleteBranch: 'action.delete-branch-deleting-title',
  removeWorktree: 'action.remove-worktree-removing-title',
}

const BRANCH_ACTION_QUEUED_LABEL_KEYS: Record<RepoBranchActionKind, string> = {
  checkout: 'action.checkout-queued',
  pull: 'action.pull-queued',
  push: 'action.push-queued',
  createBranch: 'action.create-branch-queued-title',
  trackRemoteBranch: 'action.track-remote-branch-queued-title',
  createWorktree: 'action.create-worktree-queued-title',
  deleteBranch: 'action.delete-branch-queued-title',
  removeWorktree: 'action.remove-worktree-queued-title',
}

export function repoBranchActionLoadingLabel(
  kind: RepoBranchActionKind,
  phase: 'queued' | 'running' = 'running',
): RepoActionLabel {
  return {
    labelKey:
      phase === 'queued'
        ? (BRANCH_ACTION_QUEUED_LABEL_KEYS[kind] ?? BRANCH_ACTION_LOADING_LABEL_KEYS[kind])
        : BRANCH_ACTION_LOADING_LABEL_KEYS[kind],
  }
}

export function repoEventActionSuccessLabel(action: RepoEventAction | undefined): RepoActionLabel | null {
  if (!action) return null
  switch (action.kind) {
    case 'createWorktree':
      return { labelKey: 'action.create-worktree-created-title' }
    case 'createBranch':
      return { labelKey: 'action.create-branch-created-title' }
    case 'trackRemoteBranch':
      return { labelKey: 'action.track-remote-branch-created-title' }
    case 'removeWorktree':
      return {
        labelKey: action.alsoDeleteBranch
          ? 'action.remove-worktree-removed-with-branch-title'
          : 'action.remove-worktree-removed-title',
      }
    case 'deleteBranch':
      return { labelKey: 'action.delete-branch-deleted-title' }
    case 'checkout':
    case 'pull':
    case 'push':
      return null
  }
}
