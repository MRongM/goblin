# File Tree Rename And Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file tree rename and permanent delete actions for local and remote worktrees.

**Architecture:** Keep write operations behind the existing repository write boundary. The renderer owns inline rename, confirmation, selection, and directory cache refresh; the server owns validation, local filesystem mutation, remote SSH command construction, and repository snapshot invalidation.

**Tech Stack:** Bun, TypeScript strip-only mode, React 19, Zustand, Hono, Vitest/jsdom, Radix UI primitives, existing SSH command runner.

---

## Scope Check

This is one cohesive feature. It touches local filesystem helpers, remote SSH helpers, repo write routes, web client wrappers, i18n, and the file tree component, but every change supports the single workflow: rename or permanently delete selected file tree entries from the current worktree.

## Safety Note

Do not add `git commit` steps. Project instructions explicitly prohibit planning or executing git commits unless the user asks for them. Each task ends with a no-commit checkpoint.

Permanent delete is intentionally destructive. The UI must require confirmation, and the server must still reject root deletion and path escape requests.

## File Structure

Modify:

- `src/system/file-tree/local.ts` — add local rename/delete helpers and write error classification.
- `src/system/file-tree/local.test.ts` — test local path validation and filesystem mutations.
- `src/system/ssh/commands.ts` — add fixed remote command kinds for file tree rename/delete.
- `src/system/ssh/commands.test.ts` — test remote command generation.
- `src/system/ssh/git.ts` — add remote mutation wrappers that parse remote JSON results.
- `src/system/ssh/git.test.ts` — test remote mutation wrappers.
- `src/server/modules/repo-write-paths.ts` — add repo-facing write functions and invalidation.
- `src/server/modules/repo.test.ts` — test repo write invalidation behavior with mocked local/remote helpers.
- `src/server/routes/repo.ts` — add `/api/repo/file-tree/rename` and `/api/repo/file-tree/delete`.
- `src/web/repo-client.ts` — add web client functions for rename/delete.
- `src/web/repo-client.test.ts` — test client payloads.
- `src/shared/i18n/en.ts`, `src/shared/i18n/zh.ts`, `src/shared/i18n/ja.ts`, `src/shared/i18n/ko.ts` — add labels, confirmation copy, and new error keys.
- `src/shared/i18n/dictionaries.test.ts` — should pass without structural changes after keys are aligned.
- `src/web/components/file-tree/ProjectFileTree.tsx` — add inline rename, delete confirmation, keyboard handling, and cache refresh.
- `src/web/components/file-tree/ProjectFileTree.test.tsx` — test menu actions, keyboard rename, and delete confirmation.

Do not modify:

- `src/main/**` — Electron main process is not part of this feature.
- Branch/worktree Git action policy modules — this feature manages files inside an existing worktree, not Git branches or worktrees.

---

### Task 1: Add Local File Tree Write Helpers

**Files:**
- Modify: `src/system/file-tree/local.ts`
- Modify: `src/system/file-tree/local.test.ts`

- [ ] **Step 1: Write failing local write tests**

Append these tests to `src/system/file-tree/local.test.ts`, and extend the import to include `renameLocalFileTreeEntry` and `deleteLocalFileTreeEntries`:

```ts
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import {
  deleteLocalFileTreeEntries,
  listLocalFileTreeDirectory,
  pathInsideRoot,
  renameLocalFileTreeEntry,
} from '#/system/file-tree/local.ts'
```

Add the tests:

```ts
describe('renameLocalFileTreeEntry', () => {
  test('renames one file inside the worktree without overwriting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-tree-rename-'))
    const oldPath = join(root, 'README.md')
    const newPath = join(root, 'README-renamed.md')
    await writeFile(oldPath, 'hello')

    const result = await renameLocalFileTreeEntry(root, oldPath, 'README-renamed.md')

    expect(result).toEqual({ ok: true, message: '' })
    expect(existsSync(oldPath)).toBe(false)
    expect(await readFile(newPath, 'utf8')).toBe('hello')
  })

  test('rejects basename values that would move the entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-tree-rename-'))
    const oldPath = join(root, 'README.md')
    await writeFile(oldPath, 'hello')

    await expect(renameLocalFileTreeEntry(root, oldPath, '../escape.md')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(renameLocalFileTreeEntry(root, oldPath, 'nested/file.md')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
  })

  test('rejects destination overwrite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-tree-rename-'))
    const oldPath = join(root, 'old.md')
    const existingPath = join(root, 'existing.md')
    await writeFile(oldPath, 'old')
    await writeFile(existingPath, 'existing')

    await expect(renameLocalFileTreeEntry(root, oldPath, basename(existingPath))).resolves.toEqual({
      ok: false,
      message: 'error.file-exists',
    })
  })

  test('rejects worktree root rename', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-tree-rename-'))

    await expect(renameLocalFileTreeEntry(root, root, 'renamed-root')).resolves.toEqual({
      ok: false,
      message: 'error.delete-root-forbidden',
    })
  })
})

describe('deleteLocalFileTreeEntries', () => {
  test('deletes files and directories inside the worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-tree-delete-'))
    const filePath = join(root, 'README.md')
    const dirPath = join(root, 'src')
    await mkdir(dirPath)
    await writeFile(filePath, 'hello')
    await writeFile(join(dirPath, 'index.ts'), 'export {}')

    const result = await deleteLocalFileTreeEntries(root, [filePath, dirPath])

    expect(result).toEqual({ ok: true, message: '' })
    expect(existsSync(filePath)).toBe(false)
    expect(existsSync(dirPath)).toBe(false)
  })

  test('rejects path escape before deleting anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-tree-delete-'))
    const filePath = join(root, 'README.md')
    await writeFile(filePath, 'hello')

    const result = await deleteLocalFileTreeEntries(root, [filePath, tmpdir()])

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(existsSync(filePath)).toBe(true)
  })

  test('rejects deleting the worktree root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-tree-delete-'))

    await expect(deleteLocalFileTreeEntries(root, [root])).resolves.toEqual({
      ok: false,
      message: 'error.delete-root-forbidden',
    })
    expect(existsSync(root)).toBe(true)
  })
})
```

