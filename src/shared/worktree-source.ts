import { isSafeBranchName } from '#/shared/refnames.ts'

export type WorktreeSourceConfidence = 'exact' | 'inferred'

export interface WorktreeSourceInfo {
  branch: string
  worktreePath: string
  sourceBranch: string
  confidence: WorktreeSourceConfidence
  updatedAt: number
}

export interface WorktreeSourceInference {
  branch: string
  sourceBranch: string
}

const CREATED_FROM_RE = /^branch: Created from (.+)$/
const SOURCE_KEY_SEPARATOR = '\0'

export function worktreeSourceKey(branch: string, worktreePath: string): string {
  return `${branch}${SOURCE_KEY_SEPARATOR}${worktreePath}`
}

export function validWorktreeSourceValue(branch: string, sourceBranch: string): boolean {
  return isSafeBranchName(branch) && isSafeBranchName(sourceBranch) && sourceBranch !== branch
}

export function parseWorktreeSourceFromReflog(messages: string, branch: string): string | null {
  if (!isSafeBranchName(branch)) return null
  for (const line of messages.split('\n')) {
    const match = CREATED_FROM_RE.exec(line.trim())
    if (!match) continue
    const sourceBranch = normalizeSourceRef(match[1] ?? '')
    if (!sourceBranch || !validWorktreeSourceValue(branch, sourceBranch)) continue
    return sourceBranch
  }
  return null
}

export function inferWorktreeSourceFromReflogMessages(
  branch: string,
  messages: string,
): WorktreeSourceInference | null {
  const sourceBranch = parseWorktreeSourceFromReflog(messages, branch)
  return sourceBranch ? { branch, sourceBranch } : null
}

export function validWorktreeSourceInfo(value: unknown): value is WorktreeSourceInfo {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<WorktreeSourceInfo>
  return (
    typeof item.branch === 'string' &&
    typeof item.worktreePath === 'string' &&
    item.worktreePath.length > 0 &&
    !item.worktreePath.includes(SOURCE_KEY_SEPARATOR) &&
    typeof item.sourceBranch === 'string' &&
    (item.confidence === 'exact' || item.confidence === 'inferred') &&
    typeof item.updatedAt === 'number' &&
    Number.isFinite(item.updatedAt) &&
    validWorktreeSourceValue(item.branch, item.sourceBranch)
  )
}

function normalizeSourceRef(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('refs/heads/')) return trimmed.slice('refs/heads/'.length)
  if (trimmed.startsWith('refs/remotes/')) return trimmed.slice('refs/remotes/'.length)
  return trimmed
}
