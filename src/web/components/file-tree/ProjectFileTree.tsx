import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { ChevronDown, ChevronRight, File, FileSymlink, Folder, FolderOpen, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import {
  GOBLIN_FILE_PATHS_MIME,
  type RepoFileTransferSource,
  type RepoFileTreeEntry,
  type RepoFileTreeResult,
} from '#/shared/file-tree.ts'
import { isRemoteRepoId } from '#/shared/rpc.ts'
import { openRemoteRepositoryEditor, openRemoteRepositoryTerminal } from '#/web/remote-client.ts'
import {
  deleteRepositoryFileTreeEntries,
  getRepositoryFileTree,
  openRepositoryEditor,
  openRepositoryTerminal,
  renameRepositoryFileTreeEntry,
  transferRepositoryFiles,
} from '#/web/repo-client.ts'
import { Button } from '#/web/components/ui/button.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/web/components/ui/alert-dialog.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/web/components/ui/dropdown-menu.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import {
  buildFileTreeStatusIndex,
  buildGoblinFilePathDragPayload,
  mergeDirectoryEntries,
  nextFileTreeSelection,
  resolveFileTreePasteTarget,
  visibleFileTreeNodeIds,
  type FileTreeNode,
  type FileTreeSelectionState,
  type FileTreeTone,
} from '#/web/components/file-tree/model.ts'
import {
  isPrimaryShortcut,
  readInternalFileTreeClipboard,
  sourceFromClipboardEvent,
  sourceFromDroppedFiles,
  writeInternalFileTreeClipboard,
} from '#/web/components/file-tree/clipboard.ts'
import { resolveDropTargetDirectory } from '#/web/components/file-tree/drop-target.ts'
import type { WorktreeStatus } from '#/web/types.ts'

const ROOT_DIR = ''

interface DirectoryState {
  entries?: RepoFileTreeEntry[]
  loading: boolean
  error: string | null
}

interface ProjectFileTreeView {
  exists: boolean
  worktreePath: string | null
  status: WorktreeStatus[]
}

interface ContextMenuPoint {
  x: number
  y: number
}

export interface FileTreeRevealRequest {
  id: number
  relativePath: string
}