- [ ] **Step 2: Run local tests and verify failure**

Run:

```sh
bun run test src/system/file-tree/local.test.ts
```

Expected: FAIL because `renameLocalFileTreeEntry` and `deleteLocalFileTreeEntries` are not exported yet.

- [ ] **Step 3: Implement local helpers**

Update imports in `src/system/file-tree/local.ts`:

```ts
import { constants as fsConstants, promises as fs } from 'node:fs'
import path from 'node:path'
import type { ExecResult } from '#/shared/git-types.ts'
import { FILE_TREE_MAX_ENTRIES, type RepoFileTreeEntry, type RepoFileTreeResult } from '#/shared/file-tree.ts'
```

Add these helpers near the existing filesystem error classifier:

```ts
function classifyFsWriteError(err: unknown): string {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : ''
  if (code === 'ENOENT') return 'error.path-not-found'
  if (code === 'ENOTDIR') return 'error.path-not-directory'
  if (code === 'EACCES' || code === 'EPERM') return 'error.path-permission-denied'
  if (code === 'EEXIST' || code === 'ENOTEMPTY') return 'error.file-exists'
  return 'error.failed-read-repo'
}

function isAbsolutePathInput(value: string): boolean {
  return value.length > 0 && !value.includes('\0') && path.isAbsolute(value)
}

function isValidFileTreeBasename(value: string): boolean {
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('\0') &&
    !value.includes('/') &&
    !value.includes('\\')
  )
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await fs.access(value, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}
```

Add these exports after `listLocalFileTreeDirectory`:

```ts
export async function renameLocalFileTreeEntry(
  worktreePath: string,
  oldPath: string,
  newName: string,
): Promise<ExecResult> {
  if (!isAbsolutePathInput(worktreePath) || !isAbsolutePathInput(oldPath) || !isValidFileTreeBasename(newName)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const root = path.resolve(worktreePath)
  const oldAbsolute = path.resolve(oldPath)
  if (!pathInsideRoot(root, oldAbsolute)) return { ok: false, message: 'error.invalid-path' }
  if (oldAbsolute === root) return { ok: false, message: 'error.delete-root-forbidden' }
  const newAbsolute = path.join(path.dirname(oldAbsolute), newName)
  if (!pathInsideRoot(root, newAbsolute)) return { ok: false, message: 'error.invalid-path' }
  if (await pathExists(newAbsolute)) return { ok: false, message: 'error.file-exists' }
  try {
    await fs.rename(oldAbsolute, newAbsolute)
    return { ok: true, message: '' }
  } catch (err) {
    return { ok: false, message: classifyFsWriteError(err) }
  }
}

export async function deleteLocalFileTreeEntries(
  worktreePath: string,
  paths: string[],
): Promise<ExecResult> {
  if (!isAbsolutePathInput(worktreePath) || paths.length === 0 || paths.some((item) => !isAbsolutePathInput(item))) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const root = path.resolve(worktreePath)
  const targets = paths.map((item) => path.resolve(item))
  for (const target of targets) {
    if (!pathInsideRoot(root, target)) return { ok: false, message: 'error.invalid-path' }
    if (target === root) return { ok: false, message: 'error.delete-root-forbidden' }
  }
  try {
    for (const target of targets) {
      await fs.rm(target, { recursive: true, force: false })
    }
    return { ok: true, message: '' }
  } catch (err) {
    return { ok: false, message: classifyFsWriteError(err) }
  }
}
```

- [ ] **Step 4: Run local tests**

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

Expected: only local file tree helper and test changes appear.

---

### Task 2: Add Remote File Tree Mutation Commands

**Files:**
- Modify: `src/system/ssh/commands.ts`
- Modify: `src/system/ssh/commands.test.ts`

- [ ] **Step 1: Write failing remote command tests**

Append these tests to `describe('remote command scripts', ...)` in `src/system/ssh/commands.test.ts`:

```ts
  test('builds a fixed remote rename command with JSON encoded inputs', () => {
    const invocation = buildRemoteCommandInvocation(TARGET, {
      type: 'renameFileTreeEntry',
      worktreePath: '/srv/repo',
      oldPath: "/srv/repo/src/old 'name'.ts",
      newName: 'new name.ts',
    })

    expect(invocation.script).toContain('python3')
    expect(invocation.script).toContain('os.rename')
    expect(invocation.script).toContain('"/srv/repo"')
    expect(invocation.script).toContain("old 'name'.ts")
    expect(invocation.script).toContain('new name.ts')
    expect(invocation.args).toContain(TARGET.alias)
  })

  test('builds a fixed remote delete command with JSON encoded paths', () => {
    const invocation = buildRemoteCommandInvocation(TARGET, {
      type: 'deleteFileTreeEntries',
      worktreePath: '/srv/repo',
      paths: ['/srv/repo/README.md', '/srv/repo/src'],
    })

    expect(invocation.script).toContain('python3')
    expect(invocation.script).toContain('shutil.rmtree')
    expect(invocation.script).toContain('"/srv/repo/README.md"')
    expect(invocation.script).toContain('"/srv/repo/src"')
    expect(invocation.args).toContain(TARGET.alias)
  })
```

- [ ] **Step 2: Run command tests and verify failure**

Run:

```sh
bun run test src/system/ssh/commands.test.ts
```

Expected: FAIL because the new remote command kinds are not defined.

