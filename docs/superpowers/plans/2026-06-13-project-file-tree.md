# Project File Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a responsive project file tree for the selected branch worktree, with multi-select, Git status coloring, read-only context actions, and drag-to-terminal path insertion.

**Architecture:** Treat the file tree as a repository feature. The server owns local/remote directory reads through repo read paths, the renderer owns tree expansion and selection state, and `TerminalSlot` remains the only place that formats dropped paths for shell input.

**Tech Stack:** Bun, TypeScript strip-only mode, React 19, Zustand, Hono, Vitest, Radix/shadcn primitives, existing SSH command runner, existing xterm terminal integration.

---

## Scope Check

This is one feature, not multiple independent subsystems. It spans shared types, server read APIs, repo workspace layout, file tree UI, terminal drop handling, and right-click actions, but each part is required for the single user workflow: browse current worktree files, see changed files, and drag paths into the AI terminal.

Per project instructions, this plan intentionally does not include `git commit`, branch creation, or destructive git steps. Each task ends with a no-commit checkpoint.

## File Structure

Create:

- `src/shared/file-tree.ts` — shared file tree request/result types, internal drag MIME constant, and payload parser/serializer helpers.
- `src/system/file-tree/local.ts` — local filesystem one-level directory listing and containment helpers.
- `src/system/file-tree/local.test.ts` — local listing and containment tests.
- `src/server/modules/repo-file-tree.ts` — repo-facing read orchestration for local and remote file tree listings.
- `src/server/modules/repo-file-tree.test.ts` — route-independent repo file tree read tests.
- `src/web/components/file-tree/model.ts` — frontend tree state, status mapping, virtual nodes, selection, drag payload helpers.
- `src/web/components/file-tree/model.test.ts` — pure model tests.
- `src/web/components/file-tree/ProjectFileTree.tsx` — tree component with loading/error/selection/drag/context menu.
- `src/web/components/file-tree/ProjectFileTree.test.tsx` — component tests.
- `src/web/components/repo-workspace/RepoExplorerPane.tsx` — branch area composition that splits branch list and file tree.
- `src/web/components/repo-workspace/RepoExplorerPane.test.tsx` — layout orientation tests.

Modify:

- `src/shared/git-types.ts` — add `originalPath?: string` to `StatusEntry`.
- `src/system/git/parsers.ts` and `src/system/git/parsers.test.ts` — preserve rename/copy original paths.
- `src/system/ssh/commands.ts` and `src/system/ssh/commands.test.ts` — add remote one-level directory listing command.
- `src/server/modules/repo-read-paths.ts` — expose `getRepositoryFileTree`.
- `src/server/routes/repo.ts` — add `POST /api/repo/file-tree`.
- `src/web/repo-client.ts` and `src/web/repo-client.test.ts` — add `getRepositoryFileTree`.
- `src/web/stores/repos/types.ts`, `src/web/stores/repos/store.ts`, `src/web/stores/repos/selection.ts`, `src/web/stores/repos/selection.test.ts`, `src/shared/workspace-layout.ts`, `src/shared/workspace-layout.test.ts` — add branch/file split size state.
- `src/web/components/RepoView.tsx` — render `RepoExplorerPane` in the branch pane.
- `src/web/components/terminal/TerminalSlot.tsx` and `src/web/components/terminal/TerminalSlot.test.tsx` — accept internal file path drag payloads.
- `src/shared/i18n/en.ts`, `src/shared/i18n/zh.ts`, `src/shared/i18n/ja.ts`, `src/shared/i18n/ko.ts`, `src/shared/i18n/dictionaries.test.ts` — add visible labels and error text.

Do not modify:

- `src/main/**` — file tree does not require Electron main process changes.
- Git mutation modules — no file management writes are in scope.

## Task 1: Preserve Rename/Copy Original Paths

**Files:**
- Modify: `src/shared/git-types.ts`
- Modify: `src/system/git/parsers.ts`
- Modify: `src/system/git/parsers.test.ts`

- [ ] **Step 1: Write failing parser tests**

Add these tests inside `describe('parseStatus', ...)` in `src/system/git/parsers.test.ts`:

```ts
  test('preserves original path for rename pairs', () => {
    const out = 'R  src/new.ts\0src/old.ts\0'
    expect(parseStatus(out)).toEqual([
      { x: 'R', y: ' ', path: 'src/new.ts', originalPath: 'src/old.ts' },
    ])
  })

  test('preserves original path for copy pairs', () => {
    const out = 'C  src/copied.ts\0src/source.ts\0'
    expect(parseStatus(out)).toEqual([
      { x: 'C', y: ' ', path: 'src/copied.ts', originalPath: 'src/source.ts' },
    ])
  })

  test('keeps parsing entries after rename original record', () => {
    const out = 'R  new/path.ts\0old/path.ts\0 M other.ts\0'
    expect(parseStatus(out)).toEqual([
      { x: 'R', y: ' ', path: 'new/path.ts', originalPath: 'old/path.ts' },
      { x: ' ', y: 'M', path: 'other.ts' },
    ])
  })
```

- [ ] **Step 2: Run parser tests and confirm failure**

Run:

```sh
bun run test src/system/git/parsers.test.ts
```

Expected: at least the new rename/copy tests fail because `originalPath` is not emitted yet.

- [ ] **Step 3: Extend the shared type**

Modify `StatusEntry` in `src/shared/git-types.ts`:

```ts
export interface StatusEntry {
  x: string
  y: string
  path: string
  originalPath?: string
}
```

- [ ] **Step 4: Preserve original paths in `parseStatus`**

Replace the rename/copy branch in `src/system/git/parsers.ts` with:

```ts
    const originalPath = x === 'R' || x === 'C' ? records[i + 1] : undefined
    if (x === 'R' || x === 'C') i++
    entries.push(originalPath ? { x, y, path, originalPath } : { x, y, path })
```

Keep the existing short-record guard and record loop intact.

- [ ] **Step 5: Run parser tests**

Run:

```sh
bun run test src/system/git/parsers.test.ts
```

Expected: all parser tests pass.

