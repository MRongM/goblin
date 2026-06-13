import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('#/server/modules/repo-backend.ts', () => ({
  resolveRemoteRepoTarget: vi.fn(),
}))

vi.mock('#/system/ssh/git.ts', () => ({
  createRemoteDirectory: vi.fn(),
  createRemoteSymlink: vi.fn(),
  inventoryRemoteFileTransfer: vi.fn(),
  listRemoteFileTreeDirectory: vi.fn(),
  readRemoteFileBase64: vi.fn(),
  writeRemoteFileBase64: vi.fn(),
}))

import { transferRepositoryFiles } from '#/server/modules/repo-file-transfer.ts'
import { resolveRemoteRepoTarget } from '#/server/modules/repo-backend.ts'
import { normalizeRemoteRepoId, normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import {
  createRemoteDirectory,
  inventoryRemoteFileTransfer,
  listRemoteFileTreeDirectory,
  readRemoteFileBase64,
  writeRemoteFileBase64,
} from '#/system/ssh/git.ts'

const REMOTE_ID = normalizeRemoteRepoId({ alias: 'prod', remotePath: '/srv/repo' })
const REMOTE_TARGET = normalizeRemoteTarget({
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo',
})!

describe('transferRepositoryFiles', () => {
  beforeEach(() => {
    vi.mocked(resolveRemoteRepoTarget).mockReset()
    vi.mocked(createRemoteDirectory).mockReset()
    vi.mocked(inventoryRemoteFileTransfer).mockReset()
    vi.mocked(listRemoteFileTreeDirectory).mockReset()
    vi.mocked(readRemoteFileBase64).mockReset()
    vi.mocked(writeRemoteFileBase64).mockReset()
    vi.mocked(resolveRemoteRepoTarget).mockResolvedValue(REMOTE_TARGET)
    vi.mocked(createRemoteDirectory).mockResolvedValue({ ok: true, message: '' })
    vi.mocked(listRemoteFileTreeDirectory).mockResolvedValue({
      ok: true,
      worktreePath: '/srv/repo',
      dirPath: '/srv/repo/docs',
      entries: [],
    })
    vi.mocked(writeRemoteFileBase64).mockResolvedValue({ ok: true, message: '' })
  })

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

  test('writes uploaded items to a remote target', async () => {
    const bytesBase64 = Buffer.from('hello').toString('base64')

    const result = await transferRepositoryFiles({
      repoId: REMOTE_ID,
      worktreePath: '/srv/repo',
      targetDirPath: '/srv/repo/docs',
      source: {
        kind: 'uploadedItems',
        items: [{ name: 'pasted.txt', bytesBase64, byteLength: 5 }],
      },
    })

    expect(result).toEqual({
      ok: true,
      copied: [{ destinationPath: '/srv/repo/docs/pasted.txt', kind: 'file' }],
      renamed: [],
      failed: [],
    })
    expect(resolveRemoteRepoTarget).toHaveBeenCalledWith(REMOTE_ID)
    expect(createRemoteDirectory).toHaveBeenCalledWith(REMOTE_TARGET, '/srv/repo/docs')
    expect(writeRemoteFileBase64).toHaveBeenCalledWith(REMOTE_TARGET, '/srv/repo/docs/pasted.txt', bytesBase64)
  })

  test('copies remote file tree paths to a remote target', async () => {
    const bytesBase64 = Buffer.from('hello').toString('base64')
    vi.mocked(inventoryRemoteFileTransfer).mockResolvedValue({
      ok: true,
      totalBytes: 5,
      entries: [{ path: '/srv/repo/a.txt', relativePath: 'a.txt', kind: 'file', size: 5 }],
    })
    vi.mocked(readRemoteFileBase64).mockResolvedValue({ ok: true, bytesBase64 })

    const result = await transferRepositoryFiles({
      repoId: REMOTE_ID,
      worktreePath: '/srv/repo',
      targetDirPath: '/srv/repo/docs',
      source: {
        kind: 'fileTreePaths',
        repoId: REMOTE_ID,
        worktreePath: '/srv/repo',
        paths: ['/srv/repo/a.txt'],
      },
    })

    expect(result).toEqual({
      ok: true,
      copied: [{ sourcePath: '/srv/repo/a.txt', destinationPath: '/srv/repo/docs/a.txt', kind: 'file' }],
      renamed: [],
      failed: [],
    })
    expect(inventoryRemoteFileTransfer).toHaveBeenCalledWith(REMOTE_TARGET, '/srv/repo', ['/srv/repo/a.txt'])
    expect(readRemoteFileBase64).toHaveBeenCalledWith(REMOTE_TARGET, '/srv/repo/a.txt')
    expect(writeRemoteFileBase64).toHaveBeenCalledWith(REMOTE_TARGET, '/srv/repo/docs/a.txt', bytesBase64)
  })
})
