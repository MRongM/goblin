import type { BranchInfo } from '#/renderer/types.ts'
import type { BranchViewMode, RepoState } from '#/renderer/stores/repos/types.ts'

interface BranchSelectionInput {
  branches: BranchInfo[]
  currentBranch: string
  selectedBranch: string | null
  viewMode: BranchViewMode
  branchOrder?: string[]
}

export function branchMatchesViewMode(branch: BranchInfo, viewMode: BranchViewMode): boolean {
  if (viewMode === 'worktrees') return !!branch.worktreePath
  if (viewMode === 'no-worktree') return !branch.worktreePath
  return true
}

function branchVisibleInMainList(branch: BranchInfo, viewMode: BranchViewMode): boolean {
  return branch.remoteTracking !== true && branchMatchesViewMode(branch, viewMode)
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item === undefined) return items
  next.splice(to, 0, item)
  return next
}

function completeBranchOrder(branches: BranchInfo[], branchOrder: string[]): string[] {
  const branchNames = new Set(branches.map((branch) => branch.name))
  const ordered = branchOrder.filter((name, index) => branchNames.has(name) && branchOrder.indexOf(name) === index)
  const orderedSet = new Set(ordered)
  return [...ordered, ...branches.map((branch) => branch.name).filter((name) => !orderedSet.has(name))]
}

export function normalizeBranchOrder(branches: BranchInfo[], branchOrder: string[]): string[] {
  if (branchOrder.length === 0) return []
  return completeBranchOrder(branches, branchOrder)
}

export function orderedBranches(branches: BranchInfo[], branchOrder: string[]): BranchInfo[] {
  if (branchOrder.length === 0) return branches
  const byName = new Map(branches.map((branch) => [branch.name, branch]))
  return completeBranchOrder(branches, branchOrder)
    .map((name) => byName.get(name))
    .filter((branch): branch is BranchInfo => !!branch)
}

export function visibleBranches(repo: RepoState): BranchInfo[] {
  const branches = orderedBranches(repo.data.branches, repo.ui.branchOrder)
  return branches.filter((branch) => branchVisibleInMainList(branch, repo.ui.branchViewMode))
}

export function reorderedBranchOrder(
  branches: BranchInfo[],
  branchOrder: string[],
  viewMode: BranchViewMode,
  fromBranch: string,
  toBranch: string,
): string[] {
  if (fromBranch === toBranch) return branchOrder
  const allNames = completeBranchOrder(branches, branchOrder)
  const visibleNames = orderedBranches(branches, allNames)
    .filter((branch) => branchVisibleInMainList(branch, viewMode))
    .map((branch) => branch.name)
  const from = visibleNames.indexOf(fromBranch)
  const to = visibleNames.indexOf(toBranch)
  if (from === -1 || to === -1) return branchOrder
  const reorderedVisible = moveItem(visibleNames, from, to)
  if (viewMode === 'all') return reorderedVisible

  const visibleSet = new Set(visibleNames)
  let visibleIndex = 0
  return allNames.map((name) => {
    if (!visibleSet.has(name)) return name
    return reorderedVisible[visibleIndex++] ?? name
  })
}

export function selectedBranchForBranchSet({
  branches,
  currentBranch,
  selectedBranch,
  viewMode,
  branchOrder = [],
}: BranchSelectionInput): string | null {
  const visible = orderedBranches(branches, branchOrder).filter((branch) => branchVisibleInMainList(branch, viewMode))
  if (selectedBranch && visible.some((branch) => branch.name === selectedBranch)) return selectedBranch
  return visible.find((branch) => branch.name === currentBranch)?.name ?? visible[0]?.name ?? null
}

export function selectedBranchForViewMode(repo: RepoState, viewMode: BranchViewMode): string | null {
  return selectedBranchForBranchSet({
    branches: repo.data.branches,
    currentBranch: repo.data.currentBranch,
    selectedBranch: repo.ui.selectedBranch,
    viewMode,
    branchOrder: repo.ui.branchOrder,
  })
}

export function branchForVisibleLog(repo: RepoState): string | null {
  return repo.ui.selectedBranch ?? (repo.ui.branchViewMode === 'all' ? repo.data.currentBranch : null)
}