- [ ] **Step 3: Extend `RemoteCommandKind`**

Add these variants to the `RemoteCommandKind` union in `src/system/ssh/commands.ts`:

```ts
  | { type: 'renameFileTreeEntry'; worktreePath: string; oldPath: string; newName: string }
  | { type: 'deleteFileTreeEntries'; worktreePath: string; paths: string[] }
```

- [ ] **Step 4: Add remote mutation Python script builders**

Add these helpers near `pythonString` in `src/system/ssh/commands.ts`:

```ts
function pythonJson(value: unknown): string {
  return JSON.stringify(value)
}

function remoteFileTreePreamble(worktreePath: string): string[] {
  return [
    'import json, os, shutil, sys',
    `root = ${pythonString(worktreePath)}`,
    'root_real = os.path.normpath(root)',
    'def finish(ok, message=""):',
    '    print(json.dumps({"ok": ok, "message": message}))',
    '    sys.exit(0)',
    'def inside_root(value):',
    '    candidate = os.path.normpath(value)',
    "    return candidate == root_real or candidate.startswith(root_real.rstrip('/') + '/')",
    'def writable_target(value):',
    '    if not isinstance(value, str) or not value or "\\x00" in value:',
    '        finish(False, "error.invalid-arguments")',
    '    candidate = os.path.normpath(value)',
    '    if not os.path.isabs(candidate):',
    '        finish(False, "error.invalid-arguments")',
    '    if not inside_root(candidate):',
    '        finish(False, "error.invalid-path")',
    '    if candidate == root_real:',
    '        finish(False, "error.delete-root-forbidden")',
    '    return candidate',
  ]
}

function remoteRenameFileTreeScript(command: Extract<RemoteCommandKind, { type: 'renameFileTreeEntry' }>): string {
  return [
    "python3 - <<'PY'",
    ...remoteFileTreePreamble(command.worktreePath),
    `old_path = writable_target(${pythonString(command.oldPath)})`,
    `new_name = ${pythonString(command.newName)}`,
    'if not isinstance(new_name, str) or not new_name or new_name in (".", "..") or "/" in new_name or "\\x00" in new_name:',
    '    finish(False, "error.invalid-arguments")',
    'new_path = os.path.join(os.path.dirname(old_path), new_name)',
    'if not inside_root(new_path):',
    '    finish(False, "error.invalid-path")',
    'if os.path.exists(new_path):',
    '    finish(False, "error.file-exists")',
    'try:',
    '    os.rename(old_path, new_path)',
    '    finish(True)',
    'except FileNotFoundError:',
    '    finish(False, "error.path-not-found")',
    'except PermissionError:',
    '    finish(False, "error.path-permission-denied")',
    'except OSError:',
    '    finish(False, "error.failed-read-repo")',
    'PY',
  ].join('\n')
}

function remoteDeleteFileTreeScript(command: Extract<RemoteCommandKind, { type: 'deleteFileTreeEntries' }>): string {
  return [
    "python3 - <<'PY'",
    ...remoteFileTreePreamble(command.worktreePath),
    `paths = ${pythonJson(command.paths)}`,
    'if not isinstance(paths, list) or len(paths) == 0:',
    '    finish(False, "error.invalid-arguments")',
    'targets = [writable_target(item) for item in paths]',
    'try:',
    '    for target in targets:',
    '        if os.path.isdir(target) and not os.path.islink(target):',
    '            shutil.rmtree(target)',
    '        else:',
    '            os.remove(target)',
    '    finish(True)',
    'except FileNotFoundError:',
    '    finish(False, "error.path-not-found")',
    'except PermissionError:',
    '    finish(False, "error.path-permission-denied")',
    'except OSError:',
    '    finish(False, "error.failed-read-repo")',
    'PY',
  ].join('\n')
}
```

- [ ] **Step 5: Wire command cases into `scriptForCommand`**

Add cases before `revParseTopLevel`:

```ts
    case 'renameFileTreeEntry':
      return remoteRenameFileTreeScript(command)
    case 'deleteFileTreeEntries':
      return remoteDeleteFileTreeScript(command)
```

- [ ] **Step 6: Run remote command tests**

Run:

```sh
bun run test src/system/ssh/commands.test.ts
```

Expected: PASS.

- [ ] **Step 7: No-commit checkpoint**

Run:

```sh
git diff -- src/system/ssh/commands.ts src/system/ssh/commands.test.ts
```

Expected: only remote command type/script/test changes appear.

---

### Task 3: Add Remote Mutation Wrappers

**Files:**
- Modify: `src/system/ssh/git.ts`
- Modify: `src/system/ssh/git.test.ts`

- [ ] **Step 1: Write failing remote wrapper tests**

Update the import in `src/system/ssh/git.test.ts` to include:

```ts
  deleteRemoteFileTreeEntries,
  renameRemoteFileTreeEntry,
```

Add tests near the existing file tree read test:

```ts
  test('renameRemoteFileTreeEntry returns parsed success and passes fixed command input', async () => {
    const run = vi.fn(async () => ({ ok: true, stdout: '{"ok":true,"message":""}', stderr: '' }))

    const result = await renameRemoteFileTreeEntry(
      TARGET,
      '/srv/repo',
      '/srv/repo/README.md',
      'README-renamed.md',
      { run: run as any },
    )

    expect(result).toEqual({ ok: true, message: '' })
    expect(run).toHaveBeenCalledWith(
      {
        type: 'renameFileTreeEntry',
        worktreePath: '/srv/repo',
        oldPath: '/srv/repo/README.md',
        newName: 'README-renamed.md',
      },
      TARGET,
      { signal: undefined },
    )
  })

  test('deleteRemoteFileTreeEntries returns parsed validation failure', async () => {
    const run = vi.fn(async () => ({
      ok: true,
      stdout: '{"ok":false,"message":"error.delete-root-forbidden"}',
      stderr: '',
    }))

    const result = await deleteRemoteFileTreeEntries(TARGET, '/srv/repo', ['/srv/repo'], { run: run as any })

    expect(result).toEqual({ ok: false, message: 'error.delete-root-forbidden' })
  })
```

