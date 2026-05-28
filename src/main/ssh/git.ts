import { parseBranches, parseLog, parseStatus, parseWorktrees } from '#/main/git/parsers.ts'
import { markDefaultBranch, prioritizeDefaultBranch } from '#/main/git/branches.ts'
import {
  REMOTE_SNAPSHOT_BRANCHES_MARKER,
  REMOTE_SNAPSHOT_CURRENT_MARKER,
  REMOTE_SNAPSHOT_DEFAULT_MARKER,
  runRemoteCommand,
  type RemoteCommandKind,
  type RemoteCommandResult,
} from '#/main/ssh/commands.ts'
import { PROTECTED_BRANCHES, type BranchInfo, type ExecResult, type LogEntry, type WorktreeInfo, type WorktreeStatus } from '#/shared/git-types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

type RemoteGitRunner = (
  command: RemoteCommandKind,
  target: RemoteRepoTarget,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<RemoteCommandResult>

const REMOTE_WORKTREE_OP_TIMEOUT_MS = 180_000
const REMOTE_WORKTREE_STATUS_CONCURRENCY = 8

export interface RemoteRepoSnapshot {
  branches: BranchInfo[]
  current: string
}

interface SnapshotSections {
  current: string[]
  defaultBranch: string[]
  branches: string[]
}

interface RemoveRemoteWorktreeInput {
  branch: string
  worktreePath: string
  alsoDeleteBranch: boolean
  forceDeleteBranch?: boolean
  signal?: AbortSignal
  run?: RemoteGitRunner
}

export async function getRemoteSnapshot(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<RemoteRepoSnapshot | null> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const [result, worktrees] = await Promise.all([
    run({ type: 'gitSnapshot', path: target.remotePath }, target, { signal: options.signal }),
    getRemoteWorktrees(target, { signal: options.signal, run }),
  ])
  if (!result.ok) return null
  return parseRemoteSnapshot(result.stdout, worktrees)
}

export async function fetchRemoteRepository(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitFetch', path: target.remotePath }, target, { signal: options.signal })
  return remoteExecResult(result)
}

export async function getRemoteStatus(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<WorktreeStatus[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitWorktreeList', path: target.remotePath }, target, { signal: options.signal })
  if (!result.ok || options.signal?.aborted) return []
  const worktrees = parseWorktrees(result.stdout).filter((worktree) => !worktree.isBare)
  const statuses = await mapWithConcurrency(
    worktrees,
    REMOTE_WORKTREE_STATUS_CONCURRENCY,
    async (worktree): Promise<WorktreeStatus | null> => {
      const status = await run({ type: 'gitStatus', path: worktree.path }, target, { signal: options.signal })
      if (options.signal?.aborted) return null
      return {
        path: worktree.path,
        branch: worktree.branch,
        isMain: worktree.isPrimary,
        entries: status.ok ? parseStatus(status.stdout) : [],
      }
    },
    options.signal,
  )
  return statuses.filter((status): status is WorktreeStatus => status !== null)
}

export async function getRemoteLog(
  target: RemoteRepoTarget,
  branch: string,
  count?: number,
  skip?: number,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<LogEntry[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitLog', path: target.remotePath, branch, count, skip }, target, {
    signal: options.signal,
  })
  if (!result.ok || options.signal?.aborted) return []
  return parseLog(result.stdout)
}

export async function createRemoteWorktree(
  target: RemoteRepoTarget,
  input: { worktreePath: string; newBranch: string; baseBranch: string; signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<ExecResult> {
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    {
      type: 'gitWorktreeAdd',
      path: target.remotePath,
      worktreePath: input.worktreePath,
      newBranch: input.newBranch,
      baseBranch: input.baseBranch,
    },
    target,
    { signal: input.signal, timeoutMs: REMOTE_WORKTREE_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}

export async function removeRemoteWorktree(
  target: RemoteRepoTarget,
  input: RemoveRemoteWorktreeInput,
): Promise<ExecResult> {
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }

  const listResult = await run({ type: 'gitWorktreeList', path: target.remotePath }, target, { signal: input.signal })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!listResult.ok) return remoteExecResult(listResult)

  const resolved = resolveRemoteRemovableWorktree(
    parseWorktrees(listResult.stdout),
    input.branch,
    input.worktreePath,
    target.remotePath,
  )
  if ('ok' in resolved) return resolved
  if (resolved.isLocked === true) return { ok: false, message: 'error.cannot-remove-locked-worktree' }

  const status = await run({ type: 'gitStatus', path: resolved.path }, target, { signal: input.signal })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!status.ok) return { ok: false, message: 'error.cannot-remove-dirty-worktree' }
  if (parseStatus(status.stdout).length > 0) return { ok: false, message: 'error.cannot-remove-dirty-worktree' }

  const shouldForceDeleteBranch = input.forceDeleteBranch === true
  if (input.alsoDeleteBranch) {
    if (PROTECTED_BRANCHES.has(input.branch)) return { ok: false, message: 'error.cannot-delete-protected-branch' }
    const safelyDeletable =
      shouldForceDeleteBranch ||
      (await isRemoteSafelyDeletableBranch(target, input.branch, { signal: input.signal, run }))
    if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
    if (!safelyDeletable) return { ok: false, message: 'error.cannot-remove-unpushed-worktree' }
  }

  const removeResult = await run(
    { type: 'gitWorktreeRemove', path: target.remotePath, worktreePath: resolved.path },
    target,
    { signal: input.signal, timeoutMs: REMOTE_WORKTREE_OP_TIMEOUT_MS },
  )
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!removeResult.ok) return remoteExecResult(removeResult)
  if (!input.alsoDeleteBranch) return remoteExecResult(removeResult)

  const deleteResult = await run(
    { type: 'gitBranchDelete', path: target.remotePath, branch: input.branch, force: shouldForceDeleteBranch },
    target,
    { signal: input.signal, timeoutMs: REMOTE_WORKTREE_OP_TIMEOUT_MS },
  )
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  return remoteExecResult(deleteResult)
}

