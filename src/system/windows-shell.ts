import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'

const WSL_PROBE_TIMEOUT_MS = 2_000
const WSL_PROBE_MAX_BUFFER_BYTES = 64 * 1_024

export interface ResolvedWindowsTerminalShell {
  kind: 'wsl' | 'powershell'
  command: string
  args: string[]
}

export function resolveWindowsTerminalShell(input: {
  cwd: string
  startupShellCommand?: string
  env?: NodeJS.ProcessEnv
}): ResolvedWindowsTerminalShell {
  const env = input.env ?? process.env
  const wsl = findWslExecutable(env)
  if (wsl && hasInstalledWslDistribution(wsl, env)) {
    const startupArgs = input.startupShellCommand
      ? ['--exec', 'sh', '-lc', `${input.startupShellCommand}\nexec "\${SHELL:-/bin/sh}" -l`]
      : []
    return {
      kind: 'wsl',
      command: wsl,
      args: [...wslWorkingDirectoryArgs(input.cwd), ...startupArgs],
    }
  }

  const powershell = findPowerShellExecutable(env)
  return {
    kind: 'powershell',
    command: powershell,
    args: input.startupShellCommand ? ['-NoLogo', '-NoExit', '-Command', input.startupShellCommand] : ['-NoLogo'],
  }
}

function findWslExecutable(env: NodeJS.ProcessEnv): string | null {
  const systemRoot = windowsSystemRoot(env)
  return firstExistingFile([
    ...windowsPathCandidates('wsl.exe', env),
    ...(systemRoot ? [path.join(systemRoot, 'System32', 'wsl.exe')] : []),
  ])
}

function findPowerShellExecutable(env: NodeJS.ProcessEnv): string {
  const pwsh = firstExistingFile(windowsPathCandidates('pwsh.exe', env))
  if (pwsh) return pwsh

  const systemRoot = windowsSystemRoot(env)
  const windowsPowerShell = firstExistingFile([
    ...(systemRoot ? [path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')] : []),
    ...windowsPathCandidates('powershell.exe', env),
  ])
  return windowsPowerShell ?? 'powershell.exe'
}

function windowsSystemRoot(env: NodeJS.ProcessEnv): string | undefined {
  return env.SystemRoot ?? env.SYSTEMROOT ?? env.WINDIR ?? env.windir
}

function windowsPathCandidates(name: string, env: NodeJS.ProcessEnv): string[] {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? ''
  return pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/u, '$1'))
    .filter((entry) => entry.length > 0)
    .map((entry) => path.join(entry, name))
}

function firstExistingFile(candidates: readonly string[]): string | null {
  return candidates.find(isFile) ?? null
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

function hasInstalledWslDistribution(wsl: string, env: NodeJS.ProcessEnv): boolean {
  try {
    const result = spawnSync(wsl, ['--list', '--quiet'], {
      encoding: 'utf8',
      env,
      maxBuffer: WSL_PROBE_MAX_BUFFER_BYTES,
      timeout: WSL_PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    return result.status === 0 && result.stdout.replaceAll('\0', '').trim().length > 0
  } catch {
    return false
  }
}

function wslWorkingDirectoryArgs(cwd: string): string[] {
  const normalized = cwd.replaceAll('\\', '/')
  const wslUncTarget = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/.*)?$/iu.exec(normalized)
  if (!wslUncTarget) return ['--cd', cwd]

  const distribution = wslUncTarget[1]
  if (!distribution) return ['--cd', cwd]
  const linuxPath = wslUncTarget[2] || '/'
  return ['--distribution', distribution, '--cd', linuxPath]
}
