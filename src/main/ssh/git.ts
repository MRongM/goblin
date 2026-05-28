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
import type { BranchInfo, LogEntry, WorktreeInfo, WorktreeStatus } from '#/shared/git-types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

type RemoteGitRunner = (
  command: RemoteCommandKind,
  target: RemoteRepoTarget,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<RemoteCommandResult>

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
