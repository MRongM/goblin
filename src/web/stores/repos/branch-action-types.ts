import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'

export type RepoBranchAction =
  | { kind: 'checkout'; branch: string }
  | { kind: 'pull'; branch: string; worktreePath?: string }
  | { kind: 'push'; branch: string }
  | { kind: 'createBranch'; branch: string; baseBranch: string }
  | { kind: 'trackRemoteBranch'; localBranch: string; remoteRef: string }
  | { kind: 'createWorktree'; input: CreateWorktreeInput }
  | { kind: 'deleteBranch'; branch: string; force?: boolean; alsoDeleteUpstream?: boolean }
  | {
      kind: 'removeWorktree'
      branch: string
      worktreePath: string
      alsoDeleteBranch: boolean
      forceDeleteBranch?: boolean
      alsoDeleteUpstream?: boolean
    }

export type RepoBranchActionKind = RepoBranchAction['kind']

export interface RunBranchActionOptions {
  token?: number
  deferResultMessages?: string[]
  refreshOnError?: boolean
  /** Internal override for tests that exercise queued refresh wait timeouts. */
  waitTimeoutMs?: number
}