export function ProjectFileTree({
  repoId,
  revealRequest,
}: {
  repoId: string
  revealRequest?: FileTreeRevealRequest | null
}) {
  const t = useT()
  const view = useProjectFileTreeView(repoId)
  const worktreePath = view.worktreePath
  const activeWorktreeRef = useRef<string | null>(worktreePath)
  const directoriesRef = useRef<Record<string, DirectoryState>>({})
  const revealRequestRef = useRef<number | null>(null)
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set())
  const [selection, setSelection] = useState<FileTreeSelectionState>(() => ({ selected: new Set(), anchor: null }))
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [contextNode, setContextNode] = useState<FileTreeNode | null>(null)
  const [contextPoint, setContextPoint] = useState<ContextMenuPoint | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [renameNode, setRenameNode] = useState<FileTreeNode | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamePending, setRenamePending] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<FileTreeNode[]>([])
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    activeWorktreeRef.current = worktreePath
  }, [worktreePath])

  useEffect(() => {
    directoriesRef.current = directories
  }, [directories])

  const loadDirectory = useCallback(
    async (relativePath: string, absolutePath: string, signal?: AbortSignal): Promise<RepoFileTreeResult | null> => {
      if (!worktreePath) return null
      setDirectories((current) => {
        const next = {
          ...current,
          [relativePath]: { ...current[relativePath], loading: true, error: null },
        }
        directoriesRef.current = next
        return next
      })
      const result = await getRepositoryFileTree(repoId, worktreePath, absolutePath, signal)
      if (signal?.aborted || activeWorktreeRef.current !== worktreePath) return null
      setDirectories((current) => {
        const next = {
          ...current,
          [relativePath]: result.ok
            ? { entries: result.entries, loading: false, error: null }
            : { ...current[relativePath], loading: false, error: result.message },
        }
        directoriesRef.current = next
        return next
      })
      return result
    },
    [repoId, worktreePath],
  )

  useEffect(() => {
    directoriesRef.current = {}
    revealRequestRef.current = null
    setDirectories({})
    setExpandedDirs(new Set())
    setSelection({ selected: new Set(), anchor: null })
    setFocusedNodeId(null)
    setContextNode(null)
    setContextPoint(null)
    setContextOpen(false)
    setRenameNode(null)
    setRenameValue('')
    setRenamePending(false)
    setRenameError(null)
    setDeleteTargets([])
    setDeletePending(false)
    setDeleteError(null)
    if (!worktreePath) return
    const controller = new AbortController()
    void loadDirectory(ROOT_DIR, worktreePath, controller.signal)
    return () => controller.abort()
  }, [loadDirectory, worktreePath])

  const statusIndex = useMemo(
    () => (worktreePath ? buildFileTreeStatusIndex(worktreePath, view.status) : null),
    [view.status, worktreePath],
  )
  const rootNodes = useMemo(() => {
    if (!worktreePath || !statusIndex) return []
    const makeNodes = (directoryRelativePath: string): FileTreeNode[] => {
      const entries = directories[directoryRelativePath]?.entries ?? []
      return mergeDirectoryEntries(worktreePath, directoryRelativePath, entries, statusIndex).map((node) => {
        const expanded = expandedDirs.has(node.id)
        if (!isExpandableNode(node)) return node
        return {
          ...node,
          expanded,
          children: expanded && directories[node.relativePath]?.entries ? makeNodes(node.relativePath) : undefined,
        }
      })
    }
    return makeNodes(ROOT_DIR)
  }, [directories, expandedDirs, statusIndex, worktreePath])

  const flatNodes = useMemo(() => flattenNodes(rootNodes), [rootNodes])
  const flatNodeById = useMemo(() => new Map(flatNodes.map((node) => [node.id, node])), [flatNodes])
  const visibleIds = useMemo(() => visibleFileTreeNodeIds(rootNodes), [rootNodes])
  const rootState = directories[ROOT_DIR]

  useEffect(() => {
    if (!worktreePath || !revealRequest) return
    const request = revealRequest
    const activeWorktreePath = worktreePath
    if (revealRequestRef.current === request.id) return
    revealRequestRef.current = request.id
    let cancelled = false

    async function ensureDirectory(relativePath: string, absolutePath: string): Promise<RepoFileTreeEntry[] | null> {
      const state = directoriesRef.current[relativePath]
      if (state?.entries) return state.entries
      const result = await loadDirectory(relativePath, absolutePath)
      if (!result?.ok) return null
      return result.entries
    }

    async function revealPath() {
      let parentRelativePath = ROOT_DIR
      let entries = await ensureDirectory(ROOT_DIR, activeWorktreePath)
      if (!entries) return

      for (const directoryRelativePath of parentRelativePaths(request.relativePath)) {
        if (cancelled) return
        const entry = findEntry(entries, directoryRelativePath)
        if (!entry) return
        setExpandedDirs((current) => new Set(current).add(entry.relativePath))
        entries = await ensureDirectory(entry.relativePath, entry.absolutePath)
        if (!entries) return
        parentRelativePath = entry.relativePath
      }

      const finalEntry = findEntry(entries, request.relativePath)
      const targetId = finalEntry ? finalEntry.relativePath : `virtual:${request.relativePath}`
      if (cancelled) return
      setSelection({ selected: new Set([targetId]), anchor: targetId })
      scheduleFileTreeNodeScroll(targetId)
    }

    void revealPath()
    return () => {
      cancelled = true
    }
  }, [loadDirectory, revealRequest, worktreePath])

  const toggleDirectory = useCallback(
    (node: FileTreeNode) => {
      if (!isExpandableNode(node)) return
      const willExpand = !expandedDirs.has(node.id)
      setExpandedDirs((current) => {
        const next = new Set(current)
        if (next.has(node.id)) next.delete(node.id)
        else next.add(node.id)
        return next
      })
      const state = directories[node.relativePath]
      if (willExpand && !state?.entries && !state?.loading) {
        void loadDirectory(node.relativePath, node.absolutePath)
      }
    },
    [directories, expandedDirs, loadDirectory],
  )

  const handleSelect = useCallback(
    (node: FileTreeNode, event: MouseEvent) => {
      setSelection((current) =>
        nextFileTreeSelection(current, visibleIds, node.id, {
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
        }),
      )
    },
    [visibleIds],
  )

  const handleDragStart = useCallback(
    (node: FileTreeNode, event: DragEvent) => {
      const selectedIds = selection.selected.has(node.id) ? selection.selected : new Set([node.id])
      const paths = Array.from(selectedIds)
        .map((id) => flatNodeById.get(id)?.absolutePath)
        .filter((path): path is string => !!path)
      event.dataTransfer.setData(GOBLIN_FILE_PATHS_MIME, buildGoblinFilePathDragPayload(paths))
      event.dataTransfer.setData('text/plain', paths.join(' '))
      event.dataTransfer.effectAllowed = 'copy'
    },
    [flatNodeById, selection.selected],
  )

  const handleContextMenu = useCallback(
    (node: FileTreeNode, event: MouseEvent) => {
      event.preventDefault()
      setFocusedNodeId(node.id)
      setContextNode(node)
      setContextPoint({ x: event.clientX, y: event.clientY })
      setContextOpen(true)
      if (!selection.selected.has(node.id)) {
        setSelection({ selected: new Set([node.id]), anchor: node.id })
      }
    },
    [selection.selected],
  )

  const selectedPaths = useCallback(() => {
    return Array.from(selection.selected)
      .map((id) => flatNodeById.get(id)?.absolutePath)
      .filter((path): path is string => !!path)
  }, [flatNodeById, selection.selected])

  const realSelectedNodes = useMemo(
    () =>
      Array.from(selection.selected)
        .map((id) => flatNodeById.get(id))
        .filter((node): node is FileTreeNode => !!node && isWritableNode(node)),
    [flatNodeById, selection.selected],
  )

  const refreshDirectoryForNode = useCallback(
    async (node: FileTreeNode) => {
      if (!worktreePath) return
      await loadDirectory(parentRelativePathForNode(node), parentAbsolutePathForNode(worktreePath, node))
    },
    [loadDirectory, worktreePath],
  )

  const clearCachedDescendants = useCallback((nodes: FileTreeNode[]) => {
    setDirectories((current) => {
      const next = { ...current }
      for (const node of nodes) {
        for (const key of Object.keys(next)) {
          if (key === node.relativePath || key.startsWith(`${node.relativePath}/`)) delete next[key]
        }
      }
      directoriesRef.current = next
      return next
    })
    setExpandedDirs((current) => {
      const next = new Set(current)
      for (const node of nodes) {
        for (const key of Array.from(next)) {
          if (key === node.id || key.startsWith(`${node.id}/`)) next.delete(key)
        }
      }
      return next
    })
  }, [])

  const cancelRename = useCallback(() => {
    if (renamePending) return
    setRenameNode(null)
    setRenameValue('')
    setRenameError(null)
  }, [renamePending])

  const beginRename = useCallback((node: FileTreeNode) => {
    if (!isWritableNode(node)) return
    setRenameNode(node)
    setRenameValue(node.name)
    setRenameError(null)
    setContextOpen(false)
  }, [])

  const beginDelete = useCallback(
    (node: FileTreeNode) => {
      if (!isWritableNode(node)) return
      const targets = selection.selected.has(node.id) ? realSelectedNodes : [node]
      setDeleteTargets(targets.filter(isWritableNode))
      setDeleteError(null)
      setContextOpen(false)
    },
    [realSelectedNodes, selection.selected],
  )

  const submitRename = useCallback(async (value = renameValue) => {
    if (!worktreePath || !renameNode) return
    const nextName = value.trim()
    if (!nextName) {
      setRenameError('error.invalid-arguments')
      return
    }
    if (nextName === renameNode.name) {
      cancelRename()
      return
    }
    setRenamePending(true)
    setRenameError(null)
    const result = await renameRepositoryFileTreeEntry(repoId, worktreePath, renameNode.absolutePath, nextName)
    setRenamePending(false)
    if (!result.ok) {
      setRenameError(result.message)
      return
    }
    const nextId = renamedRelativePath(renameNode, nextName)
    clearCachedDescendants([renameNode])
    setSelection({ selected: new Set([nextId]), anchor: nextId })
    setFocusedNodeId(nextId)
    setRenameNode(null)
    setRenameValue('')
    setRenameError(null)
    await refreshDirectoryForNode(renameNode)
  }, [cancelRename, clearCachedDescendants, refreshDirectoryForNode, renameNode, renameValue, repoId, worktreePath])

  const submitDelete = useCallback(async () => {
    if (!worktreePath || deleteTargets.length === 0) return
    const targets = deleteTargets
    setDeletePending(true)
    setDeleteError(null)
    const result = await deleteRepositoryFileTreeEntries(
      repoId,
      worktreePath,
      targets.map((node) => node.absolutePath),
    )
    setDeletePending(false)
    if (!result.ok) {
      setDeleteError(result.message)
      return
    }
    const deletedIds = new Set(targets.map((node) => node.id))
    clearCachedDescendants(targets)
    setSelection((current) => {
      const selected = new Set(current.selected)
      for (const id of deletedIds) selected.delete(id)
      return { selected, anchor: current.anchor && deletedIds.has(current.anchor) ? null : current.anchor }
    })
    setFocusedNodeId((current) => (current && deletedIds.has(current) ? null : current))
    setDeleteTargets([])
    setDeleteError(null)
    for (const parentSource of uniqueParentNodes(targets)) {
      await refreshDirectoryForNode(parentSource)
    }
  }, [clearCachedDescendants, deleteTargets, refreshDirectoryForNode, repoId, worktreePath])

  const pasteTargetNode = useCallback(() => {
    if (contextOpen && contextNode) return contextNode
    if (focusedNodeId) return flatNodeById.get(focusedNodeId) ?? null
    const firstSelected = Array.from(selection.selected)[0]
    return firstSelected ? flatNodeById.get(firstSelected) ?? null : null
  }, [contextNode, contextOpen, flatNodeById, focusedNodeId, selection.selected])

  const runTransfer = useCallback(
    async (targetDirPath: string, source: RepoFileTransferSource | null = readInternalFileTreeClipboard()) => {
      if (!worktreePath || !source) return
      const result = await transferRepositoryFiles({ repoId, worktreePath, targetDirPath, source })
      if (result.ok) void loadDirectory(relativeDirPath(worktreePath, targetDirPath), targetDirPath)
    },
    [loadDirectory, repoId, worktreePath],
  )

  const handleKeyDown = useCallback(
    (node: FileTreeNode, event: KeyboardEvent) => {
      if (event.key === 'Enter' && isWritableNode(node)) {
        event.preventDefault()
        if (!selection.selected.has(node.id)) {
          setSelection({ selected: new Set([node.id]), anchor: node.id })
        }
        beginRename(node)
        return
      }
      if (!worktreePath || !isPrimaryShortcut(event.nativeEvent)) return
      const key = event.key.toLowerCase()
      if (key === 'c') {
        event.preventDefault()
        const paths = selectedPaths()
        writeInternalFileTreeClipboard({
          repoId,
          worktreePath,
          paths: paths.length > 0 ? paths : [node.absolutePath],
        })
      } else if (key === 'v') {
        event.preventDefault()
        void runTransfer(resolveFileTreePasteTarget(worktreePath, node))
      }
    },
    [beginRename, repoId, runTransfer, selectedPaths, selection.selected, worktreePath],
  )

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (!worktreePath) return
      void (async () => {
        const source = readInternalFileTreeClipboard() ?? await sourceFromClipboardEvent(event.nativeEvent)
        if (!source) return
        event.preventDefault()
        await runTransfer(resolveFileTreePasteTarget(worktreePath, pasteTargetNode()), source)
      })()
    },
    [pasteTargetNode, runTransfer, worktreePath],
  )

  const handleDrop = useCallback(
    (node: FileTreeNode | null, event: DragEvent<HTMLDivElement>) => {
      if (!worktreePath || !event.dataTransfer.types.includes('Files')) return
      const source = sourceFromDroppedFiles(Array.from(event.dataTransfer.files))
      if (!source) return
      event.preventDefault()
      event.stopPropagation()
      void runTransfer(resolveDropTargetDirectory(worktreePath, node), source)
    },
    [runTransfer, worktreePath],
  )

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  if (!view.exists) return null

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background"
      data-repo-id={repoId}
      onPaste={handlePaste}
      onDrop={(event) => handleDrop(null, event)}
      onDragOver={handleDragOver}
    >
      {!worktreePath ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center">
          <div>
            <div className="text-sm font-medium text-foreground">{t('file-tree.no-worktree-title')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('file-tree.no-worktree-body')}</div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto py-1 text-xs">
          {rootState?.loading && !rootState.entries ? (
            <FileTreeMessage>{t('file-tree.loading')}</FileTreeMessage>
          ) : rootState?.error && !rootState.entries ? (
            <FileTreeError message={t(rootState.error)} onRetry={() => void loadDirectory(ROOT_DIR, worktreePath)} />
          ) : (
            rootNodes.map((node) => (
              <FileTreeRow
                key={node.id}
                node={node}
                depth={0}
                selected={selection.selected.has(node.id)}
                selectedIds={selection.selected}
                directories={directories}
                directoryState={directories[node.relativePath]}
                onSelect={handleSelect}
                onToggle={toggleDirectory}
                onDragStart={handleDragStart}
                onContextMenu={handleContextMenu}
                onKeyDown={handleKeyDown}
                onFocus={setFocusedNodeId}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                renameNodeId={renameNode?.id ?? null}
                renameValue={renameValue}
                renamePending={renamePending}
                renameError={renameError}
                onRenameValueChange={setRenameValue}
                onRenameCancel={cancelRename}
                onRenameSubmit={submitRename}
              />
            ))
          )}
        </div>
      )}
      <FileTreeContextMenu
        repoId={repoId}
        node={contextNode}
        point={contextPoint}
        open={contextOpen}
        onOpenChange={setContextOpen}
        onBeginRename={beginRename}
        onBeginDelete={beginDelete}
      />
      <FileTreeDeleteDialog
        targets={deleteTargets}
        pending={deletePending}
        error={deleteError}
        onCancel={() => {
          if (deletePending) return
          setDeleteTargets([])
          setDeleteError(null)
        }}
        onConfirm={submitDelete}
      />
    </div>
  )
}

