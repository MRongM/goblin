import { constants as fsConstants, promises as fs } from 'node:fs'
import path from 'node:path'
import {
  FILE_TRANSFER_MAX_FILE_BYTES,
  FILE_TRANSFER_MAX_TOTAL_BYTES,
  type RepoFileTransferCopiedEntry,
  type RepoFileTransferFailedEntry,
  type RepoFileTransferRenamedEntry,
  type RepoFileTransferResult,
  type RepoFileTransferUploadedItem,
} from '#/shared/file-tree.ts'
import { pathInsideRoot } from '#/system/file-tree/local.ts'

export interface LocalInventoryOptions {
  rootPath: string
  paths: string[]
}

export interface LocalCopyOptions {
  sourceRootPath: string
  targetRootPath: string
  targetDirPath: string
  paths: string[]
}

export interface LocalUploadOptions {
  targetRootPath: string
  targetDirPath: string
  items: RepoFileTransferUploadedItem[]
}

export interface LocalInventoryEntry {
  sourcePath: string
  relativePath: string
  kind: 'file' | 'directory' | 'symlink'
  size: number
}

export type LocalInventoryResult =
  | { ok: true; entries: LocalInventoryEntry[]; totalBytes: number }
  | { ok: false; message: string }

export function uniqueCopyName(existingNames: Set<string>, requestedName: string): string {
  if (!existingNames.has(requestedName)) return requestedName
  const dot = requestedName.lastIndexOf('.')
  const hasExtension = dot > 0
  const base = hasExtension ? requestedName.slice(0, dot) : requestedName
  const extension = hasExtension ? requestedName.slice(dot) : ''
  let index = 1
  while (true) {
    const suffix = index === 1 ? ' copy' : ` copy ${index}`
    const candidate = `${base}${suffix}${extension}`
    if (!existingNames.has(candidate)) return candidate
    index += 1
  }
}

export function commonAbsolutePathAncestor(paths: string[]): string {
  const resolved = paths.map((value) => path.resolve(value))
  if (resolved.length === 0) return ''
  const split = resolved.map((value) => value.split(path.sep).filter(Boolean))
  const first = split[0] ?? []
  const parts: string[] = []
  for (let i = 0; i < first.length; i += 1) {
    if (split.every((candidate) => candidate[i] === first[i])) parts.push(first[i])
    else break
  }
  const prefix = path.parse(resolved[0] ?? '').root
  return parts.length === 0 ? prefix : path.join(prefix, ...parts)
}

export function decodeUploadedItem(item: Pick<RepoFileTransferUploadedItem, 'bytesBase64' | 'byteLength'>): Buffer | null {
  const buffer = Buffer.from(item.bytesBase64, 'base64')
  return buffer.byteLength === item.byteLength ? buffer : null
}

export async function inventoryLocalTransfer(options: LocalInventoryOptions): Promise<LocalInventoryResult> {
  const root = path.resolve(options.rootPath)
  const entries: LocalInventoryEntry[] = []
  let totalBytes = 0
  for (const inputPath of options.paths) {
    const sourcePath = path.resolve(inputPath)
    if (!pathInsideRoot(root, sourcePath)) return { ok: false, message: 'error.file-transfer-source-outside-worktree' }
    const result = await inventoryOne(root, sourcePath)
    if (!result.ok) return result
    for (const entry of result.entries) {
      if (entry.kind === 'file' && entry.size > FILE_TRANSFER_MAX_FILE_BYTES) {
        return { ok: false, message: 'error.file-transfer-file-too-large' }
      }
      totalBytes += entry.size
      if (totalBytes > FILE_TRANSFER_MAX_TOTAL_BYTES) {
        return { ok: false, message: 'error.file-transfer-total-too-large' }
      }
      entries.push(entry)
    }
  }
  return { ok: true, entries, totalBytes }
}

