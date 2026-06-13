import { openExternalUrl } from '#/web/app-shell-client.ts'
import { postServerJson } from '#/web/lib/server-fetch.ts'
import type { RepoFileTransferRequest, RepoFileTransferResult, RepoFileTreeResult } from '#/shared/file-tree.ts'
import type { CloneRepoResult, PullRequestEntry, RepoSnapshot } from '#/shared/rpc.ts'
import type { ExecResult, PullRequestFetchMode, WorktreeStatus } from '#/shared/git-types.ts'
import type { ProbeResult } from '#/shared/rpc.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'

export async function probeRepository(cwd: string): Promise<ProbeResult> {
  return await postServerJson('/api/repo/probe', { cwd })
}

export async function cloneRepository(input: {
  operationId: string
  url: string
  parentPath: string
  directoryName: string
}): Promise<CloneRepoResult> {
  return await postServerJson('/api/repo/clone', input)
}

export async function abortCloneOperation(operationId: string): Promise<boolean> {
  return await postServerJson('/api/repo/abort-clone', { operationId })
}

export async function getRepositorySnapshot(cwd: string, signal?: AbortSignal): Promise<RepoSnapshot | null> {
  return await postServerJson('/api/repo/snapshot', { cwd }, { signal })
}

export async function getRepositoryStatus(cwd: string, signal?: AbortSignal): Promise<WorktreeStatus[]> {
  return await postServerJson('/api/repo/status', { cwd }, { signal })
}

export async function getRepositoryPullRequests(
  cwd: string,
  branches?: string[],
  options?: { mode?: PullRequestFetchMode },
  signal?: AbortSignal,
): Promise<PullRequestEntry[] | null> {
  return await postServerJson('/api/repo/pull-requests', { cwd, branches, options }, { signal })
}

export async function abortRepositoryOperation(cwd: string): Promise<boolean> {
  return await postServerJson('/api/repo/abort', { cwd })
}

export async function fetchRepository(
  cwd: string,
  kind?: 'user' | 'background',
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<{ ok: boolean; message: string }> {
  return await postServerJson('/api/repo/fetch', kind ? { cwd, kind, sourceToken } : { cwd, sourceToken }, { signal })
}

export async function checkoutRepositoryBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/checkout', { cwd, branch, sourceToken }, { signal })
}

export async function pullRepositoryBranch(
  cwd: string,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/pull', { cwd, branch, worktreePath, sourceToken }, { signal })
}

export async function pushRepositoryBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/push', { cwd, branch, sourceToken }, { signal })
}

export async function createRepositoryWorktree(
  cwd: string,
  input: CreateWorktreeInput,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/create-worktree',
    { cwd, ...input, sourceToken },
    { signal },
  )
}

export async function deleteRepositoryBranch(
  cwd: string,
  branch: string,
  options?: { force?: boolean; alsoDeleteUpstream?: boolean },
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/delete-branch',
    { cwd, branch, force: options?.force, alsoDeleteUpstream: options?.alsoDeleteUpstream, sourceToken },
    { signal },
  )
}

export async function removeRepositoryWorktree(
  cwd: string,
  options: {
    branch: string
    worktreePath: string
    alsoDeleteBranch: boolean
    forceDeleteBranch?: boolean
    alsoDeleteUpstream?: boolean
  },
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/remove-worktree', { cwd, ...options, sourceToken }, { signal })
}

export async function getRepositoryPatch(cwd: string, worktreePath: string, signal?: AbortSignal): Promise<ExecResult> {
  return await postServerJson('/api/repo/patch', { cwd, worktreePath }, { signal })
}

export async function getRepositoryFileTree(
  repoId: string,
  worktreePath: string,
  dirPath: string,
  signal?: AbortSignal,
): Promise<RepoFileTreeResult> {
  return await postServerJson('/api/repo/file-tree', { repoId, worktreePath, dirPath }, { signal })
}

export async function renameRepositoryFileTreeEntry(
  repoId: string,
  worktreePath: string,
  oldPath: string,
  newName: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/file-tree/rename', { repoId, worktreePath, oldPath, newName })
}

export async function deleteRepositoryFileTreeEntries(
  repoId: string,
  worktreePath: string,
  paths: string[],
): Promise<ExecResult> {
  return await postServerJson('/api/repo/file-tree/delete', { repoId, worktreePath, paths })
}

export async function transferRepositoryFiles(input: RepoFileTransferRequest): Promise<RepoFileTransferResult> {
  return await postServerJson('/api/repo/file-transfer', input)
}

export async function openRepositoryRemote(cwd: string, branch?: string): Promise<ExecResult> {
  const result = await postServerJson<{ cwd: string; branch?: string }, ExecResult>(
    '/api/repo/open-remote',
    branch ? { cwd, branch } : { cwd },
  )
  if (!result.ok || !result.message) return result
  const opened = await openExternalUrl(result.message)
  return opened.ok ? { ok: true, message: '' } : opened
}

export async function openRepositoryTerminal(path: string): Promise<ExecResult> {
  return await postServerJson('/api/repo/open-terminal', { path })
}

export async function openRepositoryEditor(path: string): Promise<ExecResult> {
  return await postServerJson('/api/repo/open-editor', { path })
}

export async function setBackgroundSyncRepos(repoIds: string[]): Promise<void> {
  await postServerJson('/api/repo/background-sync-repos', { repoIds })
}

export async function getRepositoryRemoteBranches(cwd: string, signal?: AbortSignal): Promise<string[]> {
  return await postServerJson('/api/repo/remote-branches', { cwd }, { signal })
}

export async function checkoutBranchInWorktree(
  repoId: string,
  worktreePath: string,
  branch: string,
): Promise<ExecResult> {
  return postServerJson('/api/repo/checkout-in-worktree', { repoId, worktreePath, branch })
}

export async function commitRepositoryChanges(
  repoId: string,
  worktreePath: string,
  message: string,
): Promise<ExecResult> {
  return postServerJson('/api/repo/commit', { repoId, worktreePath, message })
}

export async function mergeRepositoryBranch(
  repoId: string,
  worktreePath: string,
  branch: string,
): Promise<ExecResult> {
  return postServerJson('/api/repo/merge', { repoId, worktreePath, branch })
}

export async function resetRepositoryHard(
  repoId: string,
  worktreePath: string,
): Promise<ExecResult> {
  return postServerJson('/api/repo/reset-hard', { repoId, worktreePath })
}
