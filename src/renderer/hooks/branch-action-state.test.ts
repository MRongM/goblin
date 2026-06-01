import { describe, expect, test } from 'vitest'
import {
  branchActionBusyItemId,
  branchActionItemIdFromKind,
  branchActionsAvailable,
  isBranchActionBlocked,
  repoBranchActionsAvailable,
} from '#/renderer/hooks/branch-action-state.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { createBranch } from '#/renderer/stores/repos/test-utils.ts'
import type { RepoBranchActionKind } from '#/renderer/stores/repos/branch-action-types.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'

function setBranchAction(repo: RepoState, kind: RepoBranchActionKind, target: string, phase: 'queued' | 'running' = 'running') {
  repo.operations.branchAction = {
    operationId: 1,
    phase,
    reason: `branch:${kind}` as const,
    target,
    startedAt: Date.now(),
    settledAt: null,
    error: null,
  }
}

describe('isBranchActionBlocked', () => {
  test('returns false while branch actions are idle', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-state', 'repo')

    expect(isBranchActionBlocked(repo)).toBe(false)
  })

  test('uses repo branch action operation state for cross-button blocking', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-blocked', 'repo')
    setBranchAction(repo, 'push', 'feature/a')

    expect(isBranchActionBlocked(repo)).toBe(true)
  })

  test('treats queued branch actions as blocked', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-queued', 'repo')
    setBranchAction(repo, 'push', 'feature/a', 'queued')

    expect(isBranchActionBlocked(repo)).toBe(true)
  })
})

describe('repoBranchActionsAvailable', () => {
  test('enables branch actions for local repos and remote repos with a target', () => {
    const local = emptyRepo('/tmp/gbl-branch-action-local', 'repo')
    const remote = emptyRepo('ssh://deploy@prod:22/srv/goblin', 'prod:goblin', {
      kind: 'remote',
      remoteTarget: {
        id: 'ssh://deploy@prod:22/srv/goblin',
        alias: 'prod',
        host: 'prod',
        user: 'deploy',
        port: 22,
        remotePath: '/srv/goblin',
        displayName: 'prod:goblin',
      },
    })
    const remoteMissingTarget = emptyRepo('ssh://deploy@prod:22/srv/missing', 'prod:missing', { kind: 'remote' })

    expect(repoBranchActionsAvailable(local)).toBe(true)
    expect(repoBranchActionsAvailable(remote)).toBe(true)
    expect(repoBranchActionsAvailable(remoteMissingTarget)).toBe(false)
  })

  test('remote branches with worktrees expose branch actions', () => {
    const remote = emptyRepo('ssh://deploy@prod:22/srv/goblin', 'prod:goblin', {
      kind: 'remote',
      remoteTarget: {
        id: 'ssh://deploy@prod:22/srv/goblin',
        alias: 'prod',
        host: 'prod',
        user: 'deploy',
        port: 22,
        remotePath: '/srv/goblin',
        displayName: 'prod:goblin',
      },
    })

    expect(branchActionsAvailable(remote, createBranch('feature/x'))).toBe(true)
    expect(branchActionsAvailable(remote, createBranch('feature/x', { worktreePath: '/srv/goblin-feature-x' }))).toBe(
      true,
    )
  })
})

describe('branchActionBusyItemId', () => {
  test('maps store-backed branch action operation kinds to UI actions', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-operation', 'repo')

    setBranchAction(repo, 'checkout', 'feature/a')
    expect(branchActionBusyItemId(repo, 'feature/a')).toBe('checkout')

    setBranchAction(repo, 'pull', 'feature/a')
    expect(branchActionBusyItemId(repo, 'feature/a')).toBe('pull')

    setBranchAction(repo, 'push', 'feature/a')
    expect(branchActionBusyItemId(repo, 'feature/a')).toBe('push')

    setBranchAction(repo, 'deleteBranch', 'feature/a')
    expect(branchActionBusyItemId(repo, 'feature/a')).toBe('deleteBranch')

    setBranchAction(repo, 'removeWorktree', 'feature/a')
    expect(branchActionBusyItemId(repo, 'feature/a')).toBe('removeWorktree')
  })

  test('only marks the target branch action item as busy', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-operation-target', 'repo')

    setBranchAction(repo, 'pull', 'feature/a')

    expect(branchActionBusyItemId(repo, 'feature/a')).toBe('pull')
    expect(branchActionBusyItemId(repo, 'feature/b')).toBeNull()
  })

  test('maps remote tracking checkout resource kind to checkout locally action item', () => {
    expect(branchActionItemIdFromKind('checkoutRemoteBranch')).toBe('checkoutRemoteBranch')
  })

  test('returns null when idle or when no branch action item owns the operation', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-operation-idle', 'repo')

    expect(branchActionBusyItemId(repo, 'feature/a')).toBeNull()

    setBranchAction(repo, 'createWorktree', 'feature/a')
    expect(branchActionBusyItemId(repo, 'feature/a')).toBeNull()
  })
})
