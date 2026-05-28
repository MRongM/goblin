import { beforeEach, describe, expect, test } from 'vitest'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { repoOperation } from '#/renderer/stores/repos/runtime.ts'
import { startResource } from '#/renderer/stores/repos/resources.ts'
import { emptyRepo, replaceRepo } from '#/renderer/stores/repos/helpers.ts'
import {
  createBranch,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/renderer/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/gbl-branch-actions-test-repo'
const REMOTE_TARGET = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: null,
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

beforeEach(() => {
  resetReposStore()
  seedRepoState({
    id: REPO_ID,
    instanceToken: 1,
    branches: [createBranch('feature/a'), createBranch('feature/b')],
  })
})

describe('runBranchAction', () => {
  test('blocks local branch actions while remote fetch resource is busy', async () => {
    let checkoutCalls = 0
    installGoblinTestBridge({
      'repo.checkout': async () => {
        checkoutCalls += 1
        return { ok: true, message: 'ok' }
      },
    })
    useReposStore.setState((s) => ({
      repos: {
        ...s.repos,
        [REPO_ID]: replaceRepo(s.repos[REPO_ID]!, (repo) => {
          startResource(repo.resources.fetch)
        }),
      },
    }))

    const result = await useReposStore.getState().runBranchAction(REPO_ID, { kind: 'checkout', branch: 'feature/a' })

    expect(result).toEqual({ ok: false, message: 'error.network-op-in-progress' })
    expect(checkoutCalls).toBe(0)
  })

  test('tracks branch action resource state while the action is running', async () => {
    let release!: () => void
    installGoblinTestBridge({
      'repo.push': () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: false, message: 'cancelled' })
        }),
    })

    const work = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'push', branch: 'feature/a' })
    const running = useReposStore.getState().repos[REPO_ID]

    expect(running?.resources.branchAction).toMatchObject({
      phase: 'loading',
      kind: 'push',
      target: 'feature/a',
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBe('feature/a')

    release()
    await work

    const settled = useReposStore.getState().repos[REPO_ID]
    expect(settled?.resources.branchAction).toMatchObject({
      phase: 'idle',
      kind: null,
      target: null,
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBeNull()
  })

  test('tracks create worktree resource state while the action is running', async () => {
    let release!: () => void
    installGoblinTestBridge({
      'repo.createWorktree': () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: false, message: 'cancelled' })
        }),
    })

    const work = useReposStore.getState().runBranchAction(REPO_ID, {
      kind: 'createWorktree',
      worktreePath: '/tmp/gbl-branch-actions-test-worktree',
      newBranch: 'feature/new',
      baseBranch: 'feature/a',
    })
    const running = useReposStore.getState().repos[REPO_ID]

    expect(running?.resources.branchAction).toMatchObject({
      phase: 'loading',
      kind: 'createWorktree',
      target: 'feature/new',
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBe('feature/new')

    release()
    await work

    const settled = useReposStore.getState().repos[REPO_ID]
    expect(settled?.resources.branchAction).toMatchObject({
      phase: 'idle',
      kind: null,
      target: null,
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBeNull()
  })

  test('allows remote create worktree and refreshes remote snapshot/status', async () => {
    resetReposStore()
    const remote = emptyRepo(REMOTE_TARGET.id, REMOTE_TARGET.displayName, {
      kind: 'remote',
      remoteTarget: REMOTE_TARGET,
    })
    useReposStore.setState({
      repos: { [REMOTE_TARGET.id]: remote },
      order: [REMOTE_TARGET.id],
      activeId: REMOTE_TARGET.id,
      sessionReady: true,
    })
    const calls: string[] = []
    installGoblinTestBridge({
      'remote.createWorktree': async ({ target, worktreePath, newBranch, baseBranch }: any) => {
        calls.push(`${target.id}:${worktreePath}:${newBranch}:${baseBranch}`)
        return { ok: true, message: 'ok' }
      },
      'remote.snapshot': async () => ({ branches: [], current: '' }),
      'remote.status': async () => [],
      'repo.abort': async () => false,
    })

    const result = await useReposStore.getState().runBranchAction(REMOTE_TARGET.id, {
      kind: 'createWorktree',
      worktreePath: '/srv/goblin-feature-x',
      newBranch: 'feature/x',
      baseBranch: 'main',
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(calls).toEqual([`${REMOTE_TARGET.id}:/srv/goblin-feature-x:feature/x:main`])
  })

  test('allows remote remove worktree and refreshes remote snapshot/status', async () => {
    resetReposStore()
    const remote = emptyRepo(REMOTE_TARGET.id, REMOTE_TARGET.displayName, {
      kind: 'remote',
      remoteTarget: REMOTE_TARGET,
    })
    useReposStore.setState({
      repos: { [REMOTE_TARGET.id]: remote },
      order: [REMOTE_TARGET.id],
      activeId: REMOTE_TARGET.id,
      sessionReady: true,
    })
    const calls: string[] = []
    installGoblinTestBridge({
      'remote.removeWorktree': async ({ target, branch, worktreePath, alsoDeleteBranch, forceDeleteBranch }: any) => {
        calls.push(`${target.id}:${branch}:${worktreePath}:${alsoDeleteBranch}:${forceDeleteBranch}`)
        return { ok: true, message: 'ok' }
      },
      'remote.snapshot': async () => ({ branches: [], current: '' }),
      'remote.status': async () => [],
      'repo.abort': async () => false,
    })

    const result = await useReposStore.getState().runBranchAction(REMOTE_TARGET.id, {
      kind: 'removeWorktree',
      branch: 'feature/x',
      worktreePath: '/srv/goblin-feature-x',
      alsoDeleteBranch: true,
      forceDeleteBranch: false,
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(calls).toEqual([`${REMOTE_TARGET.id}:feature/x:/srv/goblin-feature-x:true:false`])
  })

  test('keeps unsupported remote branch actions unavailable', async () => {
    resetReposStore()
    const remote = emptyRepo(REMOTE_TARGET.id, REMOTE_TARGET.displayName, {
      kind: 'remote',
      remoteTarget: REMOTE_TARGET,
    })
    useReposStore.setState({
      repos: { [REMOTE_TARGET.id]: remote },
      order: [REMOTE_TARGET.id],
      activeId: REMOTE_TARGET.id,
      sessionReady: true,
    })

    const result = await useReposStore.getState().runBranchAction(REMOTE_TARGET.id, {
      kind: 'push',
      branch: 'feature/x',
    })

    expect(result).toEqual({ ok: false, message: 'error.remote-unavailable' })
  })
})
