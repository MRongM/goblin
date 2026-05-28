import { execa } from 'execa'
import { statSync } from 'node:fs'
import path from 'node:path'
import { buildRemoteTerminalInvocation } from '#/main/ssh/commands.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const OPEN_TIMEOUT_MS = 10_000

function isUsableDirectory(p: string): boolean {
  if (!path.isAbsolute(p) || p.includes('\0')) return false
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Open `dir` in macOS Terminal.app.
 *
 *  `open -a Terminal <dir>` tells macOS to open a new Terminal window
 *  with its working directory set to `dir`. Works whether Terminal is
 *  already running or not — the path is passed as a native argument,
 *  so there are no escaping or injection concerns. */
export async function openInAppleTerminal(p: string): Promise<{ ok: boolean; message: string }> {
  if (!isUsableDirectory(p)) return { ok: false, message: 'error.invalid-path' }

  try {
    await execa('open', ['-a', 'Terminal', p], {
      timeout: OPEN_TIMEOUT_MS,
      forceKillAfterDelay: 500,
    })
    return { ok: true, message: p }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export async function openRemoteInAppleTerminal(
  target: RemoteRepoTarget,
  remotePath: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isUsableRemoteDirectory(remotePath)) return { ok: false, message: 'error.invalid-path' }

  const invocation = buildRemoteTerminalInvocation(target, remotePath, { cols: 80, rows: 24 })
  const commandText = [invocation.command, ...invocation.args].map(shellQuoteArg).join(' ')
  const script = `
    on run argv
      set commandText to item 1 of argv
      tell application "Terminal"
        activate
        do script commandText
      end tell
    end run
  `

  try {
    await execa('/usr/bin/osascript', ['-e', script, commandText], {
      timeout: OPEN_TIMEOUT_MS,
      forceKillAfterDelay: 500,
    })
    return { ok: true, message: remotePath }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

function isUsableRemoteDirectory(p: string): boolean {
  return p.length > 0 && p.length <= 4096 && p.startsWith('/') && !p.includes('\0')
}

function shellQuoteArg(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}
