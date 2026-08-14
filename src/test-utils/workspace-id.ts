import {
  canonicalWorkspaceLocator,
  formatWorkspaceLocator,
  type WorkspaceId,
  type WorkspaceLocatorPlatform,
} from '#/shared/workspace-locator.ts'

export function workspaceIdForTest(value: string): WorkspaceId {
  const workspaceId = canonicalWorkspaceLocator(value)
  if (!workspaceId) throw new Error(`invalid test workspace id: ${value}`)
  return workspaceId
}

/** Map a privacy-safe POSIX fixture name onto the current host's native path grammar. */
export function nativePathForTest(posixPath: string): string {
  if (!posixPath.startsWith('/') || posixPath.includes('\\')) {
    throw new Error(`invalid POSIX test path: ${posixPath}`)
  }
  return process.platform === 'win32' ? `C:${posixPath.replaceAll('/', '\\')}` : posixPath
}

/** Build a file workspace locator accepted by the current native execution boundary. */
export function localWorkspaceIdForTest(posixPath: string): WorkspaceId {
  const platform: WorkspaceLocatorPlatform = process.platform === 'win32' ? 'win32' : 'posix'
  const path = nativePathForTest(posixPath)
  const workspaceId = formatWorkspaceLocator({ transport: 'file', platform, path }, platform)
  if (!workspaceId) throw new Error(`invalid local test workspace path: ${posixPath}`)
  return workspaceId
}