- [ ] **Step 2: Run SSH git tests and verify failure**

Run:

```sh
bun run test src/system/ssh/git.test.ts
```

Expected: FAIL because the wrappers are not exported.

- [ ] **Step 3: Add remote mutation result parser**

Add this interface near `RemoteFileTreeJson` in `src/system/ssh/git.ts`:

```ts
interface RemoteFileTreeMutationJson {
  ok?: boolean
  message?: string
}
```

Add this helper near `remoteExecResult`:

```ts
function remoteFileTreeMutationResult(result: RemoteCommandResult): ExecResult {
  if (!result.ok && !result.stdout) return remoteExecResult(result)
  try {
    const parsed = JSON.parse(result.stdout) as RemoteFileTreeMutationJson
    if (parsed.ok === true) return { ok: true, message: parsed.message ?? '' }
    return { ok: false, message: parsed.message || 'error.failed-read-repo' }
  } catch {
    return { ok: false, message: 'error.failed-read-repo' }
  }
}
```

- [ ] **Step 4: Export remote mutation wrappers**

Add these functions after `listRemoteFileTreeDirectory`:

```ts
export async function renameRemoteFileTreeEntry(
  target: RemoteRepoTarget,
  worktreePath: string,
  oldPath: string,
  newName: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    { type: 'renameFileTreeEntry', worktreePath, oldPath, newName },
    target,
    { signal: options.signal },
  )
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  return remoteFileTreeMutationResult(result)
}

export async function deleteRemoteFileTreeEntries(
  target: RemoteRepoTarget,
  worktreePath: string,
  paths: string[],
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    { type: 'deleteFileTreeEntries', worktreePath, paths },
    target,
    { signal: options.signal },
  )
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  return remoteFileTreeMutationResult(result)
}
```

- [ ] **Step 5: Run SSH git tests**

Run:

```sh
bun run test src/system/ssh/git.test.ts src/system/ssh/commands.test.ts
```

Expected: PASS.

- [ ] **Step 6: No-commit checkpoint**

Run:

```sh
git diff -- src/system/ssh/git.ts src/system/ssh/git.test.ts
```

Expected: only remote file tree mutation wrapper and test changes appear.

---

### Task 4: Add Repo Write API, Routes, And Web Client

**Files:**
- Modify: `src/server/modules/repo-write-paths.ts`
- Modify: `src/server/modules/repo.test.ts`
- Modify: `src/server/routes/repo.ts`
- Modify: `src/web/repo-client.ts`
- Modify: `src/web/repo-client.test.ts`

- [ ] **Step 1: Write failing web client payload tests**

Append these tests to `src/web/repo-client.test.ts`:

```ts
  test('requests file tree rename through the embedded server', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: '' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { renameRepositoryFileTreeEntry } = await import('#/web/repo-client.ts')
    await expect(
      renameRepositoryFileTreeEntry('/repo', '/repo', '/repo/README.md', 'README-renamed.md'),
    ).resolves.toEqual({ ok: true, message: '' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/file-tree/rename',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
        body: JSON.stringify({
          repoId: '/repo',
          worktreePath: '/repo',
          oldPath: '/repo/README.md',
          newName: 'README-renamed.md',
        }),
      }),
    )
  })

  test('requests file tree delete through the embedded server', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: '' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { deleteRepositoryFileTreeEntries } = await import('#/web/repo-client.ts')
    await expect(deleteRepositoryFileTreeEntries('/repo', '/repo', ['/repo/README.md', '/repo/src'])).resolves.toEqual({
      ok: true,
      message: '',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/file-tree/delete',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
        body: JSON.stringify({
          repoId: '/repo',
          worktreePath: '/repo',
          paths: ['/repo/README.md', '/repo/src'],
        }),
      }),
    )
  })
```

- [ ] **Step 2: Run client tests and verify failure**

Run:

```sh
bun run test src/web/repo-client.test.ts
```

Expected: FAIL because the client functions do not exist.

- [ ] **Step 3: Add client functions**

Add to `src/web/repo-client.ts` after `getRepositoryFileTree`:

```ts
export async function renameRepositoryFileTreeEntry(
  repoId: string,
  worktreePath: string,
  oldPath: string,
  newName: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/file-tree/rename', { repoId, worktreePath, oldPath, newName })
}

export async function deleteRepositoryFileTreeEntries(
  repoId: string,
  worktreePath: string,
  paths: string[],
): Promise<ExecResult> {
  return await postServerJson('/api/repo/file-tree/delete', { repoId, worktreePath, paths })
}
```

- [ ] **Step 4: Add server write function tests**

In `src/server/modules/repo.test.ts`, extend `mocks`:

```ts
  deleteLocalFileTreeEntries: vi.fn(),
  deleteRemoteFileTreeEntries: vi.fn(),
  renameLocalFileTreeEntry: vi.fn(),
  renameRemoteFileTreeEntry: vi.fn(),
```

Add mocks:

```ts
vi.mock('#/system/file-tree/local.ts', () => ({
  deleteLocalFileTreeEntries: mocks.deleteLocalFileTreeEntries,
  renameLocalFileTreeEntry: mocks.renameLocalFileTreeEntry,
}))
```

Extend the existing `#/system/ssh/git.ts` mock with:

