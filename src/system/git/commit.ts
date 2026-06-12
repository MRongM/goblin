import { gitResultWithOptions } from '#/system/git/helper.ts'
import type { ExecResult } from '#/shared/git-types.ts'

/**
 * Stage all changes and commit with the given message.
 * Runs `git add -A && git commit -m <message>` in the given working directory.
 * The cwd should be the worktree path, not the repo root.
 */
export async function commitAllChanges(
  cwd: string,
  message: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const addResult = await gitResultWithOptions(cwd, { signal }, 'add', '-A')
  if (!addResult.ok) return addResult
  return gitResultWithOptions(cwd, { signal }, 'commit', '-m', message)
}