- [ ] **Step 6: No-commit checkpoint**

Run:

```sh
git diff -- src/shared/git-types.ts src/system/git/parsers.ts src/system/git/parsers.test.ts
```

Expected: only the status type, parser, and parser tests changed.

## Task 2: Add Shared File Tree Contracts

**Files:**
- Create: `src/shared/file-tree.ts`
- Test indirectly in later server/web tasks

- [ ] **Step 1: Create shared contracts**

Create `src/shared/file-tree.ts`:

```ts
export const GOBLIN_FILE_PATHS_MIME = 'application/x-goblin-file-paths+json'

export const FILE_TREE_MAX_ENTRIES = 5000

export type RepoFileTreeEntryKind = 'file' | 'directory' | 'symlink'
export type RepoFileTreeTargetKind = 'file' | 'directory' | 'other' | 'missing'

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
```

- [ ] **Step 2: Run typecheck for the new module**

Run:

```sh
bun run typecheck
```

Expected: PASS, with no unsupported TypeScript features.

- [ ] **Step 3: No-commit checkpoint**

Run:

```sh
git diff -- src/shared/file-tree.ts
```

Expected: only the new shared file tree contract appears.

## Task 3: Implement Local Directory Listing

**Files:**
- Create: `src/system/file-tree/local.ts`
- Create: `src/system/file-tree/local.test.ts`

- [ ] **Step 1: Write failing local listing tests**

Create `src/system/file-tree/local.test.ts`:

```ts
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import { listLocalFileTreeDirectory, pathInsideRoot } from '#/system/file-tree/local.ts'

describe('pathInsideRoot', () => {
  test('accepts root and descendants', () => {
    expect(pathInsideRoot('/repo/worktree', '/repo/worktree')).toBe(true)
    expect(pathInsideRoot('/repo/worktree', '/repo/worktree/src/file.ts')).toBe(true)
  })

  test('rejects siblings and traversal outside root', () => {
    expect(pathInsideRoot('/repo/worktree', '/repo/worktree-other')).toBe(false)
    expect(pathInsideRoot('/repo/worktree', '/repo/other')).toBe(false)
  })
})

describe('listLocalFileTreeDirectory', () => {
  test('lists one directory level with deterministic sorting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-tree-'))
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'README.md'), '')
    await writeFile(join(root, 'package.json'), '')

    const result = await listLocalFileTreeDirectory(root, root)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries.map((entry) => `${entry.kind}:${entry.relativePath}`)).toEqual([
      'directory:docs',
      'directory:src',
      'file:package.json',
      'file:README.md',
    ])
  })

  test('reports symlink target kind without following it for containment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-tree-'))
    await writeFile(join(root, 'target.txt'), '')
    await symlink(join(root, 'target.txt'), join(root, 'link.txt'))

    const result = await listLocalFileTreeDirectory(root, root)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries.find((entry) => entry.name === 'link.txt')).toMatchObject({
      kind: 'symlink',
      targetKind: 'file',
    })
  })

  test('rejects directory outside worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-tree-'))
    const result = await listLocalFileTreeDirectory(root, tmpdir())
    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
  })
})
```

- [ ] **Step 2: Run local listing tests and confirm failure**

Run:

```sh
bun run test src/system/file-tree/local.test.ts
```

Expected: FAIL because `src/system/file-tree/local.ts` does not exist.

- [ ] **Step 3: Implement local listing**

Create `src/system/file-tree/local.ts`:

```ts
import path from 'node:path'
import { promises as fs } from 'node:fs'
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
```

- [ ] **Step 4: Run local listing tests**

Run:

```sh
bun run test src/system/file-tree/local.test.ts
```

Expected: PASS.

- [ ] **Step 5: No-commit checkpoint**

Run:

```sh
git diff -- src/system/file-tree/local.ts src/system/file-tree/local.test.ts
```

Expected: only local file tree listing files changed.

## Task 4: Add Server Route and Repo Client

**Files:**
- Create: `src/server/modules/repo-file-tree.ts`
- Create: `src/server/modules/repo-file-tree.test.ts`
- Modify: `src/server/modules/repo-read-paths.ts`
- Modify: `src/server/routes/repo.ts`
- Modify: `src/web/repo-client.ts`
- Modify: `src/web/repo-client.test.ts`

- [ ] **Step 1: Write server module tests**

Create `src/server/modules/repo-file-tree.test.ts`:

```ts
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { getRepositoryFileTree } from '#/server/modules/repo-file-tree.ts'

describe('getRepositoryFileTree', () => {
  test('returns local directory entries for a local repo id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-repo-file-tree-'))
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'README.md'), '')

    const result = await getRepositoryFileTree(root, root, root)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries.map((entry) => entry.relativePath)).toEqual(['src', 'README.md'])
  })

  test('rejects local dirPath outside worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-repo-file-tree-'))
    const result = await getRepositoryFileTree(root, root, tmpdir())
    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
  })
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```sh
bun run test src/server/modules/repo-file-tree.test.ts
```

Expected: FAIL because `repo-file-tree.ts` does not exist.

- [ ] **Step 3: Implement repo file tree read module**

Create `src/server/modules/repo-file-tree.ts`:

```ts
import { isRemoteRepoId } from '#/shared/rpc.ts'
import { listLocalFileTreeDirectory } from '#/system/file-tree/local.ts'
import type { RepoFileTreeResult } from '#/shared/file-tree.ts'