```ts
  deleteRemoteFileTreeEntries: mocks.deleteRemoteFileTreeEntries,
  renameRemoteFileTreeEntry: mocks.renameRemoteFileTreeEntry,
```

Set defaults in `beforeEach`:

```ts
  mocks.deleteLocalFileTreeEntries.mockResolvedValue({ ok: true, message: '' })
  mocks.deleteRemoteFileTreeEntries.mockResolvedValue({ ok: true, message: '' })
  mocks.renameLocalFileTreeEntry.mockResolvedValue({ ok: true, message: '' })
  mocks.renameRemoteFileTreeEntry.mockResolvedValue({ ok: true, message: '' })
```

Add tests inside `describe('repo mutation invalidation publishing', ...)`:

```ts
  test('renameRepositoryFileTreeEntry publishes snapshot invalidation after local success', async () => {
    const { renameRepositoryFileTreeEntry } = await import('#/server/modules/repo-write-paths.ts')

    const result = await renameRepositoryFileTreeEntry('/tmp/repo', '/tmp/repo', '/tmp/repo/README.md', 'README2.md')

    expect(result).toEqual({ ok: true, message: '' })
    expect(mocks.renameLocalFileTreeEntry).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo/README.md', 'README2.md')
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test('deleteRepositoryFileTreeEntries publishes snapshot invalidation after local success', async () => {
    const { deleteRepositoryFileTreeEntries } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepositoryFileTreeEntries('/tmp/repo', '/tmp/repo', ['/tmp/repo/README.md'])

    expect(result).toEqual({ ok: true, message: '' })
    expect(mocks.deleteLocalFileTreeEntries).toHaveBeenCalledWith('/tmp/repo', ['/tmp/repo/README.md'])
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test('file tree write failures do not publish snapshot invalidation', async () => {
    mocks.renameLocalFileTreeEntry.mockResolvedValueOnce({ ok: false, message: 'error.file-exists' })
    const { renameRepositoryFileTreeEntry } = await import('#/server/modules/repo-write-paths.ts')

    const result = await renameRepositoryFileTreeEntry('/tmp/repo', '/tmp/repo', '/tmp/repo/README.md', 'README2.md')

    expect(result).toEqual({ ok: false, message: 'error.file-exists' })
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })
```

- [ ] **Step 5: Run server tests and verify failure**

Run:

```sh
bun run test src/server/modules/repo.test.ts
```

Expected: FAIL because repo write functions do not exist.

- [ ] **Step 6: Implement repo write functions**

Update imports in `src/server/modules/repo-write-paths.ts`:

```ts
import { resolveRemoteRepoTarget, resolveRepoBackend, runWithRepoBackend } from '#/server/modules/repo-backend.ts'
import { deleteLocalFileTreeEntries, renameLocalFileTreeEntry } from '#/system/file-tree/local.ts'
import {
  deleteRemoteFileTreeEntries,
  renameRemoteFileTreeEntry,
} from '#/system/ssh/git.ts'
import { isRemoteRepoId, type NetworkOpKind } from '#/shared/rpc.ts'
```

Add functions near the other worktree-scoped mutations:

```ts
export async function renameRepositoryFileTreeEntry(
  repoId: string,
  worktreePath: string,
  oldPath: string,
  newName: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  const result = isRemoteRepoId(repoId)
    ? await renameRemoteFileTreeEntry(await resolveRemoteRepoTarget(repoId), worktreePath, oldPath, newName, { signal })
    : await renameLocalFileTreeEntry(worktreePath, oldPath, newName)
  if (result.ok) publishRepoSnapshotInvalidation(repoId, sourceToken)
  return result
}

export async function deleteRepositoryFileTreeEntries(
  repoId: string,
  worktreePath: string,
  paths: string[],
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  const result = isRemoteRepoId(repoId)
    ? await deleteRemoteFileTreeEntries(await resolveRemoteRepoTarget(repoId), worktreePath, paths, { signal })
    : await deleteLocalFileTreeEntries(worktreePath, paths)
  if (result.ok) publishRepoSnapshotInvalidation(repoId, sourceToken)
  return result
}
```

- [ ] **Step 7: Add routes**

Add imports in `src/server/routes/repo.ts`:

```ts
  deleteRepositoryFileTreeEntries,
  renameRepositoryFileTreeEntry,
```

Add route handlers after the existing `/file-tree` route:

```ts
  app.post('/file-tree/rename', async (c) => {
    const body = await c.req.json().catch(() => null)
    const repoId = typeof body?.repoId === 'string' ? body.repoId : ''
    const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
    const oldPath = typeof body?.oldPath === 'string' ? body.oldPath : ''
    const newName = typeof body?.newName === 'string' ? body.newName : ''
    const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
    return c.json(
      await jsonOr(
        () => renameRepositoryFileTreeEntry(repoId, worktreePath, oldPath, newName, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'file-tree-rename',
      ),
    )
  })

  app.post('/file-tree/delete', async (c) => {
    const body = await c.req.json().catch(() => null)
    const repoId = typeof body?.repoId === 'string' ? body.repoId : ''
    const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
    const paths = Array.isArray(body?.paths)
      ? body.paths.filter((item: unknown): item is string => typeof item === 'string')
      : []
    const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
    return c.json(
      await jsonOr(
        () => deleteRepositoryFileTreeEntries(repoId, worktreePath, paths, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'file-tree-delete',
      ),
    )
  })
```

- [ ] **Step 8: Run server and client tests**

Run:

```sh
bun run test src/server/modules/repo.test.ts src/web/repo-client.test.ts
```

Expected: PASS.

- [ ] **Step 9: No-commit checkpoint**

Run:

```sh
git diff -- src/server/modules/repo-write-paths.ts src/server/modules/repo.test.ts src/server/routes/repo.ts src/web/repo-client.ts src/web/repo-client.test.ts
```

