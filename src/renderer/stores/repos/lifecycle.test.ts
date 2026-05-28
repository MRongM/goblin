import { beforeEach, describe, expect, test } from 'vitest'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { BranchInfo } from '#/renderer/types.ts'
import {
  branch,
  flushRpc,
  installGoblin,
  REPO_A,
  REPO_B,
  resetLifecycleTest,
} from '#/renderer/stores/repos/lifecycle-test-utils.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

beforeEach(resetLifecycleTest)

const REMOTE_TARGET: RemoteRepoTarget = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: 'prod',
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

describe('repo lifecycle', () => {
  test('openRepo opens the resolved repo, records it as recent, and starts initial local refresh', async () => {
    const calls = installGoblin()

    const result = await useReposStore.getState().openRepo(REPO_A)

    expect(result).toEqual({ ok: true, id: REPO_A })
    expect(useReposStore.getState().order).toEqual([REPO_A])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(calls.recent).toEqual([REPO_A])
    expect(calls.snapshot).toEqual([REPO_A])
    expect(calls.status).toEqual([REPO_A])
  })

  test('openRepo with activate false opens without changing the active repo', async () => {
    const calls = installGoblin()

    await useReposStore.getState().openRepo(REPO_A)
    await useReposStore.getState().openRepo(REPO_B, { activate: false })

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(calls.snapshot).toEqual([REPO_A, REPO_B])
    expect(calls.status).toEqual([REPO_A, REPO_B])
  })

  test('openRepo activates and locally refreshes an already-open repo', async () => {
    const calls = installGoblin()

    await useReposStore.getState().openRepo(REPO_A)
    await useReposStore.getState().openRepo(REPO_B)
    await useReposStore.getState().openRepo(REPO_A)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(calls.snapshot).toEqual([REPO_A, REPO_B, REPO_A])
    expect(calls.status).toEqual([REPO_A, REPO_B, REPO_A])
  })
  test('initial refresh results from a closed repo instance do not overwrite a reopened repo', async () => {
    const snapshotResolvers: Array<(value: { branches: BranchInfo[]; current: string }) => void> = []
    installGoblin({
      snapshot: () =>
        new Promise<{ branches: BranchInfo[]; current: string }>((resolve) => {
          snapshotResolvers.push(resolve)
        }),
    })

    await useReposStore.getState().openRepo(REPO_A)
    const firstToken = useReposStore.getState().repos[REPO_A]?.instanceToken
    useReposStore.getState().closeRepo(REPO_A)
    await useReposStore.getState().openRepo(REPO_A)
    const secondToken = useReposStore.getState().repos[REPO_A]?.instanceToken

    snapshotResolvers[1]?.({ branches: [branch('fresh')], current: 'fresh' })
    await flushRpc()

    expect(secondToken).not.toBe(firstToken)
    expect(useReposStore.getState().repos[REPO_A]?.data.currentBranch).toBe('fresh')

    snapshotResolvers[0]?.({ branches: [branch('stale')], current: 'stale' })
    await flushRpc()

    expect(useReposStore.getState().repos[REPO_A]?.data.currentBranch).toBe('fresh')
  })

  test('openRemoteRepo adds, focuses, and loads a remote repo without local probe or recent side effects', async () => {
    const remoteSnapshots: string[] = []
    const calls = installGoblin({
      probe: () => {
        throw new Error('remote repo should not use local probe')
      },
      'remote.testRepository': async () => ({ target: REMOTE_TARGET, ok: true, stages: [] }),
      'remote.snapshot': async ({ target }: { target: RemoteRepoTarget }) => {
        remoteSnapshots.push(target.id)
        return {
          branches: [branch('main', { isCurrent: true, lastCommitHash: 'abc1234' })],
          current: 'main',
        }
      },
    })

    const result = await useReposStore.getState().openRemoteRepo(REMOTE_TARGET)
    await flushRpc()

    expect(result).toEqual({ ok: true, id: REMOTE_TARGET.id })
    expect(useReposStore.getState().order).toEqual([REMOTE_TARGET.id])
    expect(useReposStore.getState().activeId).toBe(REMOTE_TARGET.id)
    expect(useReposStore.getState().repos[REMOTE_TARGET.id]).toMatchObject({
      id: REMOTE_TARGET.id,
      name: 'prod:goblin',
      kind: 'remote',
      remoteTarget: REMOTE_TARGET,
    })
    expect(calls.recent).toEqual([])
    expect(calls.snapshot).toEqual([])
    expect(remoteSnapshots).toEqual([REMOTE_TARGET.id])
    expect(calls.status).toEqual([])
    expect(useReposStore.getState().repos[REMOTE_TARGET.id]?.data.currentBranch).toBe('main')
    expect(useReposStore.getState().repos[REMOTE_TARGET.id]?.data.branches.map((item) => item.name)).toEqual(['main'])
  })

  test('openRemoteRepo activates an existing remote repo without duplicating tab order', async () => {
    installGoblin({ 'remote.testRepository': async () => ({ target: REMOTE_TARGET, ok: true, stages: [] }) })

    await useReposStore.getState().openRemoteRepo(REMOTE_TARGET)
    await useReposStore.getState().openRepo(REPO_A)
    await useReposStore.getState().openRemoteRepo(REMOTE_TARGET)

    expect(useReposStore.getState().order).toEqual([REMOTE_TARGET.id, REPO_A])
    expect(useReposStore.getState().activeId).toBe(REMOTE_TARGET.id)
  })

  test('closeRepo cleans up remote port forwards for remote repos only', async () => {
    const cleanupCalls: string[] = []
    installGoblin({
      'remote.testRepository': async () => ({ target: REMOTE_TARGET, ok: true, stages: [] }),
      'remotePorts.cleanupRepo': ({ target }: { target: RemoteRepoTarget }) => {
        cleanupCalls.push(target.id)
      },
    })

    await useReposStore.getState().openRemoteRepo(REMOTE_TARGET)
    useReposStore.getState().closeRepo(REMOTE_TARGET.id)
    await flushRpc()

    expect(cleanupCalls).toEqual([REMOTE_TARGET.id])

    await useReposStore.getState().openRepo(REPO_A)
    useReposStore.getState().closeRepo(REPO_A)
    await flushRpc()

    expect(cleanupCalls).toEqual([REMOTE_TARGET.id])
  })
})
