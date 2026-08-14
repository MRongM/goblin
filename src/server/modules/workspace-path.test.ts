import { describe, expect, test } from 'vitest'
import { localWorkspaceNativePath, resolveWorkspaceScopedPath } from '#/server/modules/workspace-path.ts'
import { localWorkspaceIdForTest, nativePathForTest } from '#/test-utils/workspace-id.ts'

describe('workspace native execution paths', () => {
  test('decodes a canonical local workspace only at the execution boundary', () => {
    const workspaceId = localWorkspaceIdForTest('/repo')
    const workspacePath = nativePathForTest('/repo')

    expect(localWorkspaceNativePath(workspaceId)).toBe(workspacePath)
    expect(resolveWorkspaceScopedPath(workspaceId, workspaceId)).toBe(workspacePath)
  })

  test('does not turn remote, malformed, or non-workspace targets into local paths', () => {
    expect(localWorkspaceNativePath('goblin+ssh://prod/srv/repo')).toBeNull()
    expect(localWorkspaceNativePath('/legacy/native/path')).toBeNull()
    expect(resolveWorkspaceScopedPath(localWorkspaceIdForTest('/repo'), '/repo')).toBeNull()
  })

  test('decodes an SSH workspace at its remote execution boundary', () => {
    const workspaceId = 'goblin+ssh://prod/srv/repo'
    expect(resolveWorkspaceScopedPath(workspaceId, workspaceId)).toBe('/srv/repo')
  })
})