Expected: only repo file tree write API, route, client, and tests changed.

---

### Task 5: Add I18n Keys

**Files:**
- Modify: `src/shared/i18n/en.ts`
- Modify: `src/shared/i18n/zh.ts`
- Modify: `src/shared/i18n/ja.ts`
- Modify: `src/shared/i18n/ko.ts`
- Verify: `src/shared/i18n/dictionaries.test.ts`

- [ ] **Step 1: Add English keys**

Add near existing `file-tree.*` keys in `src/shared/i18n/en.ts`:

```ts
  'file-tree.rename': 'Rename',
  'file-tree.delete': 'Delete',
  'file-tree.rename-input-label': 'New name',
  'file-tree.delete-confirm-title': 'Delete permanently?',
  'file-tree.delete-confirm-single-body': 'This will permanently delete {name}.',
  'file-tree.delete-confirm-multiple-body': 'This will permanently delete {count} selected items.',
  'file-tree.delete-confirm-directory-note': 'Directories and their contents will be deleted.',
  'file-tree.delete-confirm-confirm': 'Delete',
```

Add near existing `error.*` keys:

```ts
  'error.file-exists': 'A file or folder with that name already exists',
  'error.delete-root-forbidden': 'Cannot delete or rename the worktree root',
```

- [ ] **Step 2: Add Chinese keys**

Add near existing `file-tree.*` keys in `src/shared/i18n/zh.ts`:

```ts
  'file-tree.rename': '重命名',
  'file-tree.delete': '删除',
  'file-tree.rename-input-label': '新名称',
  'file-tree.delete-confirm-title': '永久删除？',
  'file-tree.delete-confirm-single-body': '将永久删除 {name}。',
  'file-tree.delete-confirm-multiple-body': '将永久删除选中的 {count} 项。',
  'file-tree.delete-confirm-directory-note': '目录及其中内容都会被删除。',
  'file-tree.delete-confirm-confirm': '删除',
```

Add near existing `error.*` keys:

```ts
  'error.file-exists': '已存在同名文件或文件夹',
  'error.delete-root-forbidden': '不能删除或重命名工作树根目录',
```

- [ ] **Step 3: Add Japanese keys**

Add near existing `file-tree.*` keys in `src/shared/i18n/ja.ts`:

```ts
  'file-tree.rename': '名前を変更',
  'file-tree.delete': '削除',
  'file-tree.rename-input-label': '新しい名前',
  'file-tree.delete-confirm-title': '完全に削除しますか？',
  'file-tree.delete-confirm-single-body': '{name} を完全に削除します。',
  'file-tree.delete-confirm-multiple-body': '選択した {count} 件を完全に削除します。',
  'file-tree.delete-confirm-directory-note': 'フォルダとその中身も削除されます。',
  'file-tree.delete-confirm-confirm': '削除',
```

Add near existing `error.*` keys:

```ts
  'error.file-exists': '同じ名前のファイルまたはフォルダが既に存在します',
  'error.delete-root-forbidden': 'ワークツリーのルートは削除または名前変更できません',
```

- [ ] **Step 4: Add Korean keys**

Add near existing `file-tree.*` keys in `src/shared/i18n/ko.ts`:

```ts
  'file-tree.rename': '이름 바꾸기',
  'file-tree.delete': '삭제',
  'file-tree.rename-input-label': '새 이름',
  'file-tree.delete-confirm-title': '영구 삭제할까요?',
  'file-tree.delete-confirm-single-body': '{name} 항목을 영구 삭제합니다.',
  'file-tree.delete-confirm-multiple-body': '선택한 {count}개 항목을 영구 삭제합니다.',
  'file-tree.delete-confirm-directory-note': '폴더와 그 안의 내용도 삭제됩니다.',
  'file-tree.delete-confirm-confirm': '삭제',
```

Add near existing `error.*` keys:

```ts
  'error.file-exists': '같은 이름의 파일 또는 폴더가 이미 있습니다',
  'error.delete-root-forbidden': '워크트리 루트는 삭제하거나 이름을 바꿀 수 없습니다',
```

- [ ] **Step 5: Run dictionary tests**

Run:

```sh
bun run test src/shared/i18n/dictionaries.test.ts
```

Expected: PASS.

- [ ] **Step 6: No-commit checkpoint**

Run:

```sh
git diff -- src/shared/i18n/en.ts src/shared/i18n/zh.ts src/shared/i18n/ja.ts src/shared/i18n/ko.ts
```

Expected: all languages contain the same new keys.

---

### Task 6: Add File Tree UI Actions

**Files:**
- Modify: `src/web/components/file-tree/ProjectFileTree.tsx`
- Modify: `src/web/components/file-tree/ProjectFileTree.test.tsx`

- [ ] **Step 1: Extend client mocks in the component test**

Update the repo-client mock in `src/web/components/file-tree/ProjectFileTree.test.tsx`:

```ts
const renameRepositoryFileTreeEntry = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, message: '' }))
const deleteRepositoryFileTreeEntries = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, message: '' }))

vi.mock('#/web/repo-client.ts', () => ({
  getRepositoryFileTree: (...args: unknown[]) => getRepositoryFileTree(...args),
  renameRepositoryFileTreeEntry: (...args: unknown[]) => renameRepositoryFileTreeEntry(...args),
  deleteRepositoryFileTreeEntries: (...args: unknown[]) => deleteRepositoryFileTreeEntries(...args),
  openRepositoryEditor: vi.fn(async () => ({ ok: true, message: '' })),
  openRepositoryTerminal: vi.fn(async () => ({ ok: true, message: '' })),
}))
```

Clear the new mocks in `beforeEach`:

```ts
  renameRepositoryFileTreeEntry.mockClear()
  deleteRepositoryFileTreeEntries.mockClear()
```