function useProjectFileTreeView(repoId: string): ProjectFileTreeView {
  return useStoreWithEqualityFn(
    useReposStore,
    (state) => {
      const repo = state.repos[repoId]
      if (!repo) return { exists: false, worktreePath: null, status: [] }
      const selected = repo.data.branches.find((branch) => branch.name === repo.ui.selectedBranch) ?? null
      return {
        exists: true,
        worktreePath: selected?.worktree?.path ?? null,
        status: repo.data.status,
      }
    },
    (a, b) => a.exists === b.exists && a.worktreePath === b.worktreePath && a.status === b.status,
  )
}

function FileTreeRow({
  node,
  depth,
  selected,
  selectedIds,
  directories,
  directoryState,
  onSelect,
  onToggle,
  onDragStart,
  onContextMenu,
  onKeyDown,
  onFocus,
  onDrop,
  onDragOver,
  renameNodeId,
  renameValue,
  renamePending,
  renameError,
  onRenameValueChange,
  onRenameCancel,
  onRenameSubmit,
}: {
  node: FileTreeNode
  depth: number
  selected: boolean
  selectedIds: Set<string>
  directories: Record<string, DirectoryState>
  directoryState?: DirectoryState
  onSelect: (node: FileTreeNode, event: MouseEvent) => void
  onToggle: (node: FileTreeNode) => void
  onDragStart: (node: FileTreeNode, event: DragEvent) => void
  onContextMenu: (node: FileTreeNode, event: MouseEvent) => void
  onKeyDown: (node: FileTreeNode, event: KeyboardEvent) => void
  onFocus: (nodeId: string) => void
  onDrop: (node: FileTreeNode, event: DragEvent<HTMLDivElement>) => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  renameNodeId: string | null
  renameValue: string
  renamePending: boolean
  renameError: string | null
  onRenameValueChange: (value: string) => void
  onRenameCancel: () => void
  onRenameSubmit: (value?: string) => void
}) {
  const expandable = isExpandableNode(node)
  const Icon = iconForNode(node, node.expanded === true)
  return (
    <>
      <div
        role="treeitem"
        data-file-tree-node-id={node.id}
        aria-selected={selected}
        tabIndex={0}
        draggable
        onFocus={() => onFocus(node.id)}
        onKeyDown={(event) => onKeyDown(node, event)}
        onClick={(event) => {
          onFocus(node.id)
          onSelect(node, event)
          if (expandable) onToggle(node)
        }}
        onDragStart={(event) => onDragStart(node, event)}
        onDrop={(event) => onDrop(node, event)}
        onDragOver={onDragOver}
        onContextMenu={(event) => onContextMenu(node, event)}
        className={cn(
          'flex h-6 min-w-0 cursor-default select-none items-center gap-1 px-2 outline-hidden',
          selected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/60',
          toneClass(node.tone),
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <button
          type="button"
          aria-label={`Toggle ${node.name}`}
          disabled={!expandable}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(node)
          }}
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground',
            expandable && 'hover:bg-muted hover:text-foreground',
          )}
        >
          {expandable ? node.expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" /> : null}
        </button>
        <Icon className="size-3.5 shrink-0" />
        {renameNodeId === node.id ? (
          <Input
            aria-label="file-tree.rename-input-label"
            value={renameValue}
            disabled={renamePending}
            autoFocus
            onChange={(event) => onRenameValueChange(event.currentTarget.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => {
              if (!renamePending) onRenameCancel()
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                event.preventDefault()
                onRenameCancel()
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                void onRenameSubmit(event.currentTarget.value)
              }
            }}
            className="h-5 min-w-0 flex-1 px-1 py-0 text-xs"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        )}
        {node.changeCount ? <span className="shrink-0 font-mono text-[10px] opacity-80">{node.changeCount}</span> : null}
      </div>
      {renameNodeId === node.id && renameError ? (
        <FileTreeIndentedMessage depth={depth + 1}>{renameError}</FileTreeIndentedMessage>
      ) : null}
      {node.expanded && directoryState?.loading ? <FileTreeIndentedMessage depth={depth + 1}>Loading...</FileTreeIndentedMessage> : null}
      {node.expanded && directoryState?.error ? (
        <FileTreeIndentedMessage depth={depth + 1}>{directoryState.error}</FileTreeIndentedMessage>
      ) : null}
      {node.expanded && node.children?.map((child) => (
        <FileTreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selected={selectedIds.has(child.id)}
          selectedIds={selectedIds}
          directories={directories}
          directoryState={directories[child.relativePath]}
          onSelect={onSelect}
          onToggle={onToggle}
          onDragStart={onDragStart}
          onContextMenu={onContextMenu}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onDrop={onDrop}
          onDragOver={onDragOver}
          renameNodeId={renameNodeId}
          renameValue={renameValue}
          renamePending={renamePending}
          renameError={renameError}
          onRenameValueChange={onRenameValueChange}
          onRenameCancel={onRenameCancel}
          onRenameSubmit={onRenameSubmit}
        />
      ))}
    </>
  )
}

