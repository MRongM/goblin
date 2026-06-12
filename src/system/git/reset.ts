import { gitResultWithOptions } from '#/system/git/helper.ts'
import type { ExecResult } from '#/shared/git-types.ts'

/**
 * Run `git reset --hard HEAD~1` in the given working directory.
 * Discards all uncommitted changes and moves HEAD back one commit.
 * The cwd should be the worktree path, not the repo root.
 */
export async function resetHardToPreviousCommit(
  cwd: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return gitResultWithOptions(cwd, { signal }, 'reset', '--hard', 'HEAD~1')
}