- [ ] **Step 2: Write failing UI tests**

Append tests inside `describe('ProjectFileTree', ...)`:

```tsx
  test('shows rename and delete actions for real context nodes', async () => {
    seedRepoWithSelectedBranch({ hasWorktree: true })

    await render(<ProjectFileTree repoId="/repo" />)

    const row = treeItemByText('README.md')
    await act(async () => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('file-tree.rename')
    expect(document.body.textContent).toContain('file-tree.delete')
  })

  test('starts rename from Enter and submits the new basename', async () => {
    seedRepoWithSelectedBranch({ hasWorktree: true })

    await render(<ProjectFileTree repoId="/repo" />)

    const row = treeItemByText('README.md')
    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      row.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await Promise.resolve()
    })

    const input = container?.querySelector<HTMLInputElement>('input[aria-label="file-tree.rename-input-label"]')
    if (!input) throw new Error('missing rename input')

    await act(async () => {
      input.value = 'README-renamed.md'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(renameRepositoryFileTreeEntry).toHaveBeenCalledWith(
      '/repo',
      '/repo',
      '/repo/README.md',
      'README-renamed.md',
    )
  })

  test('confirms delete before sending selected paths', async () => {
    seedRepoWithSelectedBranch({ hasWorktree: true })

    await render(<ProjectFileTree repoId="/repo" />)

    const row = treeItemByText('README.md')
    await act(async () => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
      await Promise.resolve()
    })

    const deleteItem = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.includes('file-tree.delete'),
    )
    if (!deleteItem) throw new Error('missing delete menu item')

    await act(async () => {
      deleteItem.click()
      await Promise.resolve()
    })

    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('file-tree.delete-confirm-confirm'),
    )
    if (!confirm) throw new Error('missing delete confirm button')

    await act(async () => {
      confirm.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(deleteRepositoryFileTreeEntries).toHaveBeenCalledWith('/repo', '/repo', ['/repo/README.md'])
  })
```

- [ ] **Step 3: Run UI tests and verify failure**

Run:

```sh
bun run test src/web/components/file-tree/ProjectFileTree.test.tsx
```

Expected: FAIL because the UI actions and keyboard rename do not exist.

- [ ] **Step 4: Add imports**

Update `ProjectFileTree.tsx` imports:

```tsx
import { ChevronDown, ChevronRight, File, FileSymlink, Folder, FolderOpen, Pencil, RefreshCw, Trash2 } from 'lucide-react'
```

Extend repo-client imports:

```ts
  deleteRepositoryFileTreeEntries,
  getRepositoryFileTree,
  openRepositoryEditor,
  openRepositoryTerminal,
  renameRepositoryFileTreeEntry,
```

Extend dropdown imports:

```ts
  DropdownMenuSeparator,
```

Add UI imports:

```tsx
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
import { Input } from '#/web/components/ui/input.tsx'
```

- [ ] **Step 5: Add operation state**

Inside `ProjectFileTree`, add state after context menu state:

```tsx
  const [renameNode, setRenameNode] = useState<FileTreeNode | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamePending, setRenamePending] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<FileTreeNode[]>([])
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
```

Clear these states in the existing `useEffect` that resets state on `worktreePath` change:

```tsx
    setRenameNode(null)
    setRenameValue('')
    setRenamePending(false)
    setRenameError(null)
    setDeleteTargets([])
    setDeletePending(false)
    setDeleteError(null)
```

- [ ] **Step 6: Add selection and cache helpers inside `ProjectFileTree`**

Add these callbacks after `handleContextMenu`:

```tsx
  const realSelectedNodes = useMemo(
    () => Array.from(selection.selected)
      .map((id) => flatNodeById.get(id))
      .filter((node): node is FileTreeNode => !!node && isWritableNode(node)),
    [flatNodeById, selection.selected],
  )

  const refreshDirectoryForNode = useCallback(
    async (node: FileTreeNode) => {
      if (!worktreePath) return
      const parentRelativePath = parentRelativePathForNode(node)
      const parentAbsolutePath = parentAbsolutePathForNode(worktreePath, node)
      await loadDirectory(parentRelativePath, parentAbsolutePath)
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

  const beginRename = useCallback((node: FileTreeNode) => {
    if (!isWritableNode(node)) return
    setRenameNode(node)
    setRenameValue(node.name)
    setRenameError(null)
    setContextOpen(false)
  }, [])

  const beginDelete = useCallback((node: FileTreeNode) => {
    if (!isWritableNode(node)) return
    const targets = selection.selected.has(node.id) ? realSelectedNodes : [node]
    setDeleteTargets(targets.filter(isWritableNode))
    setDeleteError(null)
    setContextOpen(false)
  }, [realSelectedNodes, selection.selected])
```

- [ ] **Step 7: Add mutation submit handlers**

Add after the helpers from Step 6:

```tsx
  const submitRename = useCallback(async () => {
    if (!worktreePath || !renameNode) return
    const nextName = renameValue.trim()
    if (!nextName || nextName === renameNode.name) {
      setRenameNode(null)
      setRenameValue('')
      setRenameError(null)
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
    setRenameNode(null)
    setRenameValue('')
    await refreshDirectoryForNode(renameNode)
  }, [clearCachedDescendants, refreshDirectoryForNode, renameNode, renameValue, repoId, worktreePath])

  const submitDelete = useCallback(async () => {
    if (!worktreePath || deleteTargets.length === 0) return
    setDeletePending(true)
    setDeleteError(null)
    const result = await deleteRepositoryFileTreeEntries(
      repoId,
      worktreePath,
      deleteTargets.map((node) => node.absolutePath),
    )
    setDeletePending(false)
    if (!result.ok) {
      setDeleteError(result.message)
      return
    }
    const deletedIds = new Set(deleteTargets.map((node) => node.id))
    clearCachedDescendants(deleteTargets)
    setSelection((current) => {
      const selected = new Set(current.selected)
      for (const id of deletedIds) selected.delete(id)
      return { selected, anchor: current.anchor && deletedIds.has(current.anchor) ? null : current.anchor }
    })
    const parents = uniqueParentNodes(deleteTargets)
    setDeleteTargets([])
    for (const parentSource of parents) {
      await refreshDirectoryForNode(parentSource)
    }
  }, [clearCachedDescendants, deleteTargets, refreshDirectoryForNode, repoId, worktreePath])
```

