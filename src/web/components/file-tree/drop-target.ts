import type { FileTreeNode } from '#/web/components/file-tree/model.ts'
import { resolveFileTreePasteTarget } from '#/web/components/file-tree/model.ts'

export function resolveDropTargetDirectory(worktreePath: string, node: FileTreeNode | null): string {
  return resolveFileTreePasteTarget(worktreePath, node)
}