export async function getRepositoryFileTree(
  repoId: string,
  worktreePath: string,
  dirPath: string,
  signal?: AbortSignal,
): Promise<RepoFileTreeResult> {
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (isRemoteRepoId(repoId)) {
    return { ok: false, message: 'error.failed-read-repo' }
  }
  return await listLocalFileTreeDirectory(worktreePath, dirPath)
}
```

Task 5 replaces the remote branch with the real SSH-backed implementation. Keeping this task local-only makes the intermediate state typecheckable.

- [ ] **Step 4: Add read path export**

Modify `src/server/modules/repo-read-paths.ts`:

```ts
import { getRepositoryFileTree as getRepositoryFileTreeRead } from '#/server/modules/repo-file-tree.ts'
import type { RepoFileTreeResult } from '#/shared/file-tree.ts'
```

Add:

```ts
export async function getRepositoryFileTree(
  repoId: string,
  worktreePath: string,
  dirPath: string,
  signal?: AbortSignal,
): Promise<RepoFileTreeResult> {
  return signal?.aborted
    ? { ok: false, message: 'cancelled' }
    : await getRepositoryFileTreeRead(repoId, worktreePath, dirPath, signal)
}
```

- [ ] **Step 5: Add server route**

Modify imports in `src/server/routes/repo.ts` to include `getRepositoryFileTree`. Add this route near other read routes:

```ts
  app.post('/file-tree', async (c) => {
    const body = await c.req.json().catch(() => null)
    const repoId = typeof body?.repoId === 'string' ? body.repoId : ''
    const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
    const dirPath = typeof body?.dirPath === 'string' ? body.dirPath : ''
    return c.json(
      await jsonOr(
        () => getRepositoryFileTree(repoId, worktreePath, dirPath, c.req.raw.signal),
        { ok: false, message: 'error.failed-read-repo' },
        'file-tree',
      ),
    )
  })
```

- [ ] **Step 6: Add repo client function**

Modify `src/web/repo-client.ts`:

```ts
import type { RepoFileTreeResult } from '#/shared/file-tree.ts'
```

Add:

```ts
export async function getRepositoryFileTree(
  repoId: string,
  worktreePath: string,
  dirPath: string,
  signal?: AbortSignal,
): Promise<RepoFileTreeResult> {
  return await postServerJson('/api/repo/file-tree', { repoId, worktreePath, dirPath }, { signal })
}
```

- [ ] **Step 7: Add client test**

In `src/web/repo-client.test.ts`, add an embedded-server fetch test:

```ts
  test('requests repository file tree', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        worktreePath: '/repo',
        dirPath: '/repo/src',
        entries: [],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { getRepositoryFileTree } = await import('#/web/repo-client.ts')
    const result = await getRepositoryFileTree('/repo', '/repo', '/repo/src')
    expect(result).toEqual({ ok: true, worktreePath: '/repo', dirPath: '/repo/src', entries: [] })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/file-tree',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
        body: JSON.stringify({ repoId: '/repo', worktreePath: '/repo', dirPath: '/repo/src' }),
      }),
    )
  })
```

- [ ] **Step 8: Run targeted tests**

Run:

```sh
bun run test src/server/modules/repo-file-tree.test.ts src/web/repo-client.test.ts
```

Expected: both targeted tests pass.

- [ ] **Step 9: No-commit checkpoint**

Run:

```sh
git diff -- src/server/modules/repo-file-tree.ts src/server/modules/repo-read-paths.ts src/server/routes/repo.ts src/web/repo-client.ts src/web/repo-client.test.ts
```

Expected: only route/client/read path changes for file tree.

## Task 5: Add Remote Directory Listing

**Files:**
- Modify: `src/system/ssh/commands.ts`
- Modify: `src/system/ssh/commands.test.ts`
- Modify: `src/system/ssh/git.ts`
- Modify: `src/system/ssh/git.test.ts`
- Modify: `src/server/modules/repo-file-tree.ts`

- [ ] **Step 1: Write SSH command tests**

In `src/system/ssh/commands.test.ts`, add tests for a new `listDirectoryEntries` command:

```ts
  test('builds a quoted one-level remote directory listing command', () => {
    const invocation = buildRemoteCommandInvocation(target, {
      type: 'listDirectoryEntries',
      worktreePath: '/srv/repo',
      dirPath: "/srv/repo/src with 'quote'",
    })
    expect(invocation.script).toContain("python3")
    expect(invocation.script).toContain("/srv/repo")
    expect(invocation.script).toContain("src with")
    expect(invocation.args).toContain(target.alias)
  })
```

Use the existing `target` fixture name from the file. The exact assertion should follow the current command-construction tests.

- [ ] **Step 2: Extend remote command type**

Add to `RemoteCommandKind` in `src/system/ssh/commands.ts`:

```ts
  | { type: 'listDirectoryEntries'; worktreePath: string; dirPath: string }
```

- [ ] **Step 3: Implement remote script**

Add a `case 'listDirectoryEntries'` in `scriptForCommand`. Use Python to emit JSON lines safely:

```ts
    case 'listDirectoryEntries':
      return [
        `python3 - <<'PY'`,
        `import json, os, sys`,
        `root = ${pythonString(command.worktreePath)}`,
        `dir_path = ${pythonString(command.dirPath)}`,
        `root_real = os.path.normpath(root)`,
        `dir_real = os.path.normpath(dir_path)`,
        `if dir_real != root_real and not dir_real.startswith(root_real.rstrip('/') + '/'):`,
        `    print(json.dumps({"ok": False, "message": "error.invalid-path"}))`,
        `    sys.exit(0)`,
        `if not os.path.isdir(dir_real):`,
        `    print(json.dumps({"ok": False, "message": "error.path-not-directory"}))`,
        `    sys.exit(0)`,
        `try:`,
        `    names = os.listdir(dir_real)`,
        `except PermissionError:`,
        `    print(json.dumps({"ok": False, "message": "error.path-permission-denied"}))`,
        `    sys.exit(0)`,
        `except FileNotFoundError:`,
        `    print(json.dumps({"ok": False, "message": "error.path-not-found"}))`,
        `    sys.exit(0)`,
        `if len(names) > 5000:`,
        `    print(json.dumps({"ok": False, "message": "error.file-tree-directory-too-large"}))`,
        `    sys.exit(0)`,
        `entries = []`,
        `for name in names:`,
        `    entry = os.path.join(dir_real, name)`,
        `    target_kind = None`,
        `    if os.path.islink(entry):`,
        `        kind = "symlink"`,
        `        if os.path.isdir(entry):`,
        `            target_kind = "directory"`,
        `        elif os.path.isfile(entry):`,
        `            target_kind = "file"`,
        `        else:`,
        `            target_kind = "missing"`,
        `    elif os.path.isdir(entry):`,
        `        kind = "directory"`,
        `    elif os.path.isfile(entry):`,
        `        kind = "file"`,
        `    else:`,
        `        kind = "file"`,
        `        target_kind = "other"`,
        `    item = {"name": name, "kind": kind}`,
        `    if target_kind:`,
        `        item["targetKind"] = target_kind`,
        `    entries.append(item)`,
        `print(json.dumps({"ok": True, "entries": entries}, ensure_ascii=False))`,
        `PY`,
      ].join('\n')
