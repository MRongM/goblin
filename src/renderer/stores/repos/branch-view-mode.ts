import type { BranchViewMode, RepoBranchState, RepoState } from '#/renderer/stores/repos/types.ts'

interface BranchSelectionInput {
  branches: RepoBranchState[]
  currentBranch: string
  selectedBranch: string | null
  viewMode: BranchViewMode
  branchOrder?: string[]
}

interface VisibleBranchesInput {
  branches: RepoBranchState[]
  viewMode: BranchViewMode
  searchQuery?: string
  branchOrder?: string[]
}

export function branchMatchesViewMode(branch: RepoBranchState, viewMode: BranchViewMode): boolean {
  if (viewMode === 'worktrees') return !!branch.worktree?.path
  if (viewMode === 'no-worktree') return !branch.worktree?.path
  return true
}

function branchVisibleInMainList(branch: RepoBranchState, viewMode: BranchViewMode): boolean {
  return branch.remoteTracking !== true && branchMatchesViewMode(branch, viewMode)
}

export function branchMatchesSearchQuery(branch: RepoBranchState, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle.length === 0 || branch.name.toLowerCase().includes(needle)
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item === undefined) return items
  next.splice(to, 0, item)
  return next
}

function completeBranchOrder(branches: RepoBranchState[], branchOrder: string[]): string[] {
  const branchNames = new Set(branches.map((branch) => branch.name))
  const ordered = branchOrder.filter((name, index) => branchNames.has(name) && branchOrder.indexOf(name) === index)
  const orderedSet = new Set(ordered)
  return [...ordered, ...branches.map((branch) => branch.name).filter((name) => !orderedSet.has(name))]
}

export function normalizeBranchOrder(branches: RepoBranchState[], branchOrder: string[]): string[] {
  if (branchOrder.length === 0) return []
  return completeBranchOrder(branches, branchOrder)
}

export function orderedBranches(branches: RepoBranchState[], branchOrder: string[]): RepoBranchState[] {
  if (branchOrder.length === 0) return branches
  const byName = new Map(branches.map((branch) => [branch.name, branch]))
  return completeBranchOrder(branches, branchOrder)
    .map((name) => byName.get(name))
    .filter((branch): branch is RepoBranchState => !!branch)
}

export function visibleBranches(input: RepoState | VisibleBranchesInput): RepoBranchState[] {
  if ('data' in input) {
    const branches = orderedBranches(input.data.branches, input.ui.branchOrder)
    return branches.filter((branch) => branchVisibleInMainList(branch, input.ui.branchViewMode))
  }
  return orderedBranches(input.branches, input.branchOrder ?? []).filter(
    (branch) =>
      branchVisibleInMainList(branch, input.viewMode) && branchMatchesSearchQuery(branch, input.searchQuery ?? ''),
  )
}

export function reorderedBranchOrder(
  branches: RepoBranchState[],
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
