import { isSafeBranchName } from '#/shared/refnames.ts'
import { gitResultWithOptions } from '#/system/git/helper.ts'
import type { ExecResult } from '#/shared/git-types.ts'

/**
 * Merge the given local branch into the current branch of the worktree at cwd.
 * Runs `git merge -- <branch>`. On conflict the caller receives the git stderr.
 */
export async function mergeBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isSafeBranchName(branch)) return { ok: false, message: 'error.invalid-arguments' }
  return gitResultWithOptions(cwd, { signal }, 'merge', '--', branch)
}
