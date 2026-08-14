import { beforeEach, describe, expect, test, vi } from 'vitest'
import { nativePathForTest } from '#/test-utils/workspace-id.ts'

const REPO_A_PATH = nativePathForTest('/tmp/repo-a')
const REPO_B_PATH = nativePathForTest('/tmp/repo-b')

const mocks = vi.hoisted(() => ({
  broadcastClientEffectIntent: vi.fn(),
}))

vi.mock('#/main/client-surface-events.ts', () => ({
  broadcastClientEffectIntent: mocks.broadcastClientEffectIntent,
}))

describe('external open queue', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  test('queues safe paths once and drains them in order', async () => {
    const { consumeExternalOpenPaths, enqueueExternalOpenPath } = await import('#/main/external-open.ts')

    expect(enqueueExternalOpenPath(REPO_A_PATH)).toBe(true)
    expect(enqueueExternalOpenPath(REPO_A_PATH)).toBe(false)
    expect(enqueueExternalOpenPath(REPO_B_PATH)).toBe(true)
    expect(enqueueExternalOpenPath('')).toBe(false)

    expect(mocks.broadcastClientEffectIntent).toHaveBeenCalledTimes(2)
    expect(consumeExternalOpenPaths()).toEqual([REPO_A_PATH, REPO_B_PATH])
    expect(consumeExternalOpenPaths()).toEqual([])
  })
})
