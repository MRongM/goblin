import { runRemoteCommand, type RemoteCommandKind, type RemoteCommandResult } from '#/main/ssh/commands.ts'
import type { RemoteDirectoryEntry, RemoteDirectoryListing, RemoteRepoTarget } from '#/shared/remote-repo.ts'

const MAX_DIRECTORY_ENTRIES = 200
const DIRECTORY_CLASSIFY_CONCURRENCY = 8

type PathPickerRunner = (
  command: RemoteCommandKind,
  target: RemoteRepoTarget,
  options?: { signal?: AbortSignal },
) => Promise<RemoteCommandResult>

export async function getRemoteHome(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: PathPickerRunner } = {},
): Promise<string> {
  const run: PathPickerRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'printHome' }, target, { signal: options.signal })
  const home = result.stdout.trim()
  return result.ok && isAbsoluteRemotePath(home) ? home : '/'
}

export async function listRemoteDirectory(
  target: RemoteRepoTarget,
  remotePath: string,
  options: { signal?: AbortSignal; run?: PathPickerRunner } = {},
): Promise<RemoteDirectoryListing> {
  if (!isAbsoluteRemotePath(remotePath)) throw new Error('Remote path must be absolute')
  const run: PathPickerRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'listDirectories', path: remotePath, limit: MAX_DIRECTORY_ENTRIES + 1 }, target, {
    signal: options.signal,
  })
  if (!result.ok) {
    return {
      path: remotePath,
      entries: [],
      truncated: false,
      message: result.message || result.stderr || 'Unable to list remote directory',
    }
  }

  const paths = uniqueLines(result.stdout).filter(isAbsoluteRemotePath)
  const truncated = paths.length > MAX_DIRECTORY_ENTRIES
  const entries = await mapWithConcurrency(
    paths.slice(0, MAX_DIRECTORY_ENTRIES),
    DIRECTORY_CLASSIFY_CONCURRENCY,
    (childPath) => classifyDirectory(run, target, childPath, options.signal),
    options.signal,
  )
  return { path: remotePath, entries, truncated }
}

async function classifyDirectory(
  run: PathPickerRunner,
  target: RemoteRepoTarget,
  childPath: string,
  signal?: AbortSignal,
): Promise<RemoteDirectoryEntry> {
  const result = await run({ type: 'revParseTopLevel', path: childPath }, target, { signal })
  if (result.ok) {
    const root = result.stdout.trim()
    return { path: childPath, name: basename(childPath), status: root === childPath ? 'repo' : 'in repo' }
  }
  const message = result.message || result.stderr || 'not a repository'
  if (/permission denied|operation not permitted/i.test(message)) {
    return { path: childPath, name: basename(childPath), status: 'unreadable', message }
  }
  return { path: childPath, name: basename(childPath), status: 'folder' }
}

function uniqueLines(stdout: string): string[] {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || seen.has(line)) continue
    seen.add(line)
    lines.push(line)
  }
  return lines
}

function isAbsoluteRemotePath(value: string): boolean {
  return typeof value === 'string' && value.startsWith('/') && !value.includes('\0')
}

function basename(remotePath: string): string {
  const trimmed = remotePath.replace(/\/+$/, '')
  if (!trimmed || trimmed === '/') return '/'
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async () => {
    while (true) {
      if (signal?.aborted) return
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
