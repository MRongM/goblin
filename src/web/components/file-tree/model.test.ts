import { describe, expect, test } from 'vitest'
import type { RepoFileTreeEntry } from '#/shared/file-tree.ts'
import {
  buildFileTreeStatusIndex,
  buildGoblinFilePathDragPayload,
  generatedPasteFileName,
  mergeDirectoryEntries,
  nextFileTreeSelection,
  parentDirectoryPath,
  resolveFileTreePasteTarget,
  visibleFileTreeNodeIds,
} from '#/web/components/file-tree/model.ts'
import type { FileTreeNode } from '#/web/components/file-tree/model.ts'
import type { WorktreeStatus } from '#/web/types.ts'

const entries: RepoFileTreeEntry[] = [
  { name: 'src', absolutePath: '/repo/src', relativePath: 'src', kind: 'directory' },
  { name: 'README.md', absolutePath: '/repo/README.md', relativePath: 'README.md', kind: 'file' },
]

describe('file tree model', () => {
  test('maps status entries to node tones and directory counts', () => {
    const status: WorktreeStatus[] = [
      { path: '/repo', isMain: true, entries: [{ x: ' ', y: 'M', path: 'src/App.tsx' }] },
    ]
    const index = buildFileTreeStatusIndex('/repo', status)
    expect(index.byPath.get('src/App.tsx')?.tone).toBe('attention')
    expect(index.directoryCounts.get('src')).toBe(1)
  })

  test('inserts deleted virtual nodes when real entry is missing', () => {
    const status: WorktreeStatus[] = [
      { path: '/repo', isMain: true, entries: [{ x: ' ', y: 'D', path: 'src/old.ts' }] },
    ]
    const index = buildFileTreeStatusIndex('/repo', status)
    const merged = mergeDirectoryEntries('/repo', 'src', [], index)
    expect(merged).toEqual([expect.objectContaining({ relativePath: 'src/old.ts', kind: 'virtual', tone: 'danger' })])
  })

  test('includes rename original path as virtual node', () => {
    const status: WorktreeStatus[] = [
      { path: '/repo', isMain: true, entries: [{ x: 'R', y: ' ', path: 'src/new.ts', originalPath: 'src/old.ts' }] },
    ]
    const index = buildFileTreeStatusIndex('/repo', status)
    const merged = mergeDirectoryEntries('/repo', 'src', entries.filter((entry) => entry.relativePath === 'src'), index)
    expect(merged.some((entry) => entry.relativePath === 'src/old.ts' && entry.kind === 'virtual')).toBe(true)
  })

  test('toggles and range-selects visible nodes', () => {
    const visible = ['a', 'b', 'c', 'd']
    let selection = nextFileTreeSelection({ selected: new Set(), anchor: null }, visible, 'b', {})
    expect([...selection.selected]).toEqual(['b'])
    selection = nextFileTreeSelection(selection, visible, 'd', { shiftKey: true })
    expect([...selection.selected]).toEqual(['b', 'c', 'd'])
  })

  test('builds drag payload from selected node paths', () => {
    expect(buildGoblinFilePathDragPayload(['/repo/a.ts', '/repo/b.ts'])).toBe(
      JSON.stringify({ paths: ['/repo/a.ts', '/repo/b.ts'] }),
    )
  })

  test('flattens visible ids from expanded tree state', () => {
    expect(visibleFileTreeNodeIds([{ id: 'root', children: [{ id: 'child' }], expanded: true }])).toEqual([
      'root',
      'child',
    ])
  })

  test('resolves paste targets from directory, file, virtual node, and empty area', () => {
    const directory = node({ kind: 'directory', absolutePath: '/repo/src', relativePath: 'src' })
    const file = node({ kind: 'file', absolutePath: '/repo/src/App.tsx', relativePath: 'src/App.tsx' })
    const virtual = node({ kind: 'virtual', absolutePath: '/repo/old.ts', relativePath: 'old.ts' })

    expect(resolveFileTreePasteTarget('/repo', directory)).toBe('/repo/src')
    expect(resolveFileTreePasteTarget('/repo', file)).toBe('/repo/src')
    expect(resolveFileTreePasteTarget('/repo', virtual)).toBe('/repo')
    expect(resolveFileTreePasteTarget('/repo', null)).toBe('/repo')
  })

  test('returns parent directory paths for posix and windows separators', () => {
    expect(parentDirectoryPath('/repo/src/App.tsx')).toBe('/repo/src')
    expect(parentDirectoryPath('C:\\repo\\src\\App.tsx')).toBe('C:\\repo\\src')
  })

  test('generates stable paste filenames by mime type', () => {
    const date = new Date('2026-06-13T07:08:09Z')
    expect(generatedPasteFileName('image/png', date)).toBe('pasted-image-20260613-070809.png')
    expect(generatedPasteFileName('image/jpeg', date)).toBe('pasted-image-20260613-070809.jpg')
    expect(generatedPasteFileName('image/webp', date)).toBe('pasted-image-20260613-070809.webp')
    expect(generatedPasteFileName('text/plain', date)).toBe('pasted-text-20260613-070809.txt')
  })
})

function node(overrides: Partial<FileTreeNode>): FileTreeNode {
  return {
    id: overrides.relativePath ?? 'item',
    name: 'item',
    absolutePath: '/repo/item',
    relativePath: 'item',
    kind: 'file',
    ...overrides,
  }
}
