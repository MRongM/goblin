import { resolveRemoteRepoTarget } from '#/server/modules/repo-backend.ts'
import type { RepoFileTreeResult } from '#/shared/file-tree.ts'
import { isRemoteRepoId } from '#/shared/rpc.ts'
import { listLocalFileTreeDirectory } from '#/system/file-tree/local.ts'
import { listRemoteFileTreeDirectory } from '#/system/ssh/git.ts'

export async function getRepositoryFileTree(
  repoId: string,
  worktreePath: string,
  dirPath: string,
  signal?: AbortSignal,
): Promise<RepoFileTreeResult> {
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (isRemoteRepoId(repoId)) {
    const target = await resolveRemoteRepoTarget(repoId)
    return await listRemoteFileTreeDirectory(target, worktreePath, dirPath, { signal })
  }
  return await listLocalFileTreeDirectory(worktreePath, dirPath)
}