```

Add helper near `shellQuote`:

```ts
function pythonString(value: string): string {
  return JSON.stringify(value)
}
```

- [ ] **Step 4: Implement remote result mapping**

In `src/system/ssh/git.ts`, add `listRemoteFileTreeDirectory(target, worktreePath, dirPath, options)`:

```ts
import path from 'node:path'
import type { RepoFileTreeEntry, RepoFileTreeResult } from '#/shared/file-tree.ts'

interface RemoteFileTreeJson {
  ok?: boolean
  message?: string
  entries?: Array<{ name?: unknown; kind?: unknown; targetKind?: unknown }>
}

function remoteRelativePath(worktreePath: string, absolutePath: string): string {
  return path.posix.relative(path.posix.normalize(worktreePath), path.posix.normalize(absolutePath))
}

function sortRemoteFileTreeEntries(entries: RepoFileTreeEntry[]): RepoFileTreeEntry[] {
  return entries.sort((a, b) => {
    const aDirectory = a.kind === 'directory'
    const bDirectory = b.kind === 'directory'
    if (aDirectory !== bDirectory) return aDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

export async function listRemoteFileTreeDirectory(
  target: RemoteRepoTarget,
  worktreePath: string,
  dirPath: string,
  options?: { signal?: AbortSignal },
): Promise<RepoFileTreeResult> {
  const result = await runRemoteCommand(target, { type: 'listDirectoryEntries', worktreePath, dirPath }, options)
  if (!result.ok && !result.stdout) return { ok: false, message: result.message || 'error.failed-read-repo' }
  let parsed: RemoteFileTreeJson
  try {
    parsed = JSON.parse(result.stdout) as RemoteFileTreeJson
  } catch {
    return { ok: false, message: 'error.failed-read-repo' }
  }
  if (parsed.ok !== true) return { ok: false, message: parsed.message || 'error.failed-read-repo' }
  const normalizedDir = path.posix.normalize(dirPath)
  const normalizedWorktree = path.posix.normalize(worktreePath)
  const entries: RepoFileTreeEntry[] = (parsed.entries ?? [])
    .filter((entry): entry is { name: string; kind: RepoFileTreeEntry['kind']; targetKind?: RepoFileTreeEntry['targetKind'] } => {
      return (
        typeof entry.name === 'string' &&
        (entry.kind === 'file' || entry.kind === 'directory' || entry.kind === 'symlink') &&
        (entry.targetKind === undefined ||
          entry.targetKind === 'file' ||
          entry.targetKind === 'directory' ||
          entry.targetKind === 'other' ||
          entry.targetKind === 'missing')
      )
    })
    .map((entry) => {
      const absolutePath = path.posix.join(normalizedDir, entry.name)
      return {
        name: entry.name,
        absolutePath,
        relativePath: remoteRelativePath(normalizedWorktree, absolutePath),
        kind: entry.kind,
        ...(entry.targetKind ? { targetKind: entry.targetKind } : {}),
      }
    })
  return { ok: true, worktreePath: normalizedWorktree, dirPath: normalizedDir, entries: sortRemoteFileTreeEntries(entries) }
}
```

Use the existing `RemoteRepoTarget` import from the file instead of adding a duplicate import.

- [ ] **Step 5: Wire remote repo file tree reads**

Replace the remote branch in `src/server/modules/repo-file-tree.ts`:

```ts
import { resolveRemoteRepoTarget } from '#/server/modules/repo-backend.ts'
import { listRemoteFileTreeDirectory } from '#/system/ssh/git.ts'
```

```ts
  if (isRemoteRepoId(repoId)) {
    const target = await resolveRemoteRepoTarget(repoId)
    return await listRemoteFileTreeDirectory(target, worktreePath, dirPath, { signal })
  }
```

- [ ] **Step 6: Run remote tests**

Run:

```sh
bun run test src/system/ssh/commands.test.ts src/system/ssh/git.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run server file tree test again**

Run:

```sh
bun run test src/server/modules/repo-file-tree.test.ts
```

Expected: PASS with no unresolved `listRemoteFileTreeDirectory` import.

- [ ] **Step 8: No-commit checkpoint**

Run:

```sh
git diff -- src/system/ssh/commands.ts src/system/ssh/commands.test.ts src/system/ssh/git.ts src/system/ssh/git.test.ts src/server/modules/repo-file-tree.ts
```

Expected: only remote read-only directory listing changes.

## Task 6: Add File Tree Frontend Model

**Files:**
- Create: `src/web/components/file-tree/model.ts`
- Create: `src/web/components/file-tree/model.test.ts`

- [ ] **Step 1: Write model tests**

Create `src/web/components/file-tree/model.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  buildFileTreeStatusIndex,
  buildGoblinFilePathDragPayload,
  mergeDirectoryEntries,
  nextFileTreeSelection,
  visibleFileTreeNodeIds,
} from '#/web/components/file-tree/model.ts'
import type { RepoFileTreeEntry } from '#/shared/file-tree.ts'
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
    expect(merged).toEqual([
      expect.objectContaining({ relativePath: 'src/old.ts', kind: 'virtual', tone: 'danger' }),
    ])
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
})
```

- [ ] **Step 2: Run model tests and confirm failure**

Run:

```sh
bun run test src/web/components/file-tree/model.test.ts
```

Expected: FAIL because model functions do not exist.

- [ ] **Step 3: Implement model helpers**

Create `src/web/components/file-tree/model.ts` with focused pure helpers:

```ts
import {
  serializeGoblinFilePathDragPayload,
  type RepoFileTreeEntry,
} from '#/shared/file-tree.ts'
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

export function visibleFileTreeNodeIds(nodes: Array<Pick<FileTreeNode, 'id' | 'children' | 'expanded'>>): string[] {
  const result: string[] = []
  for (const node of nodes) {
    result.push(node.id)
    if (node.expanded && node.children) result.push(...visibleFileTreeNodeIds(node.children))
  }
  return result
}
```

- [ ] **Step 4: Run model tests**

Run:

```sh
bun run test src/web/components/file-tree/model.test.ts
```

Expected: PASS.

- [ ] **Step 5: No-commit checkpoint**

Run:

```sh
git diff -- src/web/components/file-tree/model.ts src/web/components/file-tree/model.test.ts
```

Expected: only pure frontend model helpers changed.

## Task 7: Add File Tree Pane Layout State

**Files:**
- Modify: `src/shared/workspace-layout.ts`
- Modify: `src/shared/workspace-layout.test.ts`
- Modify: `src/web/stores/repos/types.ts`
- Modify: `src/web/stores/repos/store.ts`
- Modify: `src/web/stores/repos/selection.ts`
- Modify: `src/web/stores/repos/selection.test.ts`

- [ ] **Step 1: Add workspace layout defaults**

In `src/shared/workspace-layout.ts`, add:

```ts
export const DEFAULT_FILE_TREE_PANE_SIZES: WorkspaceDetailPaneSizes = { 'top-bottom': 38.2, 'left-right': 38.2 }
```

Reuse `normalizeDetailPaneSizes` for file tree pane sizes.

- [ ] **Step 2: Extend store types**

In `src/web/stores/repos/types.ts`, add to `RestorableWorkspaceState`:

```ts
  fileTreePaneSizes: WorkspaceDetailPaneSizes
```

Add to `RestorableWorkspaceActions`:

```ts
  setFileTreePaneSize: (layout: RepoWorkspaceLayout, size: number) => void
```

- [ ] **Step 3: Initialize store state**

In `src/web/stores/repos/store.ts`, import `DEFAULT_FILE_TREE_PANE_SIZES` and initialize:

```ts
      fileTreePaneSizes: DEFAULT_FILE_TREE_PANE_SIZES,
```

- [ ] **Step 4: Add selection action**

In `src/web/stores/repos/selection.ts`, add an action following `setDetailPaneSize`:

```ts
    setFileTreePaneSize(layout, size) {
      set((state) => {
        state.fileTreePaneSizes = {
          ...state.fileTreePaneSizes,
          [layout]: normalizeDetailPaneSize(layout, size),
        }
      })
    },
```

Import `normalizeDetailPaneSize` if not already imported.

- [ ] **Step 5: Add store tests**

In `src/web/stores/repos/selection.test.ts`, add:

```ts
  test('stores file tree pane sizes per workspace layout', () => {
    useReposStore.getState().setFileTreePaneSize('top-bottom', 44.4)
    useReposStore.getState().setFileTreePaneSize('left-right', 35.2)

    expect(useReposStore.getState().fileTreePaneSizes).toEqual({
      'top-bottom': 44.4,
      'left-right': 35.2,
    })
  })
```

- [ ] **Step 6: Run store tests**

Run:

```sh
bun run test src/shared/workspace-layout.test.ts src/web/stores/repos/selection.test.ts
```

Expected: PASS.

- [ ] **Step 7: No-commit checkpoint**

Run:

```sh
git diff -- src/shared/workspace-layout.ts src/shared/workspace-layout.test.ts src/web/stores/repos/types.ts src/web/stores/repos/store.ts src/web/stores/repos/selection.ts src/web/stores/repos/selection.test.ts
```

Expected: only file tree pane size state was added.

## Task 8: Build Repo Explorer Layout

**Files:**
- Create: `src/web/components/repo-workspace/RepoExplorerPane.tsx`
- Create: `src/web/components/repo-workspace/RepoExplorerPane.test.tsx`
- Modify: `src/web/components/RepoView.tsx`

- [ ] **Step 1: Write layout component tests**

Create `src/web/components/repo-workspace/RepoExplorerPane.test.tsx`:

```ts
// @vitest-environment jsdom

import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { RepoExplorerPane } from '#/web/components/repo-workspace/RepoExplorerPane.tsx'

vi.mock('#/web/components/BranchList.tsx', () => ({
  BranchList: () => <div data-testid="branch-list" />,
}))

vi.mock('#/web/components/file-tree/ProjectFileTree.tsx', () => ({
  ProjectFileTree: () => <div data-testid="project-file-tree" />,
}))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('RepoExplorerPane', () => {
  test('renders top-bottom branch list above file tree', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<RepoExplorerPane repoId="/repo" layout="top-bottom" showActions />)
    })
    expect(container.querySelector('[data-file-tree-layout="top-bottom"]')).toBeTruthy()
    expect(container.textContent).toBe('')
    await act(async () => root.unmount())
  })

  test('renders left-right branch list beside file tree', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<RepoExplorerPane repoId="/repo" layout="left-right" showActions />)
    })
    expect(container.querySelector('[data-file-tree-layout="left-right"]')).toBeTruthy()
    await act(async () => root.unmount())
  })
})
```

- [ ] **Step 2: Run layout tests and confirm failure**

Run:

```sh
bun run test src/web/components/repo-workspace/RepoExplorerPane.test.tsx
```

Expected: FAIL because `RepoExplorerPane.tsx` does not exist.

- [ ] **Step 3: Implement `RepoExplorerPane`**

Create `src/web/components/repo-workspace/RepoExplorerPane.tsx`:

```tsx
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { BranchList } from '#/web/components/BranchList.tsx'
import { SplitPane } from '#/web/components/SplitPane.tsx'
import { ProjectFileTree } from '#/web/components/file-tree/ProjectFileTree.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'

interface RepoExplorerPaneProps {
  repoId: string
  layout: RepoWorkspaceLayout
  showActions: boolean
}

export function RepoExplorerPane({ repoId, layout, showActions }: RepoExplorerPaneProps) {
  const { fileTreePaneSizes, setFileTreePaneSize } = useStoreWithEqualityFn(
    useReposStore,
    (state) => ({
      fileTreePaneSizes: state.fileTreePaneSizes,
      setFileTreePaneSize: state.setFileTreePaneSize,
    }),
    (a, b) => a.fileTreePaneSizes === b.fileTreePaneSizes && a.setFileTreePaneSize === b.setFileTreePaneSize,
  )
  const fileTreeSize = fileTreePaneSizes[layout]
  return (
    <div data-file-tree-layout={layout} className="flex min-h-0 min-w-0 flex-1">
      <SplitPane
        orientation={layout === 'left-right' ? 'horizontal' : 'vertical'}
        before={<BranchList repoId={repoId} showActions={showActions} />}
        after={<ProjectFileTree repoId={repoId} />}
        afterSize={fileTreeSize}
        onAfterSizeChange={(size) => setFileTreePaneSize(layout, size)}
        beforeMinSize={layout === 'left-right' ? '12rem' : '8rem'}
        afterMinSize={layout === 'left-right' ? '12rem' : '8rem'}
        afterMaxSize="80%"
        className="flex-1"
      />
    </div>
  )
}
```

- [ ] **Step 4: Create the first `ProjectFileTree` component version**

Create `src/web/components/file-tree/ProjectFileTree.tsx` with the minimal exported component needed for layout integration:

```tsx
export function ProjectFileTree({ repoId }: { repoId: string }) {
  return <div className="flex min-h-0 flex-1" data-repo-id={repoId} />
}
```

Task 9 expands this component in place.

- [ ] **Step 5: Integrate into `RepoView`**

In `src/web/components/RepoView.tsx`, replace the `BranchList` import with:

```ts
import { RepoExplorerPane } from '#/web/components/repo-workspace/RepoExplorerPane.tsx'
```

Replace the `branchPane` prop body:

```tsx
        branchPane={
          <RepoWorkspacePane>
            <RepoExplorerPane repoId={repoId} layout={layout} showActions={behavior.branchListActionsVisible} />
          </RepoWorkspacePane>
        }
```

- [ ] **Step 6: Run layout tests**

Run:

```sh
bun run test src/web/components/repo-workspace/RepoExplorerPane.test.tsx
```

Expected: PASS.

- [ ] **Step 7: No-commit checkpoint**

Run:

```sh
git diff -- src/web/components/repo-workspace/RepoExplorerPane.tsx src/web/components/repo-workspace/RepoExplorerPane.test.tsx src/web/components/RepoView.tsx src/web/components/file-tree/ProjectFileTree.tsx
```

Expected: only repo explorer layout integration changed.

## Task 9: Implement Project File Tree Component

**Files:**
- Modify: `src/web/components/file-tree/ProjectFileTree.tsx`
- Create: `src/web/components/file-tree/ProjectFileTree.test.tsx`
- Modify: `src/shared/i18n/en.ts`
- Modify: `src/shared/i18n/zh.ts`
- Modify: `src/shared/i18n/ja.ts`
- Modify: `src/shared/i18n/ko.ts`
- Modify: `src/shared/i18n/dictionaries.test.ts`

- [ ] **Step 1: Add i18n keys**

Add keys to all dictionaries:

```ts
'file-tree.title': 'Files',
'file-tree.no-worktree-title': 'No worktree',
'file-tree.no-worktree-body': 'Select a branch with a worktree to browse files.',
'file-tree.loading': 'Loading files',
'file-tree.retry': 'Retry',
'file-tree.copy-path': 'Copy path',
'file-tree.copy-relative-path': 'Copy relative path',
'file-tree.open-editor': 'Open in editor',
'file-tree.open-terminal': 'Open in terminal',
'error.file-tree-directory-too-large': 'Directory has too many entries to display.',
```

Translate values naturally in `zh`, `ja`, and `ko`, preserving the keys exactly.

- [ ] **Step 2: Write component tests**

Create `src/web/components/file-tree/ProjectFileTree.test.tsx` with jsdom tests that mock `getRepositoryFileTree`:

```ts
// @vitest-environment jsdom

import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ProjectFileTree } from '#/web/components/file-tree/ProjectFileTree.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { createRepoBranch } from '#/web/stores/repos/test-utils.ts'
import { emptyRepoOperations } from '#/web/stores/repos/operations.ts'
import { emptyRepoResources } from '#/web/stores/repos/resources.ts'

vi.mock('#/web/repo-client.ts', () => ({
  getRepositoryFileTree: vi.fn(async () => ({
    ok: true,
    worktreePath: '/repo',
    dirPath: '/repo',
    entries: [
      { name: 'src', absolutePath: '/repo/src', relativePath: 'src', kind: 'directory' },
      { name: 'README.md', absolutePath: '/repo/README.md', relativePath: 'README.md', kind: 'file' },
    ],
  })),
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

afterEach(() => {
  document.body.innerHTML = ''
  useReposStore.setState({ repos: {}, activeId: null, order: [] })
})

function seedRepo() {
  useReposStore.setState((state) => ({
    ...state,
    repos: {
      '/repo': {
        id: '/repo',
        name: 'repo',
        instanceToken: 1,
        data: {
          branches: [createRepoBranch('main', { worktree: { path: '/repo' } })],
          currentBranch: 'main',
          status: [{ path: '/repo', isMain: true, entries: [{ x: ' ', y: 'M', path: 'src/App.tsx' }] }],
          statusLoaded: true,
          worktreesByPath: {},
        },
        resources: emptyRepoResources(),
        operations: emptyRepoOperations(),
        ui: { selectedBranch: 'main', branchViewMode: 'all', detailTab: 'status', worktreePathOrder: [] },
        projection: { source: 'fresh', savedAt: null },
        remote: { fetchFailed: false, fetchError: null },
        availability: { phase: 'available' },
        events: [],
      },
    },
  }))
}

describe('ProjectFileTree', () => {
  test('loads and renders root entries with status count', async () => {
    seedRepo()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<ProjectFileTree repoId="/repo" />)
    })
    expect(container.textContent).toContain('src')
    expect(container.textContent).toContain('README.md')
    expect(container.textContent).toContain('1')
    await act(async () => root.unmount())
  })
})
```

- [ ] **Step 3: Run component test and confirm failure**

Run:

```sh
bun run test src/web/components/file-tree/ProjectFileTree.test.tsx
```

Expected: FAIL until the component is implemented and the seed matches store helpers.

- [ ] **Step 4: Implement root load and tree rendering**

Replace the stub with a component that:

1. Selects `repo.data.branches`, `repo.ui.selectedBranch`, `repo.data.status`, and `repo.resources.status` from `useReposStore`.
2. Resolves `worktreePath`.
3. Calls `getRepositoryFileTree(repoId, worktreePath, worktreePath)` in an effect.
4. Stores loaded directory entries in component state keyed by `dirPath`.
5. Uses `buildFileTreeStatusIndex` and `mergeDirectoryEntries` for render nodes.
6. Renders rows with `FolderTree`, `File`, `ChevronRight`, and status classes.

Use this component skeleton:

```tsx
import { ChevronRight, File, FolderTree } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { getRepositoryFileTree } from '#/web/repo-client.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Toolbar } from '#/web/components/Layout.tsx'
import { cn } from '#/web/lib/cn.ts'
import { buildFileTreeStatusIndex, mergeDirectoryEntries, type FileTreeNode } from '#/web/components/file-tree/model.ts'

interface DirectoryState {
  phase: 'idle' | 'loading' | 'loaded' | 'error'
  entries: FileTreeNode[]
  error: string | null
}

export function ProjectFileTree({ repoId }: { repoId: string }) {
  const t = useT()
  const repo = useStoreWithEqualityFn(
    useReposStore,
    (state) => {
      const repo = state.repos[repoId]
      return repo
        ? {
            id: repo.id,
            data: { branches: repo.data.branches, status: repo.data.status },
            ui: { selectedBranch: repo.ui.selectedBranch },
          }
        : null
    },
    (a, b) => a === b || (!!a && !!b && a.data.branches === b.data.branches && a.data.status === b.data.status && a.ui.selectedBranch === b.ui.selectedBranch),
  )
  const selectedBranch = repo?.data.branches.find((branch) => branch.name === repo.ui.selectedBranch) ?? null
  const worktreePath = selectedBranch?.worktree?.path ?? null
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const statusIndex = useMemo(
    () => (worktreePath ? buildFileTreeStatusIndex(worktreePath, repo?.data.status ?? []) : null),
    [repo?.data.status, worktreePath],
  )

  useEffect(() => {
    if (!repo || !worktreePath || !statusIndex) return
    const ctrl = new AbortController()
    setDirectories((current) => ({
      ...current,
      [worktreePath]: current[worktreePath]?.phase === 'loaded'
        ? current[worktreePath]
        : { phase: 'loading', entries: [], error: null },
    }))
    void getRepositoryFileTree(repo.id, worktreePath, worktreePath, ctrl.signal).then((result) => {
      if (ctrl.signal.aborted) return
      setDirectories((current) => ({
        ...current,
        [worktreePath]: result.ok
          ? {
              phase: 'loaded',
              entries: mergeDirectoryEntries(worktreePath, '', result.entries, statusIndex),
              error: null,
            }
          : { phase: 'error', entries: [], error: result.message },
      }))
    })
    return () => ctrl.abort()
  }, [repo, statusIndex, worktreePath])

  if (!repo) return null
  if (!worktreePath) {
    return (
      <section className="flex min-h-0 flex-1 flex-col">
        <Toolbar variant="detail"><span className="text-sm font-medium">{t('file-tree.title')}</span></Toolbar>
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
          {t('file-tree.no-worktree-title')}
        </div>
      </section>
    )
  }

  const root = directories[worktreePath]
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <Toolbar variant="detail"><span className="text-sm font-medium">{t('file-tree.title')}</span></Toolbar>
      <ScrollArea className="min-h-0 flex-1">
        {root?.phase === 'loading' && <div className="p-3 text-xs text-muted-foreground">{t('file-tree.loading')}</div>}
        {root?.phase === 'error' && <div className="p-3 text-xs text-danger">{t(root.error ?? 'error.failed-read-repo')}</div>}
        {root?.entries.map((node) => <FileTreeRow key={node.id} node={node} depth={0} />)}
      </ScrollArea>
    </section>
  )
}

function FileTreeRow({ node, depth }: { node: FileTreeNode; depth: number }) {
  const Icon = node.kind === 'directory' ? FolderTree : File
  return (
    <div
      className={cn(
        'flex h-6 items-center gap-1 px-2 text-xs',
        node.tone === 'attention' && 'text-attention',
        node.tone === 'success' && 'text-success',
        node.tone === 'danger' && 'text-danger',
        node.tone === 'muted' && 'text-muted-foreground',
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {node.kind === 'directory' ? <ChevronRight className="size-3" /> : <span className="size-3" />}
      <Icon className="size-3.5" />
      <span className="min-w-0 truncate">{node.name}</span>
      {node.changeCount ? <span className="ml-auto font-mono text-[10px]">{node.changeCount}</span> : null}
    </div>
  )
}
```

This skeleton deliberately covers root display first. Add expand/collapse, selection, drag, and context menu in the next steps inside the same task.

- [ ] **Step 5: Add expansion, selection, drag, and retry**

Extend `ProjectFileTree` to:

- Track `expandedDirs: Set<string>`.
- On directory row click of disclosure, call `getRepositoryFileTree(repoId, worktreePath, node.absolutePath)`.
- Use `nextFileTreeSelection` for click selection.
- Set `draggable` on rows and write `GOBLIN_FILE_PATHS_MIME` with selected paths.
- Show retry button for directory errors.

- [ ] **Step 6: Add context menu**

Use `DropdownMenu`, `DropdownMenuContent`, and `DropdownMenuItem` from `src/web/components/ui/dropdown-menu.tsx`. Open the menu from row `onContextMenu` by storing the context-clicked node in component state and rendering a row-local trigger button with `className="sr-only"` plus controlled `open` state. Implement:

- Copy path.
- Copy relative path.
- Open in editor for context-clicked real node.
- Open in terminal for context-clicked real node.

Use `navigator.clipboard.writeText` for copy. Use `openRepositoryEditor` and `openRepositoryTerminal` from `src/web/repo-client.ts` for local repositories. Use `openRemoteRepositoryEditor` and `openRemoteRepositoryTerminal` from `src/web/remote-client.ts` for remote repositories. The terminal action passes the context-clicked directory, or a file's parent directory, as `worktreePath`. The editor action passes the context-clicked real node path. Virtual nodes keep both open actions disabled.

- [ ] **Step 7: Run component and dictionary tests**

Run:

```sh
bun run test src/web/components/file-tree/model.test.ts src/web/components/file-tree/ProjectFileTree.test.tsx src/shared/i18n/dictionaries.test.ts
```

Expected: PASS.

- [ ] **Step 8: No-commit checkpoint**

Run:

```sh
git diff -- src/web/components/file-tree/ProjectFileTree.tsx src/web/components/file-tree/ProjectFileTree.test.tsx src/shared/i18n/en.ts src/shared/i18n/zh.ts src/shared/i18n/ja.ts src/shared/i18n/ko.ts src/shared/i18n/dictionaries.test.ts
```

Expected: only file tree component and i18n changes.

## Task 10: Accept Internal File Path Drops in Terminal

**Files:**
- Modify: `src/web/components/terminal/TerminalSlot.tsx`
- Modify: `src/web/components/terminal/TerminalSlot.test.tsx`

- [ ] **Step 1: Add terminal drop test**

In `src/web/components/terminal/TerminalSlot.test.tsx`, add a test using the existing render harness pattern:

```ts
  test('writes shell-escaped internal file tree paths on drop', async () => {
    // Render TerminalSlot with a selected descriptor and writeInput mock.
    // Dispatch dragOver/drop with dataTransfer containing GOBLIN_FILE_PATHS_MIME.
    // Expect writeInput('terminal-1', "'/repo/a file.ts' /repo/src")
  })
```

Use a minimal fake `DataTransfer` object:

```ts
const dataTransfer = {
  types: [GOBLIN_FILE_PATHS_MIME],
  getData: (type: string) =>
    type === GOBLIN_FILE_PATHS_MIME ? JSON.stringify({ paths: ['/repo/a file.ts', '/repo/src'] }) : '',
  files: [],
  dropEffect: 'copy',
}
```

- [ ] **Step 2: Run terminal test and confirm failure**

Run:

```sh
bun run test src/web/components/terminal/TerminalSlot.test.tsx
```

Expected: FAIL because internal MIME drops are ignored.

- [ ] **Step 3: Add internal MIME helpers**

In `src/web/components/terminal/TerminalSlot.tsx`, import:

```ts
import { GOBLIN_FILE_PATHS_MIME, parseGoblinFilePathDragPayload } from '#/shared/file-tree.ts'
```

Add:

```ts
function hasPathDrop(event: DragEvent<HTMLDivElement>): boolean {
  return event.dataTransfer.types.includes(GOBLIN_FILE_PATHS_MIME) || event.dataTransfer.types.includes('Files')
}

function pathsForDrop(event: DragEvent<HTMLDivElement>): string[] {
  if (event.dataTransfer.types.includes(GOBLIN_FILE_PATHS_MIME)) {
    return parseGoblinFilePathDragPayload(event.dataTransfer.getData(GOBLIN_FILE_PATHS_MIME))
  }
  return Array.from(event.dataTransfer.files)
    .map((file) => pathForDroppedFile(file))
    .filter((path) => path.length > 0)
}
```

- [ ] **Step 4: Replace Files-only checks**

In `handleDragEnter`, `handleDragOver`, `handleDragLeave`, and `handleDrop`, replace:

```ts
event.dataTransfer.types.includes('Files')
```

with:

```ts
hasPathDrop(event)
```

In `handleDrop`, replace the `Array.from(event.dataTransfer.files)...` block with:

```ts
      const paths = pathsForDrop(event)
```

- [ ] **Step 5: Run terminal tests**

Run:

```sh
bun run test src/web/components/terminal/TerminalSlot.test.tsx
```

Expected: PASS and existing OS file drop behavior remains covered.

- [ ] **Step 6: No-commit checkpoint**

Run:

```sh
git diff -- src/web/components/terminal/TerminalSlot.tsx src/web/components/terminal/TerminalSlot.test.tsx
```

Expected: only terminal drop handling changed.

## Task 11: Final Integration Verification

**Files:**
- Verify all changed files

- [ ] **Step 1: Run architecture guard**

Run:

```sh
bun run check:architecture
```

Expected: PASS. No `src/main/**` imports from web/server, no web imports from main, and no `electron` in server/shared.

- [ ] **Step 2: Run typecheck**

Run:

```sh
bun run typecheck
```

Expected: PASS. Pay attention to TypeScript strip-only constraints: no enums, namespaces with runtime code, parameter properties, or import aliases.

- [ ] **Step 3: Run full tests**

Run:

```sh
bun run test
```

Expected: PASS.

- [ ] **Step 4: Manual verification in dev app**

Run the dev app:

```sh
bun run dev
```

Expected: app starts. Open a repository with a branch worktree and verify:

- In `top-bottom`, branch list is above file tree.
- In `left-right`, branch list is left of file tree.
- Root directory loads one level.
- Expanding a directory loads only that directory.
- `.git`, `node_modules`, and other real directories are visible if present.
- Modified files are tinted.
- Directories with changed descendants show a count.
- Deleted status paths appear as virtual nodes.
- `Cmd/Ctrl` and `Shift` selection work.
- Dragging selected nodes into the terminal writes shell-escaped absolute paths.
- Copy path and copy relative path work.
- Open actions are disabled on virtual deleted nodes.

- [ ] **Step 5: No-commit final checkpoint**

Run:

```sh
git status --short
```

Expected: shows implementation files only. Do not commit unless the user explicitly asks.
