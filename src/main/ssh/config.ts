import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import {
  normalizeRemoteTarget,
  type RemoteConnectionInput,
  type ResolvedRemoteTarget,
  type SshConfigHost,
} from '#/shared/remote-repo.ts'

const SSH_CONFIG_PATH = path.join(os.homedir(), '.ssh', 'config')
const SSH_G_TIMEOUT_MS = 10_000

export async function listSshConfigHosts(configPath: string = SSH_CONFIG_PATH): Promise<SshConfigHost[]> {
  try {
    return parseSshConfigHosts(await fs.readFile(configPath, 'utf-8'))
  } catch {
    return []
  }
}

export function parseSshConfigHosts(content: string): SshConfigHost[] {
  const hosts: SshConfigHost[] = []
  const seen = new Set<string>()
  let current: SshConfigHost[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim()
    if (!line) continue
    const [rawKey, ...parts] = line.split(/\s+/)
    const key = rawKey?.toLowerCase()
    if (key === 'host') {
      current = parts
        .filter((alias) => isConcreteAlias(alias) && !seen.has(alias))
        .map((alias) => {
          seen.add(alias)
          const host = { alias }
          hosts.push(host)
          return host
        })
      continue
    }
    if (current.length === 0) continue
    const value = parts.join(' ')
    if (!value) continue
    for (const host of current) {
      if (key === 'hostname') host.hostName = value
      else if (key === 'user') host.user = value
      else if (key === 'port') {
        const port = Number(value)
        if (Number.isInteger(port) && port >= 1 && port <= 65535) host.port = port
      }
    }
  }
  return hosts
}

export async function resolveRemoteTarget(
  input: RemoteConnectionInput,
  signal?: AbortSignal,
): Promise<ResolvedRemoteTarget> {
  if (input.mode === 'config') {
    const alias = input.alias.trim()
    if (!isConcreteAlias(alias)) throw new Error('Invalid SSH config host alias')
    const effective = await resolveEffectiveConfig(alias, signal)
    return toResolvedTarget({
      alias,
      host: effective.hostname ?? alias,
      user: effective.user ?? os.userInfo().username,
      port: effective.port ?? 22,
      remotePath: input.remotePath,
      identityFile: input.identityFile,
    })
  }
  return toResolvedTarget({
    alias: null,
    host: input.host,
    user: input.user,
    port: input.port ?? 22,
    remotePath: input.remotePath,
    identityFile: input.identityFile,
  })
}

interface EffectiveSshConfig {
  hostname?: string
  user?: string
  port?: number
}

async function resolveEffectiveConfig(alias: string, signal?: AbortSignal): Promise<EffectiveSshConfig> {
  const { stdout } = await execa('ssh', ['-G', alias], {
    timeout: SSH_G_TIMEOUT_MS,
    cancelSignal: signal,
    forceKillAfterDelay: 500,
    maxBuffer: 1024 * 1024,
  })
  const parsed: EffectiveSshConfig = {}
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const firstSpace = line.search(/\s/)
    const key = (firstSpace === -1 ? line : line.slice(0, firstSpace)).toLowerCase()
    const value = firstSpace === -1 ? '' : line.slice(firstSpace + 1).trim()
    if (key === 'hostname' || key === 'user') parsed[key] = value
    if (key === 'port') {
      const port = Number(value)
      if (Number.isInteger(port) && port >= 1 && port <= 65535) parsed.port = port
    }
  }
  return parsed
}

function toResolvedTarget(input: {
  alias: string | null
  host: string
  user: string
  port: number
  remotePath: string
  identityFile?: string
}): ResolvedRemoteTarget {
  const target = normalizeRemoteTarget(input)
  if (!target) throw new Error('Invalid remote repository target')
  return { target }
}

function isConcreteAlias(alias: string): boolean {
  return alias.length > 0 && !alias.includes('\0') && !alias.startsWith('!') && !/[?*]/.test(alias)
}

function stripComment(line: string): string {
  const index = line.indexOf('#')
  return index === -1 ? line : line.slice(0, index)
}
