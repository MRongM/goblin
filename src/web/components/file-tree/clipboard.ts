import {
  FILE_TRANSFER_MAX_FILE_BYTES,
  FILE_TRANSFER_MAX_TOTAL_BYTES,
  type RepoFileTransferFileTreeSource,
  type RepoFileTransferSource,
  type RepoFileTransferUploadedItem,
} from '#/shared/file-tree.ts'
import { pathForDroppedFile } from '#/web/app-shell-client.ts'
import { generatedPasteFileName } from '#/web/components/file-tree/model.ts'

export interface FileTreeClipboardSelection {
  repoId: string
  worktreePath: string
  paths: string[]
}

let internalClipboard: RepoFileTransferFileTreeSource | null = null

export function isPrimaryShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  if (event.altKey) return false
  const key = event.key.toLowerCase()
  return (key === 'c' || key === 'v') && (event.metaKey || event.ctrlKey)
}

export function writeInternalFileTreeClipboard(selection: FileTreeClipboardSelection): void {
  internalClipboard = {
    kind: 'fileTreePaths',
    repoId: selection.repoId,
    worktreePath: selection.worktreePath,
    paths: selection.paths.filter((path) => path.length > 0),
  }
}

export function readInternalFileTreeClipboard(): RepoFileTransferFileTreeSource | null {
  return internalClipboard && internalClipboard.paths.length > 0 ? internalClipboard : null
}

export async function sourceFromClipboardEvent(event: ClipboardEvent): Promise<RepoFileTransferSource | null> {
  const files = Array.from(event.clipboardData?.files ?? [])
  const localPaths = files.map((file) => pathForDroppedFile(file)).filter((path) => path.length > 0)
  if (localPaths.length > 0) return { kind: 'localPaths', paths: localPaths }

  const items = Array.from(event.clipboardData?.items ?? [])
  const uploaded: RepoFileTransferUploadedItem[] = []
  let totalBytes = 0
  const reserveBytes = (byteLength: number): boolean => {
    if (byteLength > FILE_TRANSFER_MAX_FILE_BYTES || totalBytes + byteLength > FILE_TRANSFER_MAX_TOTAL_BYTES) return false
    totalBytes += byteLength
    return true
  }
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (!file || !reserveBytes(file.size)) continue
      uploaded.push(await uploadedItemFromFile(file))
    } else if (item.kind === 'string' && item.type === 'text/plain') {
      const text = await clipboardString(item)
      const bytes = new TextEncoder().encode(text)
      if (reserveBytes(bytes.byteLength)) {
        uploaded.push({
          name: generatedPasteFileName('text/plain'),
          mimeType: 'text/plain',
          bytesBase64: bytesToBase64(bytes),
          byteLength: bytes.byteLength,
        })
      }
    }
  }
  return uploaded.length > 0 ? { kind: 'uploadedItems', items: uploaded } : null
}

export function sourceFromDroppedFiles(files: File[]): RepoFileTransferSource | null {
  const paths = files.map((file) => pathForDroppedFile(file)).filter((path) => path.length > 0)
  return paths.length > 0 ? { kind: 'localPaths', paths } : null
}

async function uploadedItemFromFile(file: File): Promise<RepoFileTransferUploadedItem> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    name: file.name || generatedPasteFileName(file.type),
    mimeType: file.type || undefined,
    bytesBase64: bytesToBase64(bytes),
    byteLength: bytes.byteLength,
  }
}

function clipboardString(item: DataTransferItem): Promise<string> {
  return new Promise((resolve) => item.getAsString((value) => resolve(value ?? '')))
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
