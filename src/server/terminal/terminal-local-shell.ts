import { userInfo } from 'node:os'
import { resolveWindowsTerminalShell } from '#/system/windows-shell.ts'

export interface ResolvedLocalShell {
  command: string
  args: string[]
}

/**
 * Pick the right login shell for a local (non-SSH) terminal.
 *
 * Resolution order on Unix:
 *  1. Caller-supplied `input.command` wins (explicit override).
 *  2. `env.SHELL` — the user-facing Electron desktop launches inherit
 *     this from launchd / the user's login session, so it's correct on macOS
 *     and Linux desktops.
 *  3. `os.userInfo().shell` — Node reads `getpwuid_r(getuid())->pw_shell` for
 *     us. This catches CI, devcontainer, and other containerised contexts
 *     where the inherited `SHELL` points at the container base shell (often
 *     `/bin/sh`) rather than the user's actual login shell.
 *  4. `/bin/sh` — last-resort POSIX guarantee; `-l` keeps the shell in login
 *     mode so it sources the user's profile.
 *
 * On Windows the shared platform adapter prefers an installed default WSL
 * distribution, then PowerShell. The adapter owns Windows executable probing,
 * working-directory translation, and startup-command argv.
 *
 * Pure platform policy — no node-pty dependency — so this lives in its own
 * file rather than inside terminal-pty-runtime.
 */
export function resolveLocalShell(
  input: { command?: string; args?: string[]; cwd: string },
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLocalShell {
  const explicit = input.command?.trim()
  if (explicit) return { command: explicit, args: input.args ?? [] }
  if (process.platform === 'win32') {
    return resolveWindowsTerminalShell({ cwd: input.cwd, env })
  }
  const fromEnv = env.SHELL?.trim()
  if (fromEnv) return { command: fromEnv, args: input.args ?? ['-l'] }
  const fromUserInfo = readUserLoginShell()
  if (fromUserInfo) return { command: fromUserInfo, args: input.args ?? ['-l'] }
  return { command: '/bin/sh', args: input.args ?? ['-l'] }
}

export function resolveLocalShellWithStartupShellCommand(
  startupShellCommand: string | undefined,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLocalShell {
  const commandLine = normalizeStartupShellCommand(startupShellCommand)
  if (!commandLine) return resolveLocalShell({ cwd }, env)
  if (process.platform === 'win32') {
    return resolveWindowsTerminalShell({ cwd, env, startupShellCommand: commandLine })
  }
  const shell = resolveLocalShell({ cwd }, env).command
  // The PTY is spawned only after the mounted client xterm has fitted its host,
  // so width-sensitive startup output begins at canonical geometry.
  return { command: shell, args: ['-ilc', `${commandLine}\nexec ${quotePosixShellArg(shell)} -l`] }
}

function normalizeStartupShellCommand(command: string | undefined): string {
  const withoutTrailingNewline = (command ?? '').replace(/[\r\n]+$/u, '')
  return withoutTrailingNewline.trim().length === 0 ? '' : withoutTrailingNewline
}

function quotePosixShellArg(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`
}

function readUserLoginShell(): string | null {
  try {
    const shell = userInfo().shell
    const trimmed = typeof shell === 'string' ? shell.trim() : ''
    return trimmed || null
  } catch {
    return null
  }
}