function FileTreeContextMenu({
  repoId,
  node,
  point,
  open,
  onOpenChange,
  onBeginRename,
  onBeginDelete,
}: {
  repoId: string
  node: FileTreeNode | null
  point: ContextMenuPoint | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onBeginRename: (node: FileTreeNode) => void
  onBeginDelete: (node: FileTreeNode) => void
}) {
  const t = useT()
  const realNode = !!node && isWritableNode(node)
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="file tree menu"
          className="fixed size-0 overflow-hidden border-0 p-0"
          style={{ left: point?.x ?? 0, top: point?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" sideOffset={0}>
        <DropdownMenuItem disabled={!node} onSelect={() => void copyText(node?.absolutePath ?? '')}>
          {t('file-tree.copy-path')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!node} onSelect={() => void copyText(node?.relativePath ?? '')}>
          {t('file-tree.copy-relative-path')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!realNode} onSelect={() => node && void openNodeInEditor(repoId, node)}>
          {t('file-tree.open-editor')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!realNode} onSelect={() => node && void openNodeInTerminal(repoId, node)}>
          {t('file-tree.open-terminal')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!realNode} onSelect={() => node && onBeginRename(node)}>
          <Pencil className="size-3.5" />
          {t('file-tree.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!realNode}
          variant="destructive"
          onSelect={() => node && onBeginDelete(node)}
        >
          <Trash2 className="size-3.5" />
          {t('file-tree.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FileTreeDeleteDialog({
  targets,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  targets: FileTreeNode[]
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const t = useT()
  const open = targets.length > 0
  const hasDirectory = targets.some((node) => node.kind === 'directory' || node.targetKind === 'directory')
  const body = targets.length === 1
    ? t('file-tree.delete-confirm-single-body').replace('{name}', targets[0]?.name ?? '')
    : t('file-tree.delete-confirm-multiple-body').replace('{count}', String(targets.length))
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('file-tree.delete-confirm-title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {body}
            {hasDirectory ? <span className="mt-2 block">{t('file-tree.delete-confirm-directory-note')}</span> : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <div className="text-sm text-danger">{t(error)}</div> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('dialog.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            variant="destructive"
            onClick={(event) => {
              event.preventDefault()
              void onConfirm()
            }}
          >
            {t('file-tree.delete-confirm-confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function FileTreeMessage({ children }: { children: ReactNode }) {
  return <div className="px-3 py-2 text-xs text-muted-foreground">{children}</div>
}

function FileTreeIndentedMessage({ depth, children }: { depth: number; children: ReactNode }) {
  return (
    <div className="h-6 truncate px-2 text-xs text-muted-foreground" style={{ paddingLeft: `${24 + depth * 14}px` }}>
      {children}
    </div>
  )
}

function FileTreeError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-2 px-3 py-2 text-xs text-danger">
      <div>{message}</div>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw className="size-3.5" />
      </Button>
    </div>
  )
}

function iconForNode(node: FileTreeNode, expanded: boolean) {
  if (node.kind === 'directory') return expanded ? FolderOpen : Folder
  if (node.kind === 'symlink') return FileSymlink
  return File
}

function isExpandableNode(node: FileTreeNode): boolean {
  return node.kind === 'directory' || (node.kind === 'symlink' && node.targetKind === 'directory')
}

function toneClass(tone?: FileTreeTone): string | undefined {
  switch (tone) {
    case 'attention':
      return 'text-attention'
    case 'success':
      return 'text-success'
    case 'danger':
      return 'text-danger'
    case 'muted':
      return 'text-muted-foreground'
    default:
      return undefined
  }
}

function flattenNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  const result: FileTreeNode[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.expanded && node.children) result.push(...flattenNodes(node.children))
  }
  return result
}

async function copyText(value: string) {
  if (!value) return
  await navigator.clipboard?.writeText(value)
}

async function openNodeInEditor(repoId: string, node: FileTreeNode) {
  if (isRemoteRepoId(repoId)) await openRemoteRepositoryEditor(repoId, node.absolutePath)
  else await openRepositoryEditor(node.absolutePath)
}

async function openNodeInTerminal(repoId: string, node: FileTreeNode) {
  const terminalPath = node.kind === 'directory' ? node.absolutePath : parentPath(node.absolutePath)
  if (isRemoteRepoId(repoId)) await openRemoteRepositoryTerminal(repoId, terminalPath)
  else await openRepositoryTerminal(terminalPath)
}

function parentPath(value: string): string {
  const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  return slash > 0 ? value.slice(0, slash) : value
}

function isWritableNode(node: FileTreeNode): boolean {
  return node.kind !== 'virtual'
}

function parentRelativePathForNode(node: FileTreeNode): string {
  const index = node.relativePath.lastIndexOf('/')
  return index < 0 ? '' : node.relativePath.slice(0, index)
}

function parentAbsolutePathForNode(worktreePath: string, node: FileTreeNode): string {
  const relativeParent = parentRelativePathForNode(node)
  return relativeParent ? `${worktreePath.replace(/\/$/, '')}/${relativeParent}` : worktreePath
}

function renamedRelativePath(node: FileTreeNode, newName: string): string {
  const parent = parentRelativePathForNode(node)
  return parent ? `${parent}/${newName}` : newName
}

function uniqueParentNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  const seen = new Set<string>()
  const result: FileTreeNode[] = []
  for (const node of nodes) {
    const parent = parentRelativePathForNode(node)
    if (seen.has(parent)) continue
    seen.add(parent)
    result.push(node)
  }
  return result
}

function relativeDirPath(worktreePath: string, dirPath: string): string {
  const normalizedRoot = worktreePath.replace(/[\\/]+$/, '')
  const normalizedDir = dirPath.replace(/[\\/]+$/, '')
  if (normalizedDir === normalizedRoot) return ROOT_DIR
  return normalizedDir.slice(normalizedRoot.length + 1).split('\\').join('/')
}

function pathParts(relativePath: string): string[] {
  return relativePath.split('/').filter((part) => part.length > 0)
}

function parentRelativePaths(relativePath: string): string[] {
  const parts = pathParts(relativePath)
  const parents: string[] = []
  for (let i = 1; i < parts.length; i += 1) {
    parents.push(parts.slice(0, i).join('/'))
  }
  return parents
}

function findEntry(entries: RepoFileTreeEntry[] | undefined, relativePath: string): RepoFileTreeEntry | null {
  return entries?.find((entry) => entry.relativePath === relativePath) ?? null
}

function fileTreeNodeSelector(id: string): string {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&')
  return `[data-file-tree-node-id="${escaped}"]`
}

function scheduleFileTreeNodeScroll(id: string) {
  const scroll = () => {
    document.querySelector<HTMLElement>(fileTreeNodeSelector(id))?.scrollIntoView?.({ block: 'nearest' })
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll)
  else window.setTimeout(scroll, 0)
}
