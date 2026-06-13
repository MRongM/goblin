export const GOBLIN_FILE_PATHS_MIME = 'application/x-goblin-file-paths+json'

export const FILE_TREE_MAX_ENTRIES = 5000
export const FILE_TRANSFER_MAX_FILE_BYTES = 100 * 1024 * 1024
export const FILE_TRANSFER_MAX_TOTAL_BYTES = 500 * 1024 * 1024

export type RepoFileTreeEntryKind = 'file' | 'directory' | 'symlink'
export type RepoFileTreeTargetKind = 'file' | 'directory' | 'other' | 'missing'
export type RepoFileTransferEntryKind = 'file' | 'directory' | 'symlink'

export interface RepoFileTreeEntry {
  name: string
  absolutePath: string
  relativePath: string
  kind: RepoFileTreeEntryKind
  targetKind?: RepoFileTreeTargetKind
}

export type RepoFileTreeResult =
  | {
      ok: true
      worktreePath: string
      dirPath: string
      entries: RepoFileTreeEntry[]
    }
  | {
      ok: false
      message: string
    }

export interface GoblinFilePathDragPayload {
  paths: string[]
}

export function serializeGoblinFilePathDragPayload(paths: string[]): string {
  return JSON.stringify({ paths: paths.filter((path) => path.length > 0) } satisfies GoblinFilePathDragPayload)
}

export function parseGoblinFilePathDragPayload(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as Partial<GoblinFilePathDragPayload>
    if (!Array.isArray(parsed.paths)) return []
    return parsed.paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
  } catch {
    return []
  }
}

export interface RepoFileTransferFileTreeSource {
  kind: 'fileTreePaths'
  repoId: string
  worktreePath: string
  paths: string[]
}

export interface RepoFileTransferLocalPathsSource {
  kind: 'localPaths'
  paths: string[]
}

export interface RepoFileTransferUploadedItem {
  name: string
  mimeType?: string
  bytesBase64: string
  byteLength: number
}

export interface RepoFileTransferUploadedItemsSource {
  kind: 'uploadedItems'
  items: RepoFileTransferUploadedItem[]
}

export type RepoFileTransferSource =
  | RepoFileTransferFileTreeSource
  | RepoFileTransferLocalPathsSource
  | RepoFileTransferUploadedItemsSource

export interface RepoFileTransferRequest {
  repoId: string
  worktreePath: string
  targetDirPath: string
  source: RepoFileTransferSource
}

export interface RepoFileTransferCopiedEntry {
  sourcePath?: string
  destinationPath: string
  kind: RepoFileTransferEntryKind
}

export interface RepoFileTransferRenamedEntry {
  requestedName: string
  destinationName: string
  destinationPath: string
}

export interface RepoFileTransferFailedEntry {
  sourcePath?: string
  name?: string
  message: string
}

export type RepoFileTransferResult =
  | {
      ok: true
      copied: RepoFileTransferCopiedEntry[]
      renamed: RepoFileTransferRenamedEntry[]
      failed: RepoFileTransferFailedEntry[]
    }
  | {
      ok: false
      message: string
    }

export function isRepoFileTransferRequest(value: unknown): value is RepoFileTransferRequest {
  if (!isRecord(value)) return false
  if (
    typeof value.repoId !== 'string' ||
    typeof value.worktreePath !== 'string' ||
    typeof value.targetDirPath !== 'string' ||
    !isRecord(value.source)
  ) {
    return false
  }
  const source = value.source
  if (source.kind === 'fileTreePaths') {
    return (
      typeof source.repoId === 'string' &&
      typeof source.worktreePath === 'string' &&
      isStringArray(source.paths)
    )
  }
  if (source.kind === 'localPaths') return isStringArray(source.paths)
  if (source.kind === 'uploadedItems') {
    return Array.isArray(source.items) && source.items.every(isRepoFileTransferUploadedItem)
  }
  return false
}

function isRepoFileTransferUploadedItem(value: unknown): value is RepoFileTransferUploadedItem {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.bytesBase64 === 'string' &&
    typeof value.byteLength === 'number' &&
    (value.mimeType === undefined || typeof value.mimeType === 'string')
  )
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
