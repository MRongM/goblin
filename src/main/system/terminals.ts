// Terminal backend registry. Each terminal app implements TerminalBackend
// and registers itself here. The resolver picks the right one based on
// the user's TerminalPref setting.
//
// Adding a new terminal:
// 1. Create src/main/system/<name>.ts implementing TerminalBackend
// 2. Register it in the `backends` map below
// 3. Add the new id to TerminalPref in shared/rpc.ts
// 4. Add i18n keys for the settings picker

import type { ResolvedTerminalApp, TerminalAppAvailability, TerminalPref } from '#/shared/rpc.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { isGhosttyInstalled, openInGhostty, openRemoteInGhostty } from '#/main/system/ghostty.ts'
import { isAppleTerminalInstalled, openInAppleTerminal, openRemoteInAppleTerminal } from '#/main/system/apple-terminal.ts'

export interface TerminalBackend {
  /** Whether this terminal is available on the current system.
   *  Sync — backed by file-existence checks that are cheap on macOS.
   *  If a future backend needs async detection (e.g. mdfind), resolve
   *  it at registration time and cache the result. */
  isInstalled: () => boolean
  /** Open a directory in this terminal. */
  open: (path: string) => Promise<{ ok: boolean; message: string }>
  /** Open an SSH session in this terminal. */
  openRemote?: (target: RemoteRepoTarget, path: string) => Promise<{ ok: boolean; message: string }>
}

/** Concrete terminal pref values (excludes 'auto'). */
const backends: Record<ResolvedTerminalApp, TerminalBackend> = {
  ghostty: { isInstalled: isGhosttyInstalled, open: openInGhostty, openRemote: openRemoteInGhostty },
  terminal: { isInstalled: () => true, open: openInAppleTerminal, openRemote: openRemoteInAppleTerminal },
}

/** Auto-detection priority — first installed backend wins. */
const AUTO_PRIORITY: ResolvedTerminalApp[] = ['ghostty', 'terminal']

export function resolveTerminalApp(pref: TerminalPref, availability: TerminalAppAvailability): ResolvedTerminalApp | null {
  if (pref !== 'auto') {
    return availability[pref] ? pref : null
  }
  for (const id of AUTO_PRIORITY) {
    if (availability[id]) return id
  }
  return null
}

export function getTerminalActionAvailability(): TerminalAppAvailability {
  return {
    ghostty: backends.ghostty.isInstalled(),
    terminal: true,
  }
}

/** Open `path` in the terminal selected by `pref`. */
export async function openInPreferredTerminal(path: string, pref: TerminalPref): Promise<{ ok: boolean; message: string }> {
  const resolved = resolveTerminalApp(pref, getTerminalActionAvailability())
  return resolved
    ? backends[resolved].open(path)
    : Promise.resolve({ ok: false, message: 'error.terminal-not-installed' })
}

export function openRemoteInPreferredTerminal(
  target: RemoteRepoTarget,
  path: string,
  pref: TerminalPref,
): Promise<{ ok: boolean; message: string }> {
  const resolved = resolveTerminalApp(pref, getTerminalActionAvailability())
  if (!resolved) return Promise.resolve({ ok: false, message: 'error.terminal-not-installed' })
  const opener = backends[resolved].openRemote
  return opener ? opener(target, path) : Promise.resolve({ ok: false, message: 'error.remote-terminal-unavailable' })
}

export async function getResolvedTerminalApp(pref: TerminalPref): Promise<ResolvedTerminalApp | null> {
  return resolveTerminalApp(pref, getTerminalActionAvailability())
}

export async function getTerminalAppAvailability(signal?: AbortSignal): Promise<TerminalAppAvailability> {
  return {
    ghostty: backends.ghostty.isInstalled(),
    terminal: await isAppleTerminalInstalled(signal),
  }
}