export async function copyLocalPathsToLocalTarget(options: LocalCopyOptions): Promise<RepoFileTransferResult> {
  const targetRoot = path.resolve(options.targetRootPath)
  const targetDir = path.resolve(options.targetDirPath)
  if (!pathInsideRoot(targetRoot, targetDir)) return { ok: false, message: 'error.file-transfer-target-outside-worktree' }
  const inventory = await inventoryLocalTransfer({ rootPath: options.sourceRootPath, paths: options.paths })
  if (!inventory.ok) return inventory
  await fs.mkdir(targetDir, { recursive: true })
  const existingNames = new Set(await fs.readdir(targetDir).catch(() => []))
  const copied: RepoFileTransferCopiedEntry[] = []
  const renamed: RepoFileTransferRenamedEntry[] = []
  const failed: RepoFileTransferFailedEntry[] = []
  for (const sourcePath of options.paths) {
    const name = path.basename(sourcePath)
    const destinationName = uniqueCopyName(existingNames, name)
    existingNames.add(destinationName)
    const destinationPath = path.join(targetDir, destinationName)
    if (destinationName !== name) renamed.push({ requestedName: name, destinationName, destinationPath })
    try {
      await copyPath(sourcePath, destinationPath)
      copied.push({ sourcePath, destinationPath, kind: (await kindOf(sourcePath)) ?? 'file' })
    } catch {
      failed.push({ sourcePath, message: 'error.failed-read-repo' })
    }
  }
  return { ok: true, copied, renamed, failed }
}

export async function writeUploadedItemsToLocalTarget(options: LocalUploadOptions): Promise<RepoFileTransferResult> {
  const targetRoot = path.resolve(options.targetRootPath)
  const targetDir = path.resolve(options.targetDirPath)
  if (!pathInsideRoot(targetRoot, targetDir)) return { ok: false, message: 'error.file-transfer-target-outside-worktree' }
  let totalBytes = 0
  for (const item of options.items) {
    if (item.byteLength > FILE_TRANSFER_MAX_FILE_BYTES) return { ok: false, message: 'error.file-transfer-file-too-large' }
    totalBytes += item.byteLength
    if (totalBytes > FILE_TRANSFER_MAX_TOTAL_BYTES) return { ok: false, message: 'error.file-transfer-total-too-large' }
  }
  await fs.mkdir(targetDir, { recursive: true })
  const existingNames = new Set(await fs.readdir(targetDir).catch(() => []))
  const copied: RepoFileTransferCopiedEntry[] = []
  const renamed: RepoFileTransferRenamedEntry[] = []
  const failed: RepoFileTransferFailedEntry[] = []
  for (const item of options.items) {
    const bytes = decodeUploadedItem(item)
    if (!bytes) {
      failed.push({ name: item.name, message: 'error.invalid-arguments' })
      continue
    }
    const destinationName = uniqueCopyName(existingNames, item.name)
    existingNames.add(destinationName)
    const destinationPath = path.join(targetDir, destinationName)
    if (destinationName !== item.name) renamed.push({ requestedName: item.name, destinationName, destinationPath })
    await fs.writeFile(destinationPath, bytes)
    copied.push({ destinationPath, kind: 'file' })
  }
  return { ok: true, copied, renamed, failed }
}

async function inventoryOne(root: string, sourcePath: string): Promise<LocalInventoryResult> {
  const stat = await fs.lstat(sourcePath).catch(() => null)
  if (!stat) return { ok: false, message: 'error.path-not-found' }
  const relativePath = path.relative(root, sourcePath)
  if (stat.isSymbolicLink()) return { ok: true, entries: [{ sourcePath, relativePath, kind: 'symlink', size: 0 }], totalBytes: 0 }
  if (stat.isFile()) return { ok: true, entries: [{ sourcePath, relativePath, kind: 'file', size: stat.size }], totalBytes: stat.size }
  if (!stat.isDirectory()) return { ok: false, message: 'error.invalid-path' }
  const children = await fs.readdir(sourcePath)
  const entries: LocalInventoryEntry[] = [{ sourcePath, relativePath, kind: 'directory', size: 0 }]
  let totalBytes = 0
  for (const child of children) {
    const result = await inventoryOne(root, path.join(sourcePath, child))
    if (!result.ok) return result
    entries.push(...result.entries)
    totalBytes += result.totalBytes
  }
  return { ok: true, entries, totalBytes }
}

async function copyPath(sourcePath: string, destinationPath: string): Promise<void> {
  const stat = await fs.lstat(sourcePath)
  if (stat.isSymbolicLink()) {
    const target = await fs.readlink(sourcePath)
    await fs.symlink(target, destinationPath)
    return
  }
  if (stat.isDirectory()) {
    await fs.mkdir(destinationPath, { recursive: true })
    const children = await fs.readdir(sourcePath)
    for (const child of children) await copyPath(path.join(sourcePath, child), path.join(destinationPath, child))
    return
  }
  await fs.copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL)
}

async function kindOf(sourcePath: string): Promise<'file' | 'directory' | 'symlink' | null> {
  const stat = await fs.lstat(sourcePath).catch(() => null)
  if (!stat) return null
  if (stat.isDirectory()) return 'directory'
  if (stat.isSymbolicLink()) return 'symlink'
  return 'file'
}
