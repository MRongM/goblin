import { constants as fsConstants, promises as fs } from 'node:fs'
import path from 'node:path'
import type { ExecResult } from '#/shared/git-types.ts'
import { FILE_TREE_MAX_ENTRIES, type RepoFileTreeEntry, type RepoFileTreeResult } from '#/shared/file-tree.ts'

export function pathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const root = path.resolve(rootPath)
  const candidate = path.resolve(candidatePath)
  return candidate === root || candidate.startsWith(root + path.sep)
}

function classifyFsError(err: unknown): string {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : ''
  if (code === 'ENOENT') return 'error.path-not-found'
  if (code === 'ENOTDIR') return 'error.path-not-directory'
  if (code === 'EACCES' || code === 'EPERM') return 'error.path-permission-denied'
  return 'error.failed-read-repo'
}

function classifyFsWriteError(err: unknown): string {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : ''
  if (code === 'ENOENT') return 'error.path-not-found'
  if (code === 'ENOTDIR') return 'error.path-not-directory'
  if (code === 'EACCES' || code === 'EPERM') return 'error.path-permission-denied'
  if (code === 'EEXIST' || code === 'ENOTEMPTY') return 'error.file-exists'
  return 'error.failed-read-repo'
}

function isAbsolutePathInput(value: string): boolean {
  return value.length > 0 && !value.includes('\0') && path.isAbsolute(value)
}

function isValidFileTreeBasename(value: string): boolean {
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('\0') &&
    !value.includes('/') &&
    !value.includes('\\')
  )
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await fs.access(value, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function relativePath(worktreePath: string, absolutePath: string): string {
  return path.relative(path.resolve(worktreePath), path.resolve(absolutePath)).split(path.sep).join('/')
}

async function symlinkTargetKind(absolutePath: string): Promise<RepoFileTreeEntry['targetKind']> {
  try {
    const stat = await fs.stat(absolutePath)
    if (stat.isDirectory()) return 'directory'
    if (stat.isFile()) return 'file'
    return 'other'
  } catch {
    return 'missing'
  }
}

function sortEntries(entries: RepoFileTreeEntry[]): RepoFileTreeEntry[] {
  return entries.sort((a, b) => {
    const aDirectory = a.kind === 'directory'
    const bDirectory = b.kind === 'directory'
    if (aDirectory !== bDirectory) return aDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

export async function listLocalFileTreeDirectory(
  worktreePath: string,
  dirPath: string,
): Promise<RepoFileTreeResult> {
  if (!worktreePath || !dirPath || worktreePath.includes('\0') || dirPath.includes('\0')) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const root = path.resolve(worktreePath)
  const dir = path.resolve(dirPath)
  if (!pathInsideRoot(root, dir)) return { ok: false, message: 'error.invalid-path' }

  try {
    const stat = await fs.stat(dir)
    if (!stat.isDirectory()) return { ok: false, message: 'error.path-not-directory' }
    const dirents = await fs.readdir(dir, { withFileTypes: true })
    if (dirents.length > FILE_TREE_MAX_ENTRIES) return { ok: false, message: 'error.file-tree-directory-too-large' }
    const entries: RepoFileTreeEntry[] = []
    for (const dirent of dirents) {
      const absolutePath = path.join(dir, dirent.name)
      const kind = dirent.isDirectory() ? 'directory' : dirent.isSymbolicLink() ? 'symlink' : 'file'
      entries.push({
        name: dirent.name,
        absolutePath,
        relativePath: relativePath(root, absolutePath),
        kind,
        ...(kind === 'symlink' ? { targetKind: await symlinkTargetKind(absolutePath) } : {}),
      })
    }
    return { ok: true, worktreePath: root, dirPath: dir, entries: sortEntries(entries) }
  } catch (err) {
    return { ok: false, message: classifyFsError(err) }
  }
}

export async function renameLocalFileTreeEntry(
  worktreePath: string,
  oldPath: string,
  newName: string,
): Promise<ExecResult> {
  if (!isAbsolutePathInput(worktreePath) || !isAbsolutePathInput(oldPath) || !isValidFileTreeBasename(newName)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const root = path.resolve(worktreePath)
  const oldAbsolute = path.resolve(oldPath)
  if (!pathInsideRoot(root, oldAbsolute)) return { ok: false, message: 'error.invalid-path' }
  if (oldAbsolute === root) return { ok: false, message: 'error.delete-root-forbidden' }
  const newAbsolute = path.join(path.dirname(oldAbsolute), newName)
  if (!pathInsideRoot(root, newAbsolute)) return { ok: false, message: 'error.invalid-path' }
  if (await pathExists(newAbsolute)) return { ok: false, message: 'error.file-exists' }
  try {
    await fs.rename(oldAbsolute, newAbsolute)
    return { ok: true, message: '' }
  } catch (err) {
    return { ok: false, message: classifyFsWriteError(err) }
  }
}

export async function deleteLocalFileTreeEntries(
  worktreePath: string,
  paths: string[],
): Promise<ExecResult> {
  if (!isAbsolutePathInput(worktreePath) || paths.length === 0 || paths.some((item) => !isAbsolutePathInput(item))) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const root = path.resolve(worktreePath)
  const targets = paths.map((item) => path.resolve(item))
  for (const target of targets) {
    if (!pathInsideRoot(root, target)) return { ok: false, message: 'error.invalid-path' }
    if (target === root) return { ok: false, message: 'error.delete-root-forbidden' }
  }
  try {
    for (const target of targets) {
      await fs.rm(target, { recursive: true, force: false })
    }
    return { ok: true, message: '' }
  } catch (err) {
    return { ok: false, message: classifyFsWriteError(err) }
  }
}
