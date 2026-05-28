import { parseBranches } from '#/main/git/parsers.ts'
import { markDefaultBranch, prioritizeDefaultBranch } from '#/main/git/branches.ts'
import {
  REMOTE_SNAPSHOT_BRANCHES_MARKER,
  REMOTE_SNAPSHOT_CURRENT_MARKER,
  REMOTE_SNAPSHOT_DEFAULT_MARKER,
  runRemoteCommand,
  type RemoteCommandKind,
  type RemoteCommandResult,
} from '#/main/ssh/commands.ts'
import type { BranchInfo } from '#/shared/git-types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

type RemoteGitRunner = (
  command: RemoteCommandKind,
  target: RemoteRepoTarget,
  options?: { signal?: AbortSignal },
) => Promise<RemoteCommandResult>

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
  const result = await run({ type: 'gitSnapshot', path: target.remotePath }, target, { signal: options.signal })
  if (!result.ok) return null
  return parseRemoteSnapshot(result.stdout)
}

export function parseRemoteSnapshot(output: string): RemoteRepoSnapshot | null {
  const sections = splitSnapshotSections(output)
  if (!sections) return null
  const current = firstLine(sections.current)
  const defaultBranch = firstLine(sections.defaultBranch)
  const branchOutput = sections.branches.join('\n')
  const branches = parseBranches(branchOutput, current)
  const markedBranches = markDefaultBranch(branches, defaultBranch)
  return {
    branches: prioritizeDefaultBranch(markedBranches, defaultBranch),
    current,
  }
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
