import { isSafeBranchName } from '#/shared/refnames.ts'
import { isRemoteTrackingRef } from '#/shared/worktree-create.ts'

export type CreateBranchInput =
  | { kind: 'local'; branch: string; baseBranch: string }
  | { kind: 'trackRemote'; localBranch: string; remoteRef: string }

export function normalizeCreateBranchInput(input: unknown): CreateBranchInput | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  switch (raw.kind) {
    case 'local': {
      const branch = stringField(raw.branch)
      const baseBranch = stringField(raw.baseBranch)
      return branch && baseBranch && isSafeBranchName(branch) && isSafeBranchName(baseBranch)
        ? { kind: 'local', branch, baseBranch }
        : null
    }
    case 'trackRemote': {
      const localBranch = stringField(raw.localBranch)
      const remoteRef = stringField(raw.remoteRef)
      return localBranch && remoteRef && isSafeBranchName(localBranch) && isRemoteTrackingRef(remoteRef)
        ? { kind: 'trackRemote', localBranch, remoteRef }
        : null
    }
    default:
      return null
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
