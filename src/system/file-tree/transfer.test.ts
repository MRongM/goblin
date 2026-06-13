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

describe('local file transfer naming', () => {
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
    expect(result.renamed).toEqual([expect.objectContaining({ requestedName: 'src', destinationName: 'src copy' })])
    await expect(readFile(join(root, 'dest', 'src copy', 'nested', 'a.txt'), 'utf8')).resolves.toBe('hello')
  })

  test('writes uploaded bytes to the target directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goblin-file-transfer-'))
    const item = {
      name: 'pasted.txt',
      mimeType: 'text/plain',
      bytesBase64: Buffer.from('hello').toString('base64'),
      byteLength: 5,
    }

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
    expect(inventory.entries).toEqual([expect.objectContaining({ kind: 'symlink', sourcePath: join(root, 'link.txt') })])
  })

  test('decodes uploaded base64 with byte length validation', () => {
    expect(
      decodeUploadedItem({
        bytesBase64: Buffer.from('hello').toString('base64'),
        byteLength: 5,
      }),
    ).toEqual(Buffer.from('hello'))
    expect(
      decodeUploadedItem({
        bytesBase64: Buffer.from('hello').toString('base64'),
        byteLength: 4,
      }),
    ).toBeNull()
  })
})
