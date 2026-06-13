import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import {
  deleteLocalFileTreeEntries,
  listLocalFileTreeDirectory,
  pathInsideRoot,
  renameLocalFileTreeEntry,
} from '#/system/file-tree/local.ts'

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