- [ ] **Step 8: Pass operation props to `FileTreeRow`**

Add props to each `FileTreeRow` render:

```tsx
                renameNodeId={renameNode?.id ?? null}
                renameValue={renameValue}
                renamePending={renamePending}
                renameError={renameError}
                onRenameValueChange={setRenameValue}
                onRenameCancel={() => {
                  setRenameNode(null)
                  setRenameValue('')
                  setRenameError(null)
                }}
                onRenameSubmit={submitRename}
                onBeginRename={beginRename}
```

Thread the same props through recursive child `FileTreeRow` renders.

- [ ] **Step 9: Update `FileTreeRow` keyboard and inline edit rendering**

Extend `FileTreeRow` props with:

```tsx
  renameNodeId: string | null
  renameValue: string
  renamePending: boolean
  renameError: string | null
  onRenameValueChange: (value: string) => void
  onRenameCancel: () => void
  onRenameSubmit: () => void
  onBeginRename: (node: FileTreeNode) => void
```

Add `tabIndex={0}` and `onKeyDown` to the row div:

```tsx
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && selected && isWritableNode(node)) {
            event.preventDefault()
            onBeginRename(node)
          }
        }}
```

Replace the name span with:

```tsx
        {renameNodeId === node.id ? (
          <Input
            aria-label="file-tree.rename-input-label"
            value={renameValue}
            disabled={renamePending}
            autoFocus
            onChange={(event) => onRenameValueChange(event.currentTarget.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={onRenameCancel}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onRenameCancel()
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                void onRenameSubmit()
              }
            }}
            className="h-5 min-w-0 flex-1 px-1 py-0 text-xs"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        )}
```

Show inline rename error below the row:

```tsx
      {renameNodeId === node.id && renameError ? (
        <FileTreeIndentedMessage depth={depth + 1}>{renameError}</FileTreeIndentedMessage>
      ) : null}
```

- [ ] **Step 10: Extend context menu**

Update `FileTreeContextMenu` props:

```tsx
  onBeginRename: (node: FileTreeNode) => void
  onBeginDelete: (node: FileTreeNode) => void
```

Pass them from `ProjectFileTree`:

```tsx
        onBeginRename={beginRename}
        onBeginDelete={beginDelete}
```

Add menu items after open actions:

```tsx
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
```

- [ ] **Step 11: Render delete confirmation dialog**

Add below `FileTreeContextMenu` in `ProjectFileTree`:

```tsx
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
```

Add the component near `FileTreeContextMenu`:

```tsx
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
```

- [ ] **Step 12: Add pure helpers at the bottom of `ProjectFileTree.tsx`**

Add near `parentPath`:

```ts
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
```

- [ ] **Step 13: Run UI tests**

Run:

```sh
bun run test src/web/components/file-tree/ProjectFileTree.test.tsx
```

Expected: PASS. If Radix menu timing requires another microtask in jsdom, add one `await Promise.resolve()` in the tests rather than changing production timing.

- [ ] **Step 14: No-commit checkpoint**

Run:

```sh
git diff -- src/web/components/file-tree/ProjectFileTree.tsx src/web/components/file-tree/ProjectFileTree.test.tsx
```

Expected: only file tree UI action and test changes appear.

---

### Task 7: Final Verification

**Files:**
- Verify all touched files from previous tasks.

- [ ] **Step 1: Run focused tests**

Run:

```sh
bun run test src/system/file-tree/local.test.ts src/system/ssh/commands.test.ts src/system/ssh/git.test.ts src/server/modules/repo.test.ts src/web/repo-client.test.ts src/shared/i18n/dictionaries.test.ts src/web/components/file-tree/ProjectFileTree.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```sh
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run architecture guard**

Run:

```sh
bun run check:architecture
```

Expected: PASS. The new imports must preserve these boundaries:

- `src/main/**` does not import `src/web/**` or `src/server/**`.
- `src/web/**` does not import `src/main/**`.
- `src/server/**` and `src/shared/**` do not import `electron`.

- [ ] **Step 4: Run full test suite if focused tests or typecheck reveal shared breakage**

Run:

```sh
bun run test
```

Expected: PASS.

- [ ] **Step 5: Review final diff**

Run:

```sh
git diff --stat
```

Expected: changes are limited to file tree local/remote write helpers, repo write routes/client, i18n, file tree UI, tests, and this plan.

---

## Implementation Notes

- Do not implement double-click rename. `Enter` on the selected row and context menu rename are the only rename triggers.
- Do not implement trash/recycle behavior. Delete is permanent and must keep the confirmation dialog.
- Do not allow rename to overwrite. Return `error.file-exists`.
- Do not allow delete or rename of the worktree root. Return `error.delete-root-forbidden`.
- Treat renderer paths as untrusted. Client-side checks may improve UX, but server-side checks are authoritative.
- Keep remote commands as fixed command kinds with JSON/Python string encoding. Do not build commands from renderer-provided shell fragments.
- Preserve TypeScript strip-only constraints: no enums, runtime namespaces, parameter properties, or import aliases.