export function parseRemoteSnapshot(output: string, worktrees: WorktreeInfo[] = []): RemoteRepoSnapshot | null {
  const sections = splitSnapshotSections(output)
  if (!sections) return null
  const current = firstLine(sections.current)
  const defaultBranch = firstLine(sections.defaultBranch)
  const branchOutput = sections.branches.join('\n')
  const branches = parseBranches(branchOutput, current, worktrees)
  const markedBranches = markDefaultBranch(branches, defaultBranch)
  return {
    branches: prioritizeDefaultBranch(markedBranches, defaultBranch),
    current,
  }
}

async function getRemoteWorktrees(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<WorktreeInfo[]> {
  const result = await options.run({ type: 'gitWorktreeList', path: target.remotePath }, target, {
    signal: options.signal,
  })
  if (!result.ok || options.signal?.aborted) return []
  const worktrees = parseWorktrees(result.stdout)
  await mapWithConcurrency(
    worktrees,
    REMOTE_WORKTREE_STATUS_CONCURRENCY,
    async (worktree) => {
      if (worktree.isBare) return
      const status = await options.run({ type: 'gitStatus', path: worktree.path }, target, { signal: options.signal })
      if (options.signal?.aborted) return
      if (!status.ok) {
        worktree.isDirty = undefined
        return
      }
      const entries = parseStatus(status.stdout)
      worktree.isDirty = entries.length > 0
      worktree.changeCount = entries.length
    },
    options.signal,
  )
  return worktrees
}

function resolveRemoteRemovableWorktree(
  worktrees: WorktreeInfo[],
  branch: string,
  worktreePath: string,
  repoPath: string,
): WorktreeInfo | ExecResult {
  const target = worktrees.find((wt) => wt.path === worktreePath && wt.branch === branch)
  if (!target) return { ok: false, message: 'error.worktree-not-found-for-branch' }
  if (target.isPrimary || target.path === repoPath) return { ok: false, message: 'error.cannot-remove-main-worktree' }
  return target
}

async function getRemoteUpstream(
  target: RemoteRepoTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<string | null> {
  const result = await options.run({ type: 'gitUpstream', path: target.remotePath, branch }, target, {
    signal: options.signal,
  })
  if (!result.ok || options.signal?.aborted) return null
  return result.stdout.trim() || null
}

async function isRemoteAncestor(
  target: RemoteRepoTarget,
  ancestor: string,
  descendant: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<boolean> {
  const result = await options.run({ type: 'gitIsAncestor', path: target.remotePath, ancestor, descendant }, target, {
    signal: options.signal,
  })
  return result.ok && !options.signal?.aborted
}

async function isRemoteSafelyDeletableBranch(
  target: RemoteRepoTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<boolean> {
  const upstream = await getRemoteUpstream(target, branch, options)
  if (options.signal?.aborted) return false
  return isRemoteAncestor(target, branch, upstream ?? 'HEAD', options)
}

function remoteExecResult(result: RemoteCommandResult): ExecResult {
  if (result.ok) return { ok: true, message: result.stdout || result.stderr || 'ok' }
  return { ok: false, message: result.message || result.stderr || 'error.unknown' }
}

function splitSnapshotSections(output: string): SnapshotSections | null {
  const sections: SnapshotSections = { current: [], defaultBranch: [], branches: [] }
  let active: keyof SnapshotSections | null = null
  for (const line of output.split('\n')) {
    if (line === REMOTE_SNAPSHOT_CURRENT_MARKER) {
      active = 'current'
      continue
    }
    if (line === REMOTE_SNAPSHOT_DEFAULT_MARKER) {
      active = 'defaultBranch'
      continue
    }
    if (line === REMOTE_SNAPSHOT_BRANCHES_MARKER) {
      active = 'branches'
      continue
    }
    if (active) sections[active].push(line)
  }
  if (!output.includes(REMOTE_SNAPSHOT_BRANCHES_MARKER)) return null
  return sections
}

function firstLine(lines: string[]): string {
  return lines.find((line) => line.trim().length > 0)?.trim() ?? ''
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async () => {
    while (true) {
      if (signal?.aborted) return
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
