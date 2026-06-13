import { createHash } from 'node:crypto'

export interface RemoteTerminalEndpoint {
  user: string
  host: string
  port: number
}

export interface ManagedRemoteTerminalTarget {
  alias: string
  endpoint: RemoteTerminalEndpoint
  repoPath: string
  worktreePath: string
  terminalNumber: number
}

export interface ExternalRemoteTerminalTarget {
  alias: string
  worktreePath: string
}

export interface RemoteTerminalInvocation {
  command: 'ssh'
  args: string[]
  script: string
  shellCommand: string
}

export function buildManagedRemoteTerminalSessionName(target: ManagedRemoteTerminalTarget): string {
  const endpoint = remoteEndpointIdentity(target.endpoint)
  const digest = createHash('sha256')
    .update(endpoint)
    .update('\0')
    .update(target.repoPath)
    .update('\0')
    .update(target.worktreePath)
    .update('\0')
    .update(String(target.terminalNumber))
    .digest('hex')
    .slice(0, 24)
  return `goblin-${digest}`
}

export function buildManagedRemoteTerminalInvocation(
  target: ManagedRemoteTerminalTarget,
): RemoteTerminalInvocation | null {
  if (
    !isSafeRemoteAlias(target.alias) ||
    !isSafeRemoteEndpoint(target.endpoint) ||
    !isSafeRemoteAbsolutePath(target.repoPath) ||
    !isSafeRemoteAbsolutePath(target.worktreePath) ||
    !isSafeTerminalNumber(target.terminalNumber)
  ) {
    return null
  }

  const sessionName = buildManagedRemoteTerminalSessionName(target)
  const script = [
    `cd ${shellQuote(target.worktreePath)} || exit`,
    'if command -v tmux >/dev/null 2>&1; then',
    `  exec tmux new-session -A -s ${shellQuote(sessionName)} -c ${shellQuote(target.worktreePath)}`,
    'fi',
    'exec "${SHELL:-/bin/sh}" -l',
  ].join('\n')
  return buildSshInvocation(target.alias, script)
}

export function buildExternalRemoteTerminalInvocation(
  target: ExternalRemoteTerminalTarget,
): RemoteTerminalInvocation | null {
  if (!isSafeRemoteAlias(target.alias) || !isSafeRemoteAbsolutePath(target.worktreePath)) return null

  const script = [
    `cd ${shellQuote(target.worktreePath)} || exit`,
    'exec "${SHELL:-/bin/sh}" -l',
  ].join('\n')
  return buildSshInvocation(target.alias, script)
}

function buildSshInvocation(alias: string, script: string): RemoteTerminalInvocation {
  const remoteCommand = `sh -lc ${shellQuote(script)}`
  const args = ['-tt', '--', alias, remoteCommand]
  return {
    command: 'ssh',
    args,
    script,
    shellCommand: ['ssh', ...args].map(shellQuote).join(' '),
  }
}

function remoteEndpointIdentity(endpoint: RemoteTerminalEndpoint): string {
  return `${endpoint.user}@${endpoint.host}:${endpoint.port}`
}

function isSafeRemoteEndpoint(endpoint: RemoteTerminalEndpoint): boolean {
  return (
    isSafeEndpointPart(endpoint.user) &&
    isSafeEndpointPart(endpoint.host) &&
    Number.isInteger(endpoint.port) &&
    endpoint.port >= 1 &&
    endpoint.port <= 65535
  )
}

function isSafeEndpointPart(value: string): boolean {
  return value.length > 0 && value.length <= 255 && !/[\0-\x1f\x7f]/.test(value)
}

function isSafeTerminalNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1
}

function isSafeRemoteAlias(alias: string): boolean {
  return alias.length > 0 && alias.length <= 255 && !/[\s\0/?#\\]/.test(alias)
}

function isSafeRemoteAbsolutePath(remotePath: string): boolean {
  return (
    remotePath.length > 0 &&
    remotePath.length <= 4096 &&
    remotePath.startsWith('/') &&
    !/[\0-\x1f\x7f]/.test(remotePath)
  )
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
