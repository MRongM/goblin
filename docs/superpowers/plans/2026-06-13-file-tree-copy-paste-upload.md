# File Tree Copy, Paste, and Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build file-tree copy, paste, and upload support for local and remote repository worktrees.

**Architecture:** Keep the renderer focused on interaction state and event parsing. Route every write through a server-side transfer module that validates source and target containment, enforces size limits, resolves automatic copy names, and dispatches to local filesystem or SSH helpers. The transfer contract is shared so local, remote, clipboard, and drag/drop flows use one behavioral path.

**Tech Stack:** React, Zustand, Hono, Electron preload/native bridge, Node filesystem APIs, SSH command helpers, Vitest, Bun.

---

## Repository Constraint

This repository's `AGENTS.md` says not to plan or execute git commits unless the user explicitly asks for them. This plan intentionally uses verification checkpoints instead of commit steps.

## Scope Check

The approved spec is broad, but it is one coherent feature: file tree transfer writes. The implementation is split into independently verifiable tasks:

1. Shared transfer contract and client API.
2. Renderer helper modules for copy, paste, target resolution, and drops.
3. Local transfer engine.
4. Server route/module for local transfers.
5. File tree UI integration.
6. Remote transfer command helpers.
7. Server remote dispatch and final verification.

Each task should keep existing layer boundaries green.

## File Structure

- Modify `src/shared/file-tree.ts`
  - Own shared MIME constants, transfer limits, request/response types, payload parsers, and generated filename helpers that do not depend on browser or Node APIs.
- Modify `src/web/repo-client.ts`
  - Add `transferRepositoryFiles()` as the only web client entry point for file transfer writes.
- Modify `src/web/repo-client.test.ts`
  - Cover the new route request shape.
- Create `src/web/components/file-tree/clipboard.ts`
  - Own platform primary shortcut detection, internal file tree clipboard state, external paste extraction, and upload item creation.
- Create `src/web/components/file-tree/drop-target.ts`
  - Own target directory resolution from a node, selection, or blank pane.
- Modify `src/web/components/file-tree/model.ts`
  - Add pure helpers used by clipboard/drop modules and tests.
- Modify `src/web/components/file-tree/model.test.ts`
  - Cover target directory and generated name behavior.
- Modify `src/web/components/file-tree/ProjectFileTree.tsx`
  - Wire keyboard, paste, and drop interactions to repo-client.
- Modify `src/web/components/file-tree/ProjectFileTree.test.tsx`
  - Cover UI event behavior and target resolution.
- Create `src/system/file-tree/transfer.ts`
  - Own local inventory, local copy, uploaded bytes write, symlink handling, size checks, and conflict-free names.
- Create `src/system/file-tree/transfer.test.ts`
  - Cover local transfer behavior.
- Create `src/server/modules/repo-file-transfer.ts`
  - Own request validation, backend dispatch, invalidation, and per-entry results.
- Create `src/server/modules/repo-file-transfer.test.ts`
  - Cover server orchestration and validation.
- Modify `src/server/routes/repo.ts`
  - Add `POST /file-transfer`.
- Modify `src/system/ssh/commands.ts`
  - Add fixed remote inventory/read/write/copy commands and stdin/maxBuffer support where needed.
- Modify `src/system/ssh/commands.test.ts`
  - Cover remote command rendering and quoting.
- Modify `src/system/ssh/git.ts`
  - Add remote file transfer helper functions.
- Modify `src/system/ssh/git.test.ts`
  - Cover remote transfer JSON parsing and command dispatch.
- Modify `src/shared/i18n/en.ts`, `src/shared/i18n/zh.ts`, `src/shared/i18n/ja.ts`, `src/shared/i18n/ko.ts`
  - Add transfer success/error labels.

## Task 1: Shared Transfer Contract and Client API

**Files:**
- Modify: `src/shared/file-tree.ts`
- Modify: `src/web/repo-client.ts`
- Modify: `src/web/repo-client.test.ts`

- [ ] **Step 1: Write the failing repo-client test**

Add this test to `src/web/repo-client.test.ts` after the existing `requests repository file tree` test:

```ts
  test('requests repository file transfer', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        copied: [{ sourcePath: '/repo/a.txt', destinationPath: '/repo/docs/a.txt', kind: 'file' }],
        renamed: [],
        failed: [],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { transferRepositoryFiles } = await import('#/web/repo-client.ts')
    const result = await transferRepositoryFiles({
      repoId: '/repo',
      worktreePath: '/repo',
      targetDirPath: '/repo/docs',
      source: { kind: 'fileTreePaths', repoId: '/repo', worktreePath: '/repo', paths: ['/repo/a.txt'] },
    })

    expect(result).toEqual({
      ok: true,
      copied: [{ sourcePath: '/repo/a.txt', destinationPath: '/repo/docs/a.txt', kind: 'file' }],
      renamed: [],
      failed: [],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/file-transfer',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
        body: JSON.stringify({
          repoId: '/repo',
          worktreePath: '/repo',
          targetDirPath: '/repo/docs',
          source: { kind: 'fileTreePaths', repoId: '/repo', worktreePath: '/repo', paths: ['/repo/a.txt'] },
        }),
      }),
    )
  })
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun run test src/web/repo-client.test.ts
```

Expected: FAIL because `transferRepositoryFiles` is not exported.

- [ ] **Step 3: Add shared transfer types**

Append these definitions to `src/shared/file-tree.ts`:

```ts
export const FILE_TRANSFER_MAX_FILE_BYTES = 100 * 1024 * 1024
export const FILE_TRANSFER_MAX_TOTAL_BYTES = 500 * 1024 * 1024

export type RepoFileTransferEntryKind = 'file' | 'directory' | 'symlink'

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
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<RepoFileTransferRequest>
  if (typeof input.repoId !== 'string' || typeof input.worktreePath !== 'string' || typeof input.targetDirPath !== 'string') {
    return false
  }
  const source = input.source as Partial<RepoFileTransferSource> | undefined
  if (!source || typeof source !== 'object') return false
  if (source.kind === 'fileTreePaths') {
    return (
      typeof source.repoId === 'string' &&
      typeof source.worktreePath === 'string' &&
      Array.isArray(source.paths) &&
      source.paths.every((path) => typeof path === 'string')
    )
  }
  if (source.kind === 'localPaths') {
    return Array.isArray(source.paths) && source.paths.every((path) => typeof path === 'string')
  }
  if (source.kind === 'uploadedItems') {
    return (
      Array.isArray(source.items) &&
      source.items.every((item) => {
        return (
          item &&
          typeof item === 'object' &&
          typeof item.name === 'string' &&
          typeof item.bytesBase64 === 'string' &&
          typeof item.byteLength === 'number' &&
          (typeof item.mimeType === 'undefined' || typeof item.mimeType === 'string')
        )
      })
    )
  }
  return false
}
```

- [ ] **Step 4: Add the repo client method**

Update the import in `src/web/repo-client.ts`:

```ts
import type { RepoFileTransferRequest, RepoFileTransferResult, RepoFileTreeResult } from '#/shared/file-tree.ts'
```

Add this function near `getRepositoryFileTree()`:

```ts
export async function transferRepositoryFiles(input: RepoFileTransferRequest): Promise<RepoFileTransferResult> {
  return await postServerJson('/api/repo/file-transfer', input)
}
```

- [ ] **Step 5: Run the repo-client test**

Run:

```bash
bun run test src/web/repo-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run:

```bash
git diff -- src/shared/file-tree.ts src/web/repo-client.ts src/web/repo-client.test.ts
```

Expected: diff only contains shared transfer types and the client method/test.

## Task 2: File Tree Clipboard and Target Helpers

**Files:**
- Create: `src/web/components/file-tree/clipboard.ts`
- Create: `src/web/components/file-tree/drop-target.ts`
- Modify: `src/web/components/file-tree/model.ts`
- Modify: `src/web/components/file-tree/model.test.ts`

- [ ] **Step 1: Write failing model tests**

Add these imports to `src/web/components/file-tree/model.test.ts`:

```ts
import {
  generatedPasteFileName,
  parentDirectoryPath,
  resolveFileTreePasteTarget,
} from '#/web/components/file-tree/model.ts'
import type { FileTreeNode } from '#/web/components/file-tree/model.ts'
```

Add these tests inside `describe('file tree model', () => { ... })`:

```ts
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
```

Add this helper at the bottom of the test file:

```ts
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
```

- [ ] **Step 2: Run the failing model test**

Run:

```bash
bun run test src/web/components/file-tree/model.test.ts
```

Expected: FAIL because the new helper exports do not exist.

- [ ] **Step 3: Add pure helper implementations**

Append these helpers to `src/web/components/file-tree/model.ts`:

```ts
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
```

- [ ] **Step 4: Create clipboard helper module**

Create `src/web/components/file-tree/clipboard.ts`:

```ts
import {
  FILE_TRANSFER_MAX_FILE_BYTES,
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
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (!file || file.size > FILE_TRANSFER_MAX_FILE_BYTES) continue
      uploaded.push(await uploadedItemFromFile(file))
    } else if (item.kind === 'string' && item.type === 'text/plain') {
      const text = await clipboardString(item)
      const bytes = new TextEncoder().encode(text)
      if (bytes.byteLength <= FILE_TRANSFER_MAX_FILE_BYTES) {
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
```

- [ ] **Step 5: Create drop target helper module**

Create `src/web/components/file-tree/drop-target.ts`:

```ts
import type { FileTreeNode } from '#/web/components/file-tree/model.ts'
import { resolveFileTreePasteTarget } from '#/web/components/file-tree/model.ts'

export function resolveDropTargetDirectory(worktreePath: string, node: FileTreeNode | null): string {
  return resolveFileTreePasteTarget(worktreePath, node)
}
```

- [ ] **Step 6: Run helper tests**

Run:

```bash
bun run test src/web/components/file-tree/model.test.ts
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run:

```bash
git diff -- src/web/components/file-tree/model.ts src/web/components/file-tree/model.test.ts src/web/components/file-tree/clipboard.ts src/web/components/file-tree/drop-target.ts
```

Expected: diff only contains helper modules and pure helper tests.

## Task 3: Local File Transfer Engine

**Files:**
- Create: `src/system/file-tree/transfer.ts`
- Create: `src/system/file-tree/transfer.test.ts`

- [ ] **Step 1: Write failing local transfer tests**

Create `src/system/file-tree/transfer.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  commonAbsolutePathAncestor,
  copyLocalPathsToLocalTarget,
  decodeUploadedItem,
  inventoryLocalTransfer,
  uniqueCopyName,
  writeUploadedItemsToLocalTarget,
} from '#/system/file-tree/transfer.ts'

describe('uniqueCopyName', () => {
  test('creates copy names for files and directories', () => {
    expect(uniqueCopyName(new Set(['file.txt']), 'file.txt')).toBe('file copy.txt')
    expect(uniqueCopyName(new Set(['file.txt', 'file copy.txt']), 'file.txt')).toBe('file copy 2.txt')
    expect(uniqueCopyName(new Set(['src']), 'src')).toBe('src copy')
  })

  test('finds a common absolute ancestor for local source paths', () => {
    expect(commonAbsolutePathAncestor(['/tmp/project/a.txt', '/tmp/project/docs/b.txt'])).toBe('/tmp/project')
  })
})

describe('local file transfer', () => {
  test('copies files and directories recursively without overwriting conflicts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-transfer-'))
    await mkdir(join(root, 'src', 'nested'), { recursive: true })
    await mkdir(join(root, 'dest'))
    await writeFile(join(root, 'src', 'nested', 'a.txt'), 'hello')
    await writeFile(join(root, 'dest', 'src'), 'existing')

    const result = await copyLocalPathsToLocalTarget({
      sourceRootPath: root,
      targetRootPath: root,
      targetDirPath: join(root, 'dest'),
      paths: [join(root, 'src')],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.renamed).toEqual([
      expect.objectContaining({ requestedName: 'src', destinationName: 'src copy' }),
    ])
    await expect(readFile(join(root, 'dest', 'src copy', 'nested', 'a.txt'), 'utf8')).resolves.toBe('hello')
  })

  test('writes uploaded bytes to the target directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-transfer-'))
    const item = { name: 'pasted.txt', mimeType: 'text/plain', bytesBase64: Buffer.from('hello').toString('base64'), byteLength: 5 }

    const result = await writeUploadedItemsToLocalTarget({
      targetRootPath: root,
      targetDirPath: root,
      items: [item],
    })

    expect(result.ok).toBe(true)
    await expect(readFile(join(root, 'pasted.txt'), 'utf8')).resolves.toBe('hello')
  })

  test('rejects paths outside the source root before writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-transfer-'))
    const outside = await mkdtemp(join(tmpdir(), 'goblin-file-transfer-outside-'))

    const result = await copyLocalPathsToLocalTarget({
      sourceRootPath: root,
      targetRootPath: root,
      targetDirPath: root,
      paths: [outside],
    })

    expect(result).toEqual({ ok: false, message: 'error.file-transfer-source-outside-worktree' })
  })

  test('counts symlinks without following them outside the source root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-transfer-'))
    const outside = await mkdtemp(join(tmpdir(), 'goblin-file-transfer-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))

    const inventory = await inventoryLocalTransfer({ rootPath: root, paths: [join(root, 'link.txt')] })

    expect(inventory.ok).toBe(true)
    if (!inventory.ok) return
    expect(inventory.entries).toEqual([
      expect.objectContaining({ kind: 'symlink', sourcePath: join(root, 'link.txt') }),
    ])
  })

  test('decodes uploaded base64 with byte length validation', () => {
    expect(decodeUploadedItem({
      name: 'a.txt',
      bytesBase64: Buffer.from('hello').toString('base64'),
      byteLength: 5,
    })).toEqual(Buffer.from('hello'))
    expect(decodeUploadedItem({
      name: 'a.txt',
      bytesBase64: Buffer.from('hello').toString('base64'),
      byteLength: 4,
    })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the failing transfer test**

Run:

```bash
bun run test src/system/file-tree/transfer.test.ts
```

Expected: FAIL because `src/system/file-tree/transfer.ts` does not exist.

- [ ] **Step 3: Implement the local transfer engine**

Create `src/system/file-tree/transfer.ts`:

```ts
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

interface LocalInventoryOptions {
  rootPath: string
  paths: string[]
}

interface LocalCopyOptions {
  sourceRootPath: string
  targetRootPath: string
  targetDirPath: string
  paths: string[]
}

interface LocalUploadOptions {
  targetRootPath: string
  targetDirPath: string
  items: RepoFileTransferUploadedItem[]
}

interface LocalInventoryEntry {
  sourcePath: string
  relativePath: string
  kind: 'file' | 'directory' | 'symlink'
  size: number
}

type LocalInventoryResult =
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

export function decodeUploadedItem(item: Pick<RepoFileTransferUploadedItem, 'bytesBase64' | 'byteLength'>): Buffer | null {
  const buffer = Buffer.from(item.bytesBase64, 'base64')
  return buffer.byteLength === item.byteLength ? buffer : null
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
```

- [ ] **Step 4: Run local transfer tests**

Run:

```bash
bun run test src/system/file-tree/transfer.test.ts src/system/file-tree/local.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run:

```bash
git diff -- src/system/file-tree/transfer.ts src/system/file-tree/transfer.test.ts
```

Expected: diff only contains local transfer helpers and tests.

## Task 4: Server Transfer Route for Local Targets

**Files:**
- Create: `src/server/modules/repo-file-transfer.ts`
- Create: `src/server/modules/repo-file-transfer.test.ts`
- Modify: `src/server/routes/repo.ts`

- [ ] **Step 1: Write failing server module tests**

Create `src/server/modules/repo-file-transfer.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { transferRepositoryFiles } from '#/server/modules/repo-file-transfer.ts'

describe('transferRepositoryFiles', () => {
  test('copies internal local file tree paths to a local target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-server-transfer-'))
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'a.txt'), 'hello')

    const result = await transferRepositoryFiles({
      repoId: root,
      worktreePath: root,
      targetDirPath: join(root, 'docs'),
      source: { kind: 'fileTreePaths', repoId: root, worktreePath: root, paths: [join(root, 'a.txt')] },
    })

    expect(result.ok).toBe(true)
    await expect(readFile(join(root, 'docs', 'a.txt'), 'utf8')).resolves.toBe('hello')
  })

  test('writes uploaded items to a local target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-server-transfer-'))
    const result = await transferRepositoryFiles({
      repoId: root,
      worktreePath: root,
      targetDirPath: root,
      source: {
        kind: 'uploadedItems',
        items: [{ name: 'pasted.txt', bytesBase64: Buffer.from('hello').toString('base64'), byteLength: 5 }],
      },
    })

    expect(result.ok).toBe(true)
    await expect(readFile(join(root, 'pasted.txt'), 'utf8')).resolves.toBe('hello')
  })

  test('rejects target paths outside the worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-server-transfer-'))
    const outside = await mkdtemp(join(tmpdir(), 'goblin-server-transfer-outside-'))

    const result = await transferRepositoryFiles({
      repoId: root,
      worktreePath: root,
      targetDirPath: outside,
      source: { kind: 'localPaths', paths: [root] },
    })

    expect(result).toEqual({ ok: false, message: 'error.file-transfer-target-outside-worktree' })
  })
})
```

- [ ] **Step 2: Run the failing server module test**

Run:

```bash
bun run test src/server/modules/repo-file-transfer.test.ts
```

Expected: FAIL because `repo-file-transfer.ts` does not exist.

- [ ] **Step 3: Implement the server transfer module**

Create `src/server/modules/repo-file-transfer.ts`:

```ts
import { publishRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import {
  isRepoFileTransferRequest,
  type RepoFileTransferRequest,
  type RepoFileTransferResult,
} from '#/shared/file-tree.ts'
import { isRemoteRepoId } from '#/shared/rpc.ts'
import { commonAbsolutePathAncestor, copyLocalPathsToLocalTarget, writeUploadedItemsToLocalTarget } from '#/system/file-tree/transfer.ts'

export async function transferRepositoryFiles(input: RepoFileTransferRequest): Promise<RepoFileTransferResult> {
  if (!isRepoFileTransferRequest(input)) return { ok: false, message: 'error.invalid-arguments' }
  if (isRemoteRepoId(input.repoId)) return { ok: false, message: 'error.file-transfer-remote-unsupported' }
  const result = await transferLocalTarget(input)
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
```

- [ ] **Step 4: Wire the route**

Modify imports in `src/server/routes/repo.ts`:

```ts
import { transferRepositoryFiles } from '#/server/modules/repo-file-transfer.ts'
```

Add this route after `/file-tree`:

```ts
  app.post('/file-transfer', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(
      await jsonOr(
        () => transferRepositoryFiles(body),
        { ok: false, message: 'error.failed-read-repo' },
        'file-transfer',
      ),
    )
  })
```

- [ ] **Step 5: Run server transfer tests**

Run:

```bash
bun run test src/server/modules/repo-file-transfer.test.ts src/server/modules/repo-file-tree.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run architecture check**

Run:

```bash
bun run check:architecture
```

Expected: PASS. If it fails, move imports so `src/web/**` does not leak into server/main layers.

- [ ] **Step 7: Checkpoint**

Run:

```bash
git diff -- src/server/modules/repo-file-transfer.ts src/server/modules/repo-file-transfer.test.ts src/server/routes/repo.ts
```

Expected: diff only contains the server transfer module, tests, and route.

## Task 5: File Tree UI Copy, Paste, and Drop Integration

**Files:**
- Modify: `src/web/components/file-tree/ProjectFileTree.tsx`
- Modify: `src/web/components/file-tree/ProjectFileTree.test.tsx`
- Modify: `src/shared/i18n/en.ts`
- Modify: `src/shared/i18n/zh.ts`
- Modify: `src/shared/i18n/ja.ts`
- Modify: `src/shared/i18n/ko.ts`

- [ ] **Step 1: Write failing component tests**

Update the mock in `src/web/components/file-tree/ProjectFileTree.test.tsx`:

```ts
const transferRepositoryFiles = vi.fn(async () => ({
  ok: true as const,
  copied: [{ destinationPath: '/repo/docs/README.md', kind: 'file' as const }],
  renamed: [],
  failed: [],
}))
```

Add it to the `vi.mock('#/web/repo-client.ts', ...)` return:

```ts
  transferRepositoryFiles: (...args: unknown[]) => transferRepositoryFiles(...args),
```

Add `transferRepositoryFiles.mockClear()` in `beforeEach()`.

Add these tests:

```ts
  test('copies selected paths and pastes them to a selected directory', async () => {
    seedRepoWithSelectedBranch({ hasWorktree: true })
    await render(<ProjectFileTree repoId="/repo" />)

    const file = treeItemByText('README.md')
    const directory = treeItemByText('src')
    await act(async () => {
      file.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      file.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'c', metaKey: true }))
      directory.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      directory.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'v', metaKey: true }))
      await Promise.resolve()
    })

    expect(transferRepositoryFiles).toHaveBeenCalledWith({
      repoId: '/repo',
      worktreePath: '/repo',
      targetDirPath: '/repo/src',
      source: { kind: 'fileTreePaths', repoId: '/repo', worktreePath: '/repo', paths: ['/repo/README.md'] },
    })
  })

  test('drops operating system files onto a directory target', async () => {
    seedRepoWithSelectedBranch({ hasWorktree: true })
    await render(<ProjectFileTree repoId="/repo" />)

    const directory = treeItemByText('src')
    const file = new File(['hello'], 'local.txt', { type: 'text/plain' })
    await act(async () => {
      directory.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      }))
      await Promise.resolve()
    })

    expect(transferRepositoryFiles).not.toHaveBeenCalled()
    void file
  })
```

Then replace the second test with a local helper that constructs a drop event in jsdom if `DataTransfer` is unavailable:

```ts
function dropFiles(target: HTMLElement, files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files,
      types: ['Files'],
      dropEffect: 'copy',
    },
  })
  target.dispatchEvent(event)
}
```

Use:

```ts
      dropFiles(directory, [file])
```

Mock `pathForDroppedFile` through `vi.mock('#/web/app-shell-client.ts', ...)` if the test cannot reach the real bridge:

```ts
vi.mock('#/web/app-shell-client.ts', () => ({
  pathForDroppedFile: (file: File) => `/tmp/${file.name}`,
}))
```

Expected test assertion for the drop:

```ts
    expect(transferRepositoryFiles).toHaveBeenCalledWith({
      repoId: '/repo',
      worktreePath: '/repo',
      targetDirPath: '/repo/src',
      source: { kind: 'localPaths', paths: ['/tmp/local.txt'] },
    })
```

- [ ] **Step 2: Run the failing component test**

Run:

```bash
bun run test src/web/components/file-tree/ProjectFileTree.test.tsx
```

Expected: FAIL because `ProjectFileTree` does not handle keydown/drop transfer behavior.

- [ ] **Step 3: Add transfer wiring to `ProjectFileTree`**

Update imports in `src/web/components/file-tree/ProjectFileTree.tsx`:

```ts
import type { ClipboardEvent, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { sourceFromClipboardEvent, sourceFromDroppedFiles, isPrimaryShortcut, readInternalFileTreeClipboard, writeInternalFileTreeClipboard } from '#/web/components/file-tree/clipboard.ts'
import { resolveDropTargetDirectory } from '#/web/components/file-tree/drop-target.ts'
import { resolveFileTreePasteTarget } from '#/web/components/file-tree/model.ts'
```

Update the repo-client import:

```ts
import { getRepositoryFileTree, openRepositoryEditor, openRepositoryTerminal, transferRepositoryFiles } from '#/web/repo-client.ts'
```

Add a `focusedNodeId` state:

```ts
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
```

Add helpers inside `ProjectFileTree`:

```ts
  const selectedPaths = useCallback(() => {
    return Array.from(selection.selected)
      .map((id) => flatNodeById.get(id)?.absolutePath)
      .filter((path): path is string => !!path)
  }, [flatNodeById, selection.selected])

  const pasteTargetNode = useCallback(() => {
    if (focusedNodeId) return flatNodeById.get(focusedNodeId) ?? null
    const firstSelected = Array.from(selection.selected)[0]
    return firstSelected ? flatNodeById.get(firstSelected) ?? null : null
  }, [flatNodeById, focusedNodeId, selection.selected])

  const runTransfer = useCallback(
    async (targetDirPath: string, source = readInternalFileTreeClipboard()) => {
      if (!worktreePath || !source) return
      const result = await transferRepositoryFiles({ repoId, worktreePath, targetDirPath, source })
      if (result.ok) void loadDirectory(relativeDirPath(worktreePath, targetDirPath), targetDirPath)
    },
    [loadDirectory, repoId, worktreePath],
  )

  const handleKeyDown = useCallback(
    (node: FileTreeNode, event: KeyboardEvent) => {
      if (!worktreePath || !isPrimaryShortcut(event.nativeEvent)) return
      const key = event.key.toLowerCase()
      if (key === 'c') {
        event.preventDefault()
        writeInternalFileTreeClipboard({ repoId, worktreePath, paths: selectedPaths().length > 0 ? selectedPaths() : [node.absolutePath] })
      } else if (key === 'v') {
        event.preventDefault()
        void runTransfer(resolveFileTreePasteTarget(worktreePath, pasteTargetNode()))
      }
    },
    [pasteTargetNode, repoId, runTransfer, selectedPaths, worktreePath],
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
      const targetDirPath = resolveDropTargetDirectory(worktreePath, node)
      void runTransfer(targetDirPath, source)
    },
    [runTransfer, worktreePath],
  )
```

Add this local helper near `parentPath()`:

```ts
function relativeDirPath(worktreePath: string, dirPath: string): string {
  const normalizedRoot = worktreePath.replace(/[\\/]+$/, '')
  const normalizedDir = dirPath.replace(/[\\/]+$/, '')
  if (normalizedDir === normalizedRoot) return ROOT_DIR
  return normalizedDir.slice(normalizedRoot.length + 1).split('\\').join('/')
}
```

Wire the root container:

```tsx
    <div
      className="flex min-h-0 flex-1 flex-col bg-background"
      data-repo-id={repoId}
      onPaste={handlePaste}
      onDrop={(event) => handleDrop(null, event)}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
    >
```

Pass `onKeyDown`, `onFocus`, and row drop handlers into `FileTreeRow`. Add props:

```ts
  onKeyDown: (node: FileTreeNode, event: KeyboardEvent) => void
  onFocus: (node: FileTreeNode) => void
  onDrop: (node: FileTreeNode, event: DragEvent<HTMLDivElement>) => void
```

On the row `<div>` add:

```tsx
        tabIndex={0}
        onFocus={() => onFocus(node)}
        onKeyDown={(event) => onKeyDown(node, event)}
        onDrop={(event) => onDrop(node, event)}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }
        }}
```

Keep child recursion passing the same handlers.

- [ ] **Step 4: Add i18n strings**

Add these English strings near existing file tree strings in `src/shared/i18n/en.ts`:

```ts
  'file-tree.transfer-copied': 'Copied {count} item(s)',
  'file-tree.transfer-partial': 'Copied {count} item(s), {failed} failed',
  'error.file-transfer-file-too-large': 'A file is too large to copy.',
  'error.file-transfer-total-too-large': 'The selected items are too large to copy together.',
  'error.file-transfer-source-outside-worktree': 'Source is outside the worktree.',
  'error.file-transfer-target-outside-worktree': 'Target is outside the worktree.',
  'error.file-transfer-remote-unsupported': 'Remote file transfer is unavailable.',
```

Add equivalent keys to `zh.ts`, `ja.ts`, and `ko.ts`. Keep exact keys aligned.

- [ ] **Step 5: Run component tests**

Run:

```bash
bun run test src/web/components/file-tree/ProjectFileTree.test.tsx src/web/components/file-tree/model.test.ts
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run:

```bash
git diff -- src/web/components/file-tree/ProjectFileTree.tsx src/web/components/file-tree/ProjectFileTree.test.tsx src/shared/i18n/en.ts src/shared/i18n/zh.ts src/shared/i18n/ja.ts src/shared/i18n/ko.ts
```

Expected: diff only contains UI transfer wiring, tests, and i18n keys.

## Task 6: Remote Transfer Command Helpers

**Files:**
- Modify: `src/system/ssh/commands.ts`
- Modify: `src/system/ssh/commands.test.ts`
- Modify: `src/system/ssh/git.ts`
- Modify: `src/system/ssh/git.test.ts`

- [ ] **Step 1: Write failing remote command tests**

Add these tests to `src/system/ssh/commands.test.ts`:

```ts
  test('builds quoted remote file inventory command', () => {
    const invocation = buildRemoteCommandInvocation(TARGET, {
      type: 'fileTransferInventory',
      rootPath: '/srv/repo',
      paths: ['/srv/repo/src', "/srv/repo/file with 'quote'.txt"],
    })
    expect(invocation.script).toContain('python3')
    expect(invocation.script).toContain('fileTransferInventory')
    expect(invocation.script).toContain('"/srv/repo"')
    expect(invocation.args).toContain(TARGET.alias)
  })

  test('builds remote uploaded file write command', () => {
    const invocation = buildRemoteCommandInvocation(TARGET, {
      type: 'fileTransferWriteBase64',
      targetPath: '/srv/repo/pasted.txt',
    })
    expect(invocation.script).toContain('base64')
    expect(invocation.script).toContain('/srv/repo/pasted.txt')
  })
```

- [ ] **Step 2: Run failing remote command tests**

Run:

```bash
bun run test src/system/ssh/commands.test.ts
```

Expected: FAIL because the command types do not exist.

- [ ] **Step 3: Extend remote command types and runner options**

In `src/system/ssh/commands.ts`, extend `RemoteCommandKind`:

```ts
  | { type: 'fileTransferInventory'; rootPath: string; paths: string[] }
  | { type: 'fileTransferReadBase64'; path: string }
  | { type: 'fileTransferWriteBase64'; targetPath: string }
  | { type: 'fileTransferMkdir'; targetPath: string }
  | { type: 'fileTransferSymlink'; linkPath: string; target: string }
```

Extend runner options:

```ts
  options?: { signal?: AbortSignal; timeoutMs?: number; stdin?: string; maxBuffer?: number },
```

Pass options into `execa()`:

```ts
      input: options?.stdin,
      maxBuffer: options?.maxBuffer ?? 2 * 1024 * 1024,
```

- [ ] **Step 4: Add fixed remote transfer scripts**

Add `scriptForCommand()` cases:

```ts
    case 'fileTransferInventory':
      return [
        '# fileTransferInventory',
        "python3 - <<'PY'",
        'import json, os, sys',
        `root = ${pythonString(command.rootPath)}`,
        `paths = ${JSON.stringify(command.paths)}`,
        'root_real = os.path.normpath(root)',
        'entries = []',
        'total = 0',
        'def inside(path):',
        "    return path == root_real or path.startswith(root_real.rstrip('/') + '/')",
        'def add(path):',
        '    global total',
        '    real = os.path.normpath(path)',
        '    if not inside(real):',
        '        print(json.dumps({"ok": False, "message": "error.file-transfer-source-outside-worktree"}))',
        '        sys.exit(0)',
        '    try:',
        '        st = os.lstat(real)',
        '    except FileNotFoundError:',
        '        print(json.dumps({"ok": False, "message": "error.path-not-found"}))',
        '        sys.exit(0)',
        '    if os.path.islink(real):',
        '        entries.append({"path": real, "relativePath": os.path.relpath(real, root_real), "kind": "symlink", "size": 0, "linkTarget": os.readlink(real)})',
        '    elif os.path.isdir(real):',
        '        entries.append({"path": real, "relativePath": os.path.relpath(real, root_real), "kind": "directory", "size": 0})',
        '        for name in os.listdir(real):',
        '            add(os.path.join(real, name))',
        '    elif os.path.isfile(real):',
        '        total += st.st_size',
        '        entries.append({"path": real, "relativePath": os.path.relpath(real, root_real), "kind": "file", "size": st.st_size})',
        '    else:',
        '        print(json.dumps({"ok": False, "message": "error.invalid-path"}))',
        '        sys.exit(0)',
        'for item in paths:',
        '    add(item)',
        'print(json.dumps({"ok": True, "entries": entries, "totalBytes": total}, ensure_ascii=False))',
        'PY',
      ].join('\n')
    case 'fileTransferReadBase64':
      return `base64 < ${shellQuote(command.path)}`
    case 'fileTransferWriteBase64':
      return `mkdir -p ${shellQuote(path.posix.dirname(command.targetPath))} && base64 -d > ${shellQuote(command.targetPath)}`
    case 'fileTransferMkdir':
      return `mkdir -p ${shellQuote(command.targetPath)}`
    case 'fileTransferSymlink':
      return `ln -s -- ${shellQuote(command.target)} ${shellQuote(command.linkPath)}`
```

- [ ] **Step 5: Write failing remote git helper tests**

Add this import to `src/system/ssh/git.test.ts`:

```ts
  inventoryRemoteFileTransfer,
  readRemoteFileBase64,
  writeRemoteFileBase64,
```

Add tests:

```ts
  test('inventories remote transfer paths', async () => {
    const run = vi.fn(async () =>
      okRemoteResult(JSON.stringify({
        ok: true,
        totalBytes: 5,
        entries: [{ path: '/srv/repo/a.txt', relativePath: 'a.txt', kind: 'file', size: 5 }],
      })),
    )

    const result = await inventoryRemoteFileTransfer(TARGET, '/srv/repo', ['/srv/repo/a.txt'], { run: run as any })

    expect(result).toEqual({
      ok: true,
      totalBytes: 5,
      entries: [{ path: '/srv/repo/a.txt', relativePath: 'a.txt', kind: 'file', size: 5 }],
    })
    expect(run).toHaveBeenCalledWith(
      { type: 'fileTransferInventory', rootPath: '/srv/repo', paths: ['/srv/repo/a.txt'] },
      TARGET,
      { signal: undefined, timeoutMs: 90_000 },
    )
  })

  test('reads and writes remote base64 files', async () => {
    const run = vi.fn(async () => okRemoteResult(Buffer.from('hello').toString('base64')))

    await expect(readRemoteFileBase64(TARGET, '/srv/repo/a.txt', { run: run as any })).resolves.toEqual({
      ok: true,
      bytesBase64: Buffer.from('hello').toString('base64'),
    })
    await expect(writeRemoteFileBase64(TARGET, '/srv/repo/b.txt', Buffer.from('hello').toString('base64'), { run: run as any })).resolves.toEqual({
      ok: true,
      message: '',
    })
  })
```

- [ ] **Step 6: Implement remote git helper functions**

Add to `src/system/ssh/git.ts`:

```ts
const REMOTE_FILE_TRANSFER_TIMEOUT_MS = 90_000
const REMOTE_FILE_TRANSFER_MAX_BUFFER = 160 * 1024 * 1024

export interface RemoteTransferInventoryEntry {
  path: string
  relativePath: string
  kind: 'file' | 'directory' | 'symlink'
  size: number
  linkTarget?: string
}

export type RemoteTransferInventoryResult =
  | { ok: true; entries: RemoteTransferInventoryEntry[]; totalBytes: number }
  | { ok: false; message: string }

interface RemoteTransferInventoryJson {
  ok?: boolean
  message?: string
  totalBytes?: unknown
  entries?: Array<Partial<RemoteTransferInventoryEntry>>
}

export async function inventoryRemoteFileTransfer(
  target: RemoteRepoTarget,
  rootPath: string,
  paths: string[],
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<RemoteTransferInventoryResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'fileTransferInventory', rootPath, paths }, target, {
    signal: options.signal,
    timeoutMs: REMOTE_FILE_TRANSFER_TIMEOUT_MS,
  })
  if (!result.ok && !result.stdout) return { ok: false, message: result.message || 'error.failed-read-repo' }
  let parsed: RemoteTransferInventoryJson
  try {
    parsed = JSON.parse(result.stdout) as RemoteTransferInventoryJson
  } catch {
    return { ok: false, message: 'error.failed-read-repo' }
  }
  if (parsed.ok !== true) return { ok: false, message: parsed.message || 'error.failed-read-repo' }
  const entries = (parsed.entries ?? []).filter((entry): entry is RemoteTransferInventoryEntry => {
    return (
      typeof entry.path === 'string' &&
      typeof entry.relativePath === 'string' &&
      (entry.kind === 'file' || entry.kind === 'directory' || entry.kind === 'symlink') &&
      typeof entry.size === 'number' &&
      (entry.linkTarget === undefined || typeof entry.linkTarget === 'string')
    )
  })
  return { ok: true, entries, totalBytes: typeof parsed.totalBytes === 'number' ? parsed.totalBytes : 0 }
}

export async function readRemoteFileBase64(
  target: RemoteRepoTarget,
  path: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<{ ok: true; bytesBase64: string } | { ok: false; message: string }> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'fileTransferReadBase64', path }, target, {
    signal: options.signal,
    timeoutMs: REMOTE_FILE_TRANSFER_TIMEOUT_MS,
    maxBuffer: REMOTE_FILE_TRANSFER_MAX_BUFFER,
  })
  return result.ok ? { ok: true, bytesBase64: result.stdout.replace(/\s+/g, '') } : remoteExecResult(result)
}

export async function writeRemoteFileBase64(
  target: RemoteRepoTarget,
  targetPath: string,
  bytesBase64: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'fileTransferWriteBase64', targetPath }, target, {
    signal: options.signal,
    timeoutMs: REMOTE_FILE_TRANSFER_TIMEOUT_MS,
    stdin: bytesBase64,
  })
  return remoteExecResult(result)
}
```

- [ ] **Step 7: Run remote tests**

Run:

```bash
bun run test src/system/ssh/commands.test.ts src/system/ssh/git.test.ts
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

Run:

```bash
git diff -- src/system/ssh/commands.ts src/system/ssh/commands.test.ts src/system/ssh/git.ts src/system/ssh/git.test.ts
```

Expected: diff only contains remote file transfer command/helper changes.

## Task 7: Server Remote Transfer Dispatch

**Files:**
- Modify: `src/server/modules/repo-file-transfer.ts`
- Modify: `src/server/modules/repo-file-transfer.test.ts`

- [ ] **Step 1: Write failing server remote dispatch tests**

Add these mocks near the top of `src/server/modules/repo-file-transfer.test.ts`:

```ts
const writeRemoteFileBase64 = vi.fn(async () => ({ ok: true, message: '' }))
const readRemoteFileBase64 = vi.fn(async () => ({ ok: true as const, bytesBase64: Buffer.from('remote').toString('base64') }))
const inventoryRemoteFileTransfer = vi.fn(async () => ({
  ok: true as const,
  totalBytes: 6,
  entries: [{ path: '/srv/repo/a.txt', relativePath: 'a.txt', kind: 'file' as const, size: 6 }],
}))

vi.mock('#/server/modules/repo-backend.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/server/modules/repo-backend.ts')>()
  return {
    ...actual,
    resolveRemoteRepoTarget: vi.fn(async () => ({
      alias: 'prod',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })),
  }
})

vi.mock('#/system/ssh/git.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/system/ssh/git.ts')>()
  return {
    ...actual,
    inventoryRemoteFileTransfer: (...args: unknown[]) => inventoryRemoteFileTransfer(...args),
    readRemoteFileBase64: (...args: unknown[]) => readRemoteFileBase64(...args),
    writeRemoteFileBase64: (...args: unknown[]) => writeRemoteFileBase64(...args),
    listRemoteFileTreeDirectory: vi.fn(async () => ({ ok: true, worktreePath: '/srv/repo', dirPath: '/srv/repo/docs', entries: [] })),
  }
})
```

Add these tests:

```ts
  test('writes uploaded items to a remote target', async () => {
    const result = await transferRepositoryFiles({
      repoId: 'remote:prod:/srv/repo',
      worktreePath: '/srv/repo',
      targetDirPath: '/srv/repo/docs',
      source: {
        kind: 'uploadedItems',
        items: [{ name: 'pasted.txt', bytesBase64: Buffer.from('hello').toString('base64'), byteLength: 5 }],
      },
    })

    expect(result).toEqual({
      ok: true,
      copied: [{ destinationPath: '/srv/repo/docs/pasted.txt', kind: 'file' }],
      renamed: [],
      failed: [],
    })
    expect(writeRemoteFileBase64).toHaveBeenCalledWith(
      expect.objectContaining({ alias: 'prod' }),
      '/srv/repo/docs/pasted.txt',
      Buffer.from('hello').toString('base64'),
    )
  })

  test('copies local files to a remote target through base64 writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-server-transfer-'))
    await writeFile(join(root, 'a.txt'), 'hello')

    const result = await transferRepositoryFiles({
      repoId: 'remote:prod:/srv/repo',
      worktreePath: '/srv/repo',
      targetDirPath: '/srv/repo/docs',
      source: { kind: 'localPaths', paths: [join(root, 'a.txt')] },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.copied).toEqual([{ sourcePath: join(root, 'a.txt'), destinationPath: '/srv/repo/docs/a.txt', kind: 'file' }])
  })

  test('copies remote files to a remote target through remote read and write helpers', async () => {
    const result = await transferRepositoryFiles({
      repoId: 'remote:prod:/srv/repo',
      worktreePath: '/srv/repo',
      targetDirPath: '/srv/repo/docs',
      source: { kind: 'fileTreePaths', repoId: 'remote:prod:/srv/repo', worktreePath: '/srv/repo', paths: ['/srv/repo/a.txt'] },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(readRemoteFileBase64).toHaveBeenCalledWith(expect.objectContaining({ alias: 'prod' }), '/srv/repo/a.txt')
    expect(writeRemoteFileBase64).toHaveBeenCalledWith(expect.objectContaining({ alias: 'prod' }), '/srv/repo/docs/a.txt', Buffer.from('remote').toString('base64'))
  })
```

- [ ] **Step 2: Run the failing server remote tests**

Run:

```bash
bun run test src/server/modules/repo-file-transfer.test.ts
```

Expected: FAIL because remote targets still return `error.file-transfer-remote-unsupported`.

- [ ] **Step 3: Implement complete remote dispatch**

Update imports in `src/server/modules/repo-file-transfer.ts`:

```ts
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
  type RepoFileTransferRenamedEntry,
  type RepoFileTransferRequest,
  type RepoFileTransferResult,
  type RepoFileTransferUploadedItem,
} from '#/shared/file-tree.ts'
import { isRemoteRepoId } from '#/shared/rpc.ts'
import { commonAbsolutePathAncestor, copyLocalPathsToLocalTarget, inventoryLocalTransfer, uniqueCopyName, writeUploadedItemsToLocalTarget } from '#/system/file-tree/transfer.ts'
import { inventoryRemoteFileTransfer, listRemoteFileTreeDirectory, readRemoteFileBase64, writeRemoteFileBase64 } from '#/system/ssh/git.ts'
```

Replace the body of `transferRepositoryFiles()` with:

```ts
export async function transferRepositoryFiles(input: RepoFileTransferRequest): Promise<RepoFileTransferResult> {
  if (!isRepoFileTransferRequest(input)) return { ok: false, message: 'error.invalid-arguments' }
  const result = isRemoteRepoId(input.repoId) ? await transferRemoteTarget(input) : await transferLocalTarget(input)
  if (result.ok && result.copied.length > 0) {
    publishRepoQueryInvalidation({ repoId: input.repoId, query: 'repo-snapshot' })
  }
  return result
}
```

Replace `transferLocalTarget()` with this version so remote-to-local is supported:

```ts
async function transferLocalTarget(input: RepoFileTransferRequest): Promise<RepoFileTransferResult> {
  switch (input.source.kind) {
    case 'fileTreePaths':
      if (isRemoteRepoId(input.source.repoId)) return await copyRemotePathsToLocalTarget(input)
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
```

Add these remote helpers:

```ts
async function transferRemoteTarget(input: RepoFileTransferRequest): Promise<RepoFileTransferResult> {
  switch (input.source.kind) {
    case 'uploadedItems':
      return await writeUploadedItemsToRemoteTarget(input)
    case 'localPaths':
      return await copyLocalPathsToRemoteTarget(input)
    case 'fileTreePaths':
      if (isRemoteRepoId(input.source.repoId)) return await copyRemotePathsToRemoteTarget(input)
      return await copyLocalPathsToRemoteTarget({
        ...input,
        source: { kind: 'localPaths', paths: input.source.paths },
      })
  }
}

async function writeUploadedItemsToRemoteTarget(input: RepoFileTransferRequest & { source: { kind: 'uploadedItems'; items: RepoFileTransferUploadedItem[] } }): Promise<RepoFileTransferResult> {
  const target = await resolveRemoteRepoTarget(input.repoId)
  const existing = await remoteDestinationNames(input)
  const copied: RepoFileTransferCopiedEntry[] = []
  const renamed: RepoFileTransferRenamedEntry[] = []
  const failed: RepoFileTransferFailedEntry[] = []
  let totalBytes = 0
  for (const item of input.source.items) {
    if (item.byteLength > FILE_TRANSFER_MAX_FILE_BYTES) return { ok: false, message: 'error.file-transfer-file-too-large' }
    totalBytes += item.byteLength
    if (totalBytes > FILE_TRANSFER_MAX_TOTAL_BYTES) return { ok: false, message: 'error.file-transfer-total-too-large' }
    const destinationName = uniqueCopyName(existing, item.name)
    existing.add(destinationName)
    const destinationPath = path.posix.join(input.targetDirPath, destinationName)
    if (destinationName !== item.name) renamed.push({ requestedName: item.name, destinationName, destinationPath })
    const result = await writeRemoteFileBase64(target, destinationPath, item.bytesBase64)
    if (result.ok) copied.push({ destinationPath, kind: 'file' })
    else failed.push({ name: item.name, message: result.message })
  }
  return { ok: true, copied, renamed, failed }
}

async function copyLocalPathsToRemoteTarget(input: RepoFileTransferRequest & { source: { kind: 'localPaths'; paths: string[] } }): Promise<RepoFileTransferResult> {
  const target = await resolveRemoteRepoTarget(input.repoId)
  const inventory = await inventoryLocalTransfer({ rootPath: commonAbsolutePathAncestor(input.source.paths), paths: input.source.paths })
  if (!inventory.ok) return inventory
  const existing = await remoteDestinationNames(input)
  const copied: RepoFileTransferCopiedEntry[] = []
  const renamed: RepoFileTransferRenamedEntry[] = []
  const failed: RepoFileTransferFailedEntry[] = []
  for (const sourcePath of input.source.paths) {
    const sourceName = path.basename(sourcePath)
    const destinationName = uniqueCopyName(existing, sourceName)
    existing.add(destinationName)
    const topDestination = path.posix.join(input.targetDirPath, destinationName)
    if (destinationName !== sourceName) renamed.push({ requestedName: sourceName, destinationName, destinationPath: topDestination })
    const entries = inventory.entries.filter((entry) => entry.sourcePath === sourcePath || entry.sourcePath.startsWith(sourcePath + path.sep))
    for (const entry of entries) {
      if (entry.kind !== 'file') continue
      const relative = entry.sourcePath === sourcePath ? '' : path.relative(sourcePath, entry.sourcePath).split(path.sep).join('/')
      const destinationPath = relative ? path.posix.join(topDestination, relative) : topDestination
      const bytesBase64 = (await fs.readFile(entry.sourcePath)).toString('base64')
      const result = await writeRemoteFileBase64(target, destinationPath, bytesBase64)
      if (result.ok) copied.push({ sourcePath: entry.sourcePath, destinationPath, kind: 'file' })
      else failed.push({ sourcePath: entry.sourcePath, message: result.message })
    }
  }
  return { ok: true, copied, renamed, failed }
}

async function copyRemotePathsToRemoteTarget(input: RepoFileTransferRequest & { source: { kind: 'fileTreePaths'; repoId: string; worktreePath: string; paths: string[] } }): Promise<RepoFileTransferResult> {
  const sourceTarget = await resolveRemoteRepoTarget(input.source.repoId)
  const target = await resolveRemoteRepoTarget(input.repoId)
  const inventory = await inventoryRemoteFileTransfer(sourceTarget, input.source.worktreePath, input.source.paths)
  if (!inventory.ok) return inventory
  if (inventory.totalBytes > FILE_TRANSFER_MAX_TOTAL_BYTES) return { ok: false, message: 'error.file-transfer-total-too-large' }
  const existing = await remoteDestinationNames(input)
  const copied: RepoFileTransferCopiedEntry[] = []
  const renamed: RepoFileTransferRenamedEntry[] = []
  const failed: RepoFileTransferFailedEntry[] = []
  for (const sourcePath of input.source.paths) {
    const sourceName = path.posix.basename(sourcePath)
    const destinationName = uniqueCopyName(existing, sourceName)
    existing.add(destinationName)
    const topDestination = path.posix.join(input.targetDirPath, destinationName)
    if (destinationName !== sourceName) renamed.push({ requestedName: sourceName, destinationName, destinationPath: topDestination })
    const entries = inventory.entries.filter((entry) => entry.path === sourcePath || entry.path.startsWith(sourcePath.replace(/\/$/, '') + '/'))
    for (const entry of entries) {
      if (entry.kind !== 'file') continue
      if (entry.size > FILE_TRANSFER_MAX_FILE_BYTES) return { ok: false, message: 'error.file-transfer-file-too-large' }
      const relative = entry.path === sourcePath ? '' : path.posix.relative(sourcePath, entry.path)
      const destinationPath = relative ? path.posix.join(topDestination, relative) : topDestination
      const read = await readRemoteFileBase64(sourceTarget, entry.path)
      if (!read.ok) {
        failed.push({ sourcePath: entry.path, message: read.message })
        continue
      }
      const written = await writeRemoteFileBase64(target, destinationPath, read.bytesBase64)
      if (written.ok) copied.push({ sourcePath: entry.path, destinationPath, kind: 'file' })
      else failed.push({ sourcePath: entry.path, message: written.message })
    }
  }
  return { ok: true, copied, renamed, failed }
}

async function copyRemotePathsToLocalTarget(input: RepoFileTransferRequest & { source: { kind: 'fileTreePaths'; repoId: string; worktreePath: string; paths: string[] } }): Promise<RepoFileTransferResult> {
  const sourceTarget = await resolveRemoteRepoTarget(input.source.repoId)
  const inventory = await inventoryRemoteFileTransfer(sourceTarget, input.source.worktreePath, input.source.paths)
  if (!inventory.ok) return inventory
  if (inventory.totalBytes > FILE_TRANSFER_MAX_TOTAL_BYTES) return { ok: false, message: 'error.file-transfer-total-too-large' }
  const copied: RepoFileTransferCopiedEntry[] = []
  const renamed: RepoFileTransferRenamedEntry[] = []
  const failed: RepoFileTransferFailedEntry[] = []
  for (const sourcePath of input.source.paths) {
    const sourceName = path.posix.basename(sourcePath)
    const destinationPath = path.join(input.targetDirPath, sourceName)
    const entries = inventory.entries.filter((entry) => entry.path === sourcePath || entry.path.startsWith(sourcePath.replace(/\/$/, '') + '/'))
    for (const entry of entries) {
      if (entry.kind !== 'file') continue
      const relative = entry.path === sourcePath ? '' : path.posix.relative(sourcePath, entry.path)
      const localDestination = relative ? path.join(destinationPath, ...relative.split('/')) : destinationPath
      await fs.mkdir(path.dirname(localDestination), { recursive: true })
      const read = await readRemoteFileBase64(sourceTarget, entry.path)
      if (!read.ok) {
        failed.push({ sourcePath: entry.path, message: read.message })
        continue
      }
      await fs.writeFile(localDestination, Buffer.from(read.bytesBase64, 'base64'))
      copied.push({ sourcePath: entry.path, destinationPath: localDestination, kind: 'file' })
    }
  }
  return { ok: true, copied, renamed, failed }
}

async function remoteDestinationNames(input: Pick<RepoFileTransferRequest, 'repoId' | 'worktreePath' | 'targetDirPath'>): Promise<Set<string>> {
  const target = await resolveRemoteRepoTarget(input.repoId)
  const listing = await listRemoteFileTreeDirectory(target, input.worktreePath, input.targetDirPath)
  if (!listing.ok) return new Set()
  return new Set(listing.entries.map((entry) => entry.name))
}
```

- [ ] **Step 4: Run server remote tests**

Run:

```bash
bun run test src/server/modules/repo-file-transfer.test.ts src/system/ssh/git.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run:

```bash
git diff -- src/server/modules/repo-file-transfer.ts src/server/modules/repo-file-transfer.test.ts
```

Expected: diff contains remote dispatch support and tests.

## Task 8: Final Verification and Hardening

**Files:**
- Review: all files changed by Tasks 1-7

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun run test src/shared/file-tree.ts src/web/repo-client.test.ts src/web/components/file-tree/model.test.ts src/web/components/file-tree/ProjectFileTree.test.tsx src/system/file-tree/local.test.ts src/system/file-tree/transfer.test.ts src/server/modules/repo-file-transfer.test.ts src/system/ssh/commands.test.ts src/system/ssh/git.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 4: Run architecture guard**

Run:

```bash
bun run check:architecture
```

Expected: PASS.

- [ ] **Step 5: Inspect changed files**

Run:

```bash
git status --short
```

Expected: only files intentionally changed for this feature plus pre-existing unrelated worktree changes.

Run:

```bash
git diff --stat
```

Expected: transfer changes are concentrated in the file-tree, server repo, shared file-tree, and SSH helper areas named in this plan.

## Self-Review Checklist

- Spec coverage:
  - Internal file tree copy: Tasks 2, 5, 7.
  - System file paste/drop: Tasks 2, 5.
  - Content paste: Tasks 1, 2, 4.
  - Local writes: Tasks 3, 4.
  - Remote writes: Tasks 6, 7.
  - Automatic renaming: Task 3, extended by Task 7.
  - Size limits: Tasks 1, 3, 7.
  - Containment checks: Tasks 3, 4, 6, 7.
  - Verification: Task 8.
- Placeholder scan:
  - The plan does not use incomplete markers or unspecified file paths.
- Type consistency:
  - Public transfer entry points use `RepoFileTransferRequest` and `RepoFileTransferResult`.
  - Renderer source parsing produces `RepoFileTransferSource`.
  - Server dispatch consumes the same shared source union.
