import {
  validWorktreeSourceInfo,
  validWorktreeSourceValue,
  worktreeSourceKey,
  type WorktreeSourceInference,
  type WorktreeSourceInfo,
} from '#/shared/worktree-source.ts'

export { worktreeSourceKey } from '#/shared/worktree-source.ts'

export type WorktreeSourceMap = Record<string, WorktreeSourceInfo>
export type WorktreeSourcesByRepo = Record<string, WorktreeSourceMap>

export interface LiveWorktreeSourceTarget {
  branch: string
  worktreePath: string
}

export function getWorktreeSource(
  sources: WorktreeSourceMap | undefined,
  branch: string,
  worktreePath: string | undefined,
): WorktreeSourceInfo | undefined {
  if (!sources || !worktreePath) return undefined
  return sources[worktreeSourceKey(branch, worktreePath)]
}

export function upsertExactWorktreeSource(
  byRepo: WorktreeSourcesByRepo,
  repoId: string,
  input: { branch: string; worktreePath: string; sourceBranch: string; now?: number },
): WorktreeSourcesByRepo {
  if (!validSourceParts(input)) return byRepo
  const entry: WorktreeSourceInfo = {
    branch: input.branch,
    worktreePath: input.worktreePath,
    sourceBranch: input.sourceBranch,
    confidence: 'exact',
    updatedAt: input.now ?? Date.now(),
  }
  return setRepoSourceMap(byRepo, repoId, {
    ...(byRepo[repoId] ?? {}),
    [worktreeSourceKey(input.branch, input.worktreePath)]: entry,
  })
}

export function pruneWorktreeSources(
  byRepo: WorktreeSourcesByRepo,
  repoId: string,
  liveTargets: LiveWorktreeSourceTarget[],
): WorktreeSourcesByRepo {
  const current = byRepo[repoId]
  if (!current) return byRepo
  const liveKeys = new Set(liveTargets.map((target) => worktreeSourceKey(target.branch, target.worktreePath)))
  const next = Object.fromEntries(Object.entries(current).filter(([key]) => liveKeys.has(key)))
  return setRepoSourceMap(byRepo, repoId, next)
}

export function mergeInferredWorktreeSources(
  byRepo: WorktreeSourcesByRepo,
  repoId: string,
  liveTargets: LiveWorktreeSourceTarget[],
  inferences: WorktreeSourceInference[],
  now = Date.now(),
): WorktreeSourcesByRepo {
  if (liveTargets.length === 0 || inferences.length === 0) return byRepo
  const current = byRepo[repoId] ?? {}
  const inferenceByBranch = new Map(inferences.map((entry) => [entry.branch, entry.sourceBranch]))
  let changed = false
  const next: WorktreeSourceMap = { ...current }
  for (const target of liveTargets) {
    const sourceBranch = inferenceByBranch.get(target.branch)
    if (!sourceBranch) continue
    if (!validSourceParts({ ...target, sourceBranch })) continue
    const key = worktreeSourceKey(target.branch, target.worktreePath)
    if (current[key]?.confidence === 'exact') continue
    next[key] = { ...target, sourceBranch, confidence: 'inferred', updatedAt: now }
    changed = true
  }
  return changed ? setRepoSourceMap(byRepo, repoId, next) : byRepo
}

export function normalizeWorktreeSourcesByRepo(value: unknown): WorktreeSourcesByRepo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([repoId, raw]) => [repoId, normalizeWorktreeSourceMap(raw)] as const)
      .filter((entry): entry is readonly [string, WorktreeSourceMap] => Object.keys(entry[1]).length > 0),
  )
}

function setRepoSourceMap(
  byRepo: WorktreeSourcesByRepo,
  repoId: string,
  sourceMap: WorktreeSourceMap,
): WorktreeSourcesByRepo {
  const next = { ...byRepo }
  if (Object.keys(sourceMap).length === 0) delete next[repoId]
  else next[repoId] = sourceMap
  return next
}

function normalizeWorktreeSourceMap(value: unknown): WorktreeSourceMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.values(value as Record<string, unknown>)
      .map(normalizeWorktreeSourceInfo)
      .filter((entry): entry is WorktreeSourceInfo => entry !== null)
      .map((entry) => [worktreeSourceKey(entry.branch, entry.worktreePath), entry]),
  )
}

function normalizeWorktreeSourceInfo(value: unknown): WorktreeSourceInfo | null {
  if (!validWorktreeSourceInfo(value)) return null
  return {
    branch: value.branch,
    worktreePath: value.worktreePath,
    sourceBranch: value.sourceBranch,
    confidence: value.confidence,
    updatedAt: value.updatedAt,
  }
}

function validSourceParts(input: { branch: string; worktreePath: string; sourceBranch: string }): boolean {
  return (
    validWorktreeSourceValue(input.branch, input.sourceBranch) &&
    input.worktreePath.length > 0 &&
    !input.worktreePath.includes('\0')
  )
}
