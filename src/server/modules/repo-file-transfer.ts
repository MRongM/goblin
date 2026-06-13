import { promises as fs } from 'node:fs'
import path from 'node:path'
import { publishRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import { resolveRemoteRepoTarget } from '#/server/modules/repo-backend.ts'
import {
  FILE_TRANSFER_MAX_FILE_BYTES,
  FILE_TRANSFER_MAX_TOTAL_BYTES,
  isRepoFileTransferRequest,
  type RepoFileTransferCopiedEntry,
  type RepoFileTransferFailedEntry,
  type RepoFileTransferRequest,
  type RepoFileTransferRenamedEntry,
  type RepoFileTransferResult,
  type RepoFileTransferUploadedItem,
} from '#/shared/file-tree.ts'
import { isRemoteRepoId } from '#/shared/rpc.ts'
import {
  commonAbsolutePathAncestor,
  copyLocalPathsToLocalTarget,
  decodeUploadedItem,
  inventoryLocalTransfer,
  uniqueCopyName,
  writeUploadedItemsToLocalTarget,
} from '#/system/file-tree/transfer.ts'
import {
  createRemoteDirectory,
  createRemoteSymlink,
  inventoryRemoteFileTransfer,
  listRemoteFileTreeDirectory,
  readRemoteFileBase64,
  writeRemoteFileBase64,
  type RemoteTransferInventoryEntry,
} from '#/system/ssh/git.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

export async function transferRepositoryFiles(input: unknown): Promise<RepoFileTransferResult> {
  if (!isRepoFileTransferRequest(input)) return { ok: false, message: 'error.invalid-arguments' }
  const result = isRemoteRepoId(input.repoId)
    ? await transferRemoteTarget(input)
    : await transferLocalTarget(input)
  if (result.ok && result.copied.length > 0) {
    publishRepoQueryInvalidation({ repoId: input.repoId, query: 'repo-snapshot' })
  }
  return result
}

async function transferLocalTarget(input: RepoFileTransferRequest): Promise<RepoFileTransferResult> {
  switch (input.source.kind) {
    case 'fileTreePaths':
      if (isRemoteRepoId(input.source.repoId)) return { ok: false, message: 'error.file-transfer-remote-unsupported' }
      return await copyLocalPathsToLocalTarget({
        sourceRootPath: input.source.worktreePath,
        targetRootPath: input.worktreePath,
        targetDirPath: input.targetDirPath,
        paths: input.source.paths,
      })
    case 'localPaths':
      return await copyLocalPathsToLocalTarget({
        sourceRootPath: commonAbsolutePathAncestor(input.source.paths),
        targetRootPath: input.worktreePath,
        targetDirPath: input.targetDirPath,
        paths: input.source.paths,
      })
    case 'uploadedItems':
      return await writeUploadedItemsToLocalTarget({
        targetRootPath: input.worktreePath,
        targetDirPath: input.targetDirPath,
        items: input.source.items,
      })
  }
}

async function transferRemoteTarget(input: RepoFileTransferRequest): Promise<RepoFileTransferResult> {
  if (!remotePathInsideRoot(input.worktreePath, input.targetDirPath)) {
    return { ok: false, message: 'error.file-transfer-target-outside-worktree' }
  }
  const target = await resolveRemoteRepoTarget(input.repoId)
  const prepared = await prepareRemoteTargetDirectory(target, input.worktreePath, input.targetDirPath)
  if ('ok' in prepared) return prepared

  switch (input.source.kind) {
    case 'fileTreePaths':
      if (isRemoteRepoId(input.source.repoId)) {
        return await copyRemoteFileTreeToRemoteTarget(target, input.targetDirPath, prepared.existingNames, input.source)
      }
      return await copyLocalPathsToRemoteTarget(
        target,
        input.targetDirPath,
        prepared.existingNames,
        input.source.worktreePath,
        input.source.paths,
      )
    case 'localPaths':
      return await copyLocalPathsToRemoteTarget(
        target,
        input.targetDirPath,
        prepared.existingNames,
        commonAbsolutePathAncestor(input.source.paths),
        input.source.paths,
      )
    case 'uploadedItems':
      return await writeUploadedItemsToRemoteTarget(target, input.targetDirPath, prepared.existingNames, input.source.items)
  }
}

async function prepareRemoteTargetDirectory(
  target: RemoteRepoTarget,
  worktreePath: string,
  targetDirPath: string,
): Promise<{ existingNames: Set<string> } | RepoFileTransferResult> {
  const created = await createRemoteDirectory(target, targetDirPath)
  if (!created.ok) return { ok: false, message: created.message }
  const listed = await listRemoteFileTreeDirectory(target, worktreePath, targetDirPath)
  if (!listed.ok) return { ok: false, message: listed.message }
  return { existingNames: new Set(listed.entries.map((entry) => entry.name)) }
}

async function writeUploadedItemsToRemoteTarget(
  target: RemoteRepoTarget,
  targetDirPath: string,
  existingNames: Set<string>,
  items: RepoFileTransferUploadedItem[],
): Promise<RepoFileTransferResult> {
  const validation = validateUploadedItemSizes(items)
  if (validation) return validation
  const copied: RepoFileTransferCopiedEntry[] = []
  const renamed: RepoFileTransferRenamedEntry[] = []
  const failed: RepoFileTransferFailedEntry[] = []
  for (const item of items) {
    const bytes = decodeUploadedItem(item)
    if (!bytes) {
      failed.push({ name: item.name, message: 'error.invalid-arguments' })
      continue
    }
    const destinationName = uniqueCopyName(existingNames, item.name)
    existingNames.add(destinationName)
    const destinationPath = path.posix.join(targetDirPath, destinationName)
    if (destinationName !== item.name) renamed.push({ requestedName: item.name, destinationName, destinationPath })
    const result = await writeRemoteFileBase64(target, destinationPath, bytes.toString('base64'))
    if (result.ok) copied.push({ destinationPath, kind: 'file' })
    else failed.push({ name: item.name, message: result.message })
  }
  return { ok: true, copied, renamed, failed }
}

async function copyLocalPathsToRemoteTarget(
  target: RemoteRepoTarget,
  targetDirPath: string,
  existingNames: Set<string>,
  sourceRootPath: string,
  paths: string[],
): Promise<RepoFileTransferResult> {
  const inventory = await inventoryLocalTransfer({ rootPath: sourceRootPath, paths })
  if (!inventory.ok) return inventory
  const copied: RepoFileTransferCopiedEntry[] = []
  const renamed: RepoFileTransferRenamedEntry[] = []
  const failed: RepoFileTransferFailedEntry[] = []
  for (const sourcePath of paths) {
    const requestedName = path.basename(sourcePath)
    const destinationName = uniqueCopyName(existingNames, requestedName)
    existingNames.add(destinationName)
    const destinationPath = path.posix.join(targetDirPath, destinationName)
    if (destinationName !== requestedName) renamed.push({ requestedName, destinationName, destinationPath })
    const result = await copyLocalPathToRemote(target, sourcePath, destinationPath)
    if (result.ok) {
      copied.push({ sourcePath, destinationPath, kind: (await localTransferKind(sourcePath)) ?? 'file' })
    } else {
      failed.push({ sourcePath, message: result.message })
    }
  }
  return { ok: true, copied, renamed, failed }
}

async function copyRemoteFileTreeToRemoteTarget(
  target: RemoteRepoTarget,
  targetDirPath: string,
  existingNames: Set<string>,
  source: Extract<RepoFileTransferRequest['source'], { kind: 'fileTreePaths' }>,
): Promise<RepoFileTransferResult> {
  const sourceTarget = await resolveRemoteRepoTarget(source.repoId)
  const inventory = await inventoryRemoteFileTransfer(sourceTarget, source.worktreePath, source.paths)
  if (!inventory.ok) return inventory
  const copied: RepoFileTransferCopiedEntry[] = []
  const renamed: RepoFileTransferRenamedEntry[] = []
  const failed: RepoFileTransferFailedEntry[] = []
  for (const sourcePath of source.paths) {
    const rootEntry = inventory.entries.find((entry) => sameRemotePath(entry.path, sourcePath))
    if (!rootEntry) {
      failed.push({ sourcePath, message: 'error.path-not-found' })
      continue
    }
    const requestedName = path.posix.basename(sourcePath)
    const destinationName = uniqueCopyName(existingNames, requestedName)
    existingNames.add(destinationName)
    const destinationPath = path.posix.join(targetDirPath, destinationName)
    if (destinationName !== requestedName) renamed.push({ requestedName, destinationName, destinationPath })
    const entries = inventory.entries.filter((entry) => remotePathInsideRoot(sourcePath, entry.path))
    const result = await copyRemoteInventoryEntries(sourceTarget, target, sourcePath, destinationPath, entries)
    if (result.ok) copied.push({ sourcePath, destinationPath, kind: rootEntry.kind })
    else failed.push({ sourcePath, message: result.message })
  }
  return { ok: true, copied, renamed, failed }
}

async function copyLocalPathToRemote(
  target: RemoteRepoTarget,
  sourcePath: string,
  destinationPath: string,
): Promise<ExecResult> {
  const stat = await fs.lstat(sourcePath).catch(() => null)
  if (!stat) return { ok: false, message: 'error.path-not-found' }
  if (stat.isSymbolicLink()) {
    const linkTarget = await fs.readlink(sourcePath)
    return await createRemoteSymlink(target, destinationPath, linkTarget)
  }
  if (stat.isDirectory()) {
    const created = await createRemoteDirectory(target, destinationPath)
    if (!created.ok) return created
    const children = await fs.readdir(sourcePath)
    for (const child of children) {
      const result = await copyLocalPathToRemote(target, path.join(sourcePath, child), path.posix.join(destinationPath, child))
      if (!result.ok) return result
    }
    return { ok: true, message: '' }
  }
  if (!stat.isFile()) return { ok: false, message: 'error.invalid-path' }
  const bytes = await fs.readFile(sourcePath)
  return await writeRemoteFileBase64(target, destinationPath, bytes.toString('base64'))
}

async function copyRemoteInventoryEntries(
  sourceTarget: RemoteRepoTarget,
  target: RemoteRepoTarget,
  sourcePath: string,
  destinationPath: string,
  entries: RemoteTransferInventoryEntry[],
): Promise<ExecResult> {
  const sortedEntries = [...entries].sort(compareRemoteInventoryEntries)
  for (const entry of sortedEntries) {
    const relativePath = path.posix.relative(path.posix.normalize(sourcePath), path.posix.normalize(entry.path))
    const targetPath = relativePath ? path.posix.join(destinationPath, relativePath) : destinationPath
    let result: ExecResult
    if (entry.kind === 'directory') {
      result = await createRemoteDirectory(target, targetPath)
    } else if (entry.kind === 'symlink') {
      result = await createRemoteSymlink(target, targetPath, entry.linkTarget ?? '')
    } else {
      const read = await readRemoteFileBase64(sourceTarget, entry.path)
      if (!read.ok) return read
      result = await writeRemoteFileBase64(target, targetPath, read.bytesBase64)
    }
    if (!result.ok) return result
  }
  return { ok: true, message: '' }
}

function validateUploadedItemSizes(items: RepoFileTransferUploadedItem[]): RepoFileTransferResult | null {
  let totalBytes = 0
  for (const item of items) {
    if (item.byteLength > FILE_TRANSFER_MAX_FILE_BYTES) return { ok: false, message: 'error.file-transfer-file-too-large' }
    totalBytes += item.byteLength
    if (totalBytes > FILE_TRANSFER_MAX_TOTAL_BYTES) return { ok: false, message: 'error.file-transfer-total-too-large' }
  }
  return null
}

async function localTransferKind(sourcePath: string): Promise<RepoFileTransferCopiedEntry['kind'] | null> {
  const stat = await fs.lstat(sourcePath).catch(() => null)
  if (!stat) return null
  if (stat.isDirectory()) return 'directory'
  if (stat.isSymbolicLink()) return 'symlink'
  return 'file'
}

function compareRemoteInventoryEntries(a: RemoteTransferInventoryEntry, b: RemoteTransferInventoryEntry): number {
  const depth = remotePathDepth(a.path) - remotePathDepth(b.path)
  if (depth !== 0) return depth
  const aDirectory = a.kind === 'directory'
  const bDirectory = b.kind === 'directory'
  if (aDirectory !== bDirectory) return aDirectory ? -1 : 1
  return a.path.localeCompare(b.path)
}

function remotePathDepth(value: string): number {
  return path.posix.normalize(value).split('/').filter(Boolean).length
}

function sameRemotePath(a: string, b: string): boolean {
  return path.posix.normalize(a) === path.posix.normalize(b)
}

function remotePathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const root = path.posix.normalize(rootPath)
  const candidate = path.posix.normalize(candidatePath)
  if (!path.posix.isAbsolute(root) || !path.posix.isAbsolute(candidate)) return false
  return candidate === root || candidate.startsWith(`${root.replace(/\/+$/, '')}/`)
}
