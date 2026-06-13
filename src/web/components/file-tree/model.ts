import { serializeGoblinFilePathDragPayload, type RepoFileTreeEntry } from '#/shared/file-tree.ts'
import type { StatusEntry, WorktreeStatus } from '#/web/types.ts'

export type FileTreeTone = 'attention' | 'success' | 'danger' | 'muted'
export type FileTreeEntryKind = RepoFileTreeEntry['kind'] | 'virtual'

export interface FileTreeNode extends Omit<RepoFileTreeEntry, 'kind'> {
  id: string
  kind: FileTreeEntryKind
  tone?: FileTreeTone
  changeCount?: number
  children?: FileTreeNode[]
  expanded?: boolean
}

export interface FileTreeStatusInfo {
  tone: FileTreeTone
  entry: StatusEntry
}

export interface FileTreeStatusIndex {
  byPath: Map<string, FileTreeStatusInfo>
  virtualByDirectory: Map<string, FileTreeNode[]>
  directoryCounts: Map<string, number>
}

export interface FileTreeSelectionState {
  selected: Set<string>
  anchor: string | null
}

export interface FileTreeSelectionModifiers {
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
}

export interface VisibleFileTreeNode {
  id: string
  children?: VisibleFileTreeNode[]
  expanded?: boolean
}

function toneForStatus(entry: StatusEntry): FileTreeTone {
  if (entry.x === 'U' || entry.y === 'U' || entry.x === 'D' || entry.y === 'D') return 'danger'
  if (entry.x === '?' || entry.y === '?' || entry.x === 'A' || entry.y === 'A') return 'success'
  if (entry.x === '!' || entry.y === '!') return 'muted'
  return 'attention'
}

function parentDirectory(relativePath: string): string {
  const index = relativePath.lastIndexOf('/')
  return index < 0 ? '' : relativePath.slice(0, index)
}

function basename(relativePath: string): string {
  const index = relativePath.lastIndexOf('/')
  return index < 0 ? relativePath : relativePath.slice(index + 1)
}

function addDirectoryCounts(counts: Map<string, number>, relativePath: string): void {
  const parts = relativePath.split('/')
  for (let i = 1; i < parts.length; i += 1) {
    const dir = parts.slice(0, i).join('/')
    counts.set(dir, (counts.get(dir) ?? 0) + 1)
  }
}

function virtualNode(worktreePath: string, relativePath: string, tone: FileTreeTone, entry: StatusEntry): FileTreeNode {
  return {
    id: `virtual:${relativePath}`,
    name: basename(relativePath),
    absolutePath: `${worktreePath.replace(/\/$/, '')}/${relativePath}`,
    relativePath,
    kind: 'virtual',
    tone,
    changeCount: 1,
    targetKind: entry.x === 'D' || entry.y === 'D' ? 'missing' : undefined,
  }
}

export function buildFileTreeStatusIndex(worktreePath: string, status: WorktreeStatus[]): FileTreeStatusIndex {
  const active = status.find((item) => item.path === worktreePath)
  const byPath = new Map<string, FileTreeStatusInfo>()
  const virtualByDirectory = new Map<string, FileTreeNode[]>()
  const directoryCounts = new Map<string, number>()
  for (const entry of active?.entries ?? []) {
    const tone = toneForStatus(entry)
    byPath.set(entry.path, { tone, entry })
    addDirectoryCounts(directoryCounts, entry.path)
    const virtualPaths = [
      entry.x === 'D' || entry.y === 'D' ? entry.path : null,
      entry.originalPath ?? null,
    ].filter((path): path is string => !!path)
    for (const relativePath of virtualPaths) {
      const directory = parentDirectory(relativePath)
      const list = virtualByDirectory.get(directory) ?? []
      list.push(virtualNode(worktreePath, relativePath, tone, entry))
      virtualByDirectory.set(directory, list)
    }
  }
  return { byPath, virtualByDirectory, directoryCounts }
}

function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.sort((a, b) => {
    const aDir = a.kind === 'directory'
    const bDir = b.kind === 'directory'
    if (aDir !== bDir) return aDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

export function mergeDirectoryEntries(
  worktreePath: string,
  directoryRelativePath: string,
  entries: RepoFileTreeEntry[],
  statusIndex: FileTreeStatusIndex,
): FileTreeNode[] {
  const realPaths = new Set(entries.map((entry) => entry.relativePath))
  const realNodes = entries.map((entry): FileTreeNode => {
    const status = statusIndex.byPath.get(entry.relativePath)
    return {
      ...entry,
      id: entry.relativePath,
      tone: status?.tone,
      changeCount: entry.kind === 'directory' ? statusIndex.directoryCounts.get(entry.relativePath) : undefined,
    }
  })
  const virtualNodes = (statusIndex.virtualByDirectory.get(directoryRelativePath) ?? []).filter(
    (node) => !realPaths.has(node.relativePath),
  )
  void worktreePath
  return sortNodes([...realNodes, ...virtualNodes])
}

export function nextFileTreeSelection(
  current: FileTreeSelectionState,
  visibleIds: string[],
  clickedId: string,
  modifiers: FileTreeSelectionModifiers,
): FileTreeSelectionState {
  if (modifiers.shiftKey && current.anchor && visibleIds.includes(current.anchor) && visibleIds.includes(clickedId)) {
    const from = visibleIds.indexOf(current.anchor)
    const to = visibleIds.indexOf(clickedId)
    const [start, end] = from <= to ? [from, to] : [to, from]
    return { selected: new Set(visibleIds.slice(start, end + 1)), anchor: current.anchor }
  }
  if (modifiers.metaKey || modifiers.ctrlKey) {
    const selected = new Set(current.selected)
    if (selected.has(clickedId)) selected.delete(clickedId)
    else selected.add(clickedId)
    return { selected, anchor: clickedId }
  }
  return { selected: new Set([clickedId]), anchor: clickedId }
}

export function buildGoblinFilePathDragPayload(paths: string[]): string {
  return serializeGoblinFilePathDragPayload(paths)
}

export function visibleFileTreeNodeIds(nodes: VisibleFileTreeNode[]): string[] {
  const result: string[] = []
  for (const node of nodes) {
    result.push(node.id)
    if (node.expanded && node.children) result.push(...visibleFileTreeNodeIds(node.children))
  }
  return result
}

export function parentDirectoryPath(value: string): string {
  const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  return slash > 0 ? value.slice(0, slash) : value
}

export function resolveFileTreePasteTarget(worktreePath: string, node: FileTreeNode | null): string {
  if (!node) return worktreePath
  if (node.kind === 'directory' || (node.kind === 'symlink' && node.targetKind === 'directory')) {
    return node.absolutePath
  }
  return parentDirectoryPath(node.absolutePath)
}

export function generatedPasteFileName(mimeType: string | undefined, now = new Date()): string {
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    '-',
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('')
  if (mimeType === 'image/jpeg') return `pasted-image-${stamp}.jpg`
  if (mimeType === 'image/webp') return `pasted-image-${stamp}.webp`
  if (mimeType?.startsWith('image/')) return `pasted-image-${stamp}.png`
  return `pasted-text-${stamp}.txt`
}
