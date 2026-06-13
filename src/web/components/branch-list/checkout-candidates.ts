import type { RepoBranchState } from '#/web/stores/repos/types.ts'

export function checkoutBranchCandidates(currentBranch: string, branches: RepoBranchState[]): RepoBranchState[] {
  return branches.filter((branch) => branch.name !== currentBranch && !branch.worktree?.path)
}
