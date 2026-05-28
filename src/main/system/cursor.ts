import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { hasAppCli, openByAppCli, openRemoteByAppCli } from '#/main/system/open-app.ts'

const APP_NAME = 'Cursor'
const CLI_NAME = 'cursor'

export function isCursorInstalled(): boolean {
  return hasAppCli(APP_NAME, CLI_NAME)
}

export function openInCursor(p: string): Promise<{ ok: boolean; message: string }> {
  return openByAppCli(APP_NAME, CLI_NAME, p)
}

export function openRemoteInCursor(target: RemoteRepoTarget, p: string): Promise<{ ok: boolean; message: string }> {
  return openRemoteByAppCli(APP_NAME, CLI_NAME, target, p)
}
