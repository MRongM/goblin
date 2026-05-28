import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmp: string | null = null

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
  vi.resetModules()
  vi.doUnmock('electron')
  vi.doUnmock('write-file-atomic')
})

test('defaults auto-fetch to two minutes', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const settings = await import('#/main/settings.ts')

  const loaded = await settings.loadSettings()

  expect(loaded.fetchIntervalSec).toBe(120)
})

test('flushSettings drains writes queued during an in-flight flush', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  let settings!: typeof import('#/main/settings.ts')
  const writeFile = fs.writeFile.bind(fs)
  let writes = 0
  vi.doMock('write-file-atomic', () => ({
    default: async (...args: Parameters<typeof writeFile>) => {
      writes += 1
      if (writes === 1) await settings.setFetchInterval(300)
      return writeFile(...args)
    },
  }))
  settings = await import('#/main/settings.ts')

  await settings.setThemePref('dark')
  const flushed = await settings.flushSettings()
  expect(flushed).toBe(true)

  const saved = JSON.parse(readFileSync(path.join(tmp, 'settings.json'), 'utf-8')) as { fetchIntervalSec: number }
  expect(writes).toBe(2)
  expect(saved.fetchIntervalSec).toBe(300)
})

test('flushSettings reports earlier failures in a chained flush', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  let settings!: typeof import('#/main/settings.ts')
  const writeFile = fs.writeFile.bind(fs)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  let writes = 0
  vi.doMock('write-file-atomic', () => ({
    default: async (...args: Parameters<typeof writeFile>) => {
      writes += 1
      if (writes === 1) {
        await settings.setFetchInterval(301)
        throw new Error('disk full')
      }
      return writeFile(...args)
    },
  }))
  settings = await import('#/main/settings.ts')

  try {
    await settings.setThemePref('light')
    const flushed = await settings.flushSettings()
    expect(flushed).toBe(false)
  } finally {
    warn.mockRestore()
  }

  const saved = JSON.parse(readFileSync(path.join(tmp, 'settings.json'), 'utf-8')) as {
    theme: string
    fetchIntervalSec: number
  }
  expect(writes).toBe(2)
  expect(saved.theme).toBe('light')
  expect(saved.fetchIntervalSec).toBe(301)
})

test('persists the selected color theme', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const settings = await import('#/main/settings.ts')

  await settings.setColorTheme('shadcn')
  const flushed = await settings.flushSettings()
  expect(flushed).toBe(true)

  const saved = JSON.parse(readFileSync(path.join(tmp, 'settings.json'), 'utf-8')) as { colorTheme: string }
  expect(saved.colorTheme).toBe('shadcn')
})

test('persists session detail focus mode', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const settings = await import('#/main/settings.ts')

  await settings.setSession({
    openRepos: [],
    activeRepo: null,
    detailCollapsed: true,
    detailFocusMode: true,
    workspaceLayout: 'top-bottom',
    detailPaneSizes: { 'top-bottom': 50, 'left-right': 60 },
  })
  const flushed = await settings.flushSettings()
  expect(flushed).toBe(true)

  const saved = JSON.parse(readFileSync(path.join(tmp, 'settings.json'), 'utf-8')) as {
    session: { detailFocusMode: boolean }
  }
  expect(saved.session.detailFocusMode).toBe(true)
})

test('normalizes legacy local session paths and typed remote entries', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  writeFileSync(
    path.join(tmp, 'settings.json'),
    JSON.stringify({
      session: {
        openRepos: [
          '/tmp/local-repo',
          {
            kind: 'remote',
            id: 'ssh://deploy@prod:22/srv/goblin',
            target: {
              id: 'ssh://deploy@prod:22/srv/goblin',
              alias: 'prod',
              host: 'prod',
              user: 'deploy',
              port: 22,
              remotePath: '/srv/goblin',
              identityFile: '~/.ssh/prod_ed25519',
              displayName: 'prod:goblin',
              password: 'secret',
              passphrase: 'secret',
              privateKey: 'secret',
              stderr: 'sensitive stderr',
              terminalOutput: 'sensitive output',
            },
          },
        ],
        activeRepo: 'ssh://deploy@prod:22/srv/goblin',
        detailCollapsed: false,
        detailFocusMode: false,
        workspaceLayout: 'branches',
        detailPaneSizes: { 'top-bottom': 50, 'left-right': 60 },
      },
    }),
  )
  const settings = await import('#/main/settings.ts')

  const loaded = await settings.loadSettings()

  expect(loaded.session.openRepos).toEqual([
    { kind: 'local', id: '/tmp/local-repo' },
    {
      kind: 'remote',
      id: 'ssh://deploy@prod:22/srv/goblin',
      target: {
        id: 'ssh://deploy@prod:22/srv/goblin',
        alias: 'prod',
        host: 'prod',
        user: 'deploy',
        port: 22,
        remotePath: '/srv/goblin',
        identityFile: '~/.ssh/prod_ed25519',
        displayName: 'prod:goblin',
      },
    },
  ])
  expect(JSON.stringify(loaded.session)).not.toMatch(/password|passphrase|privateKey|stderr|terminalOutput|secret/)
  expect(loaded.session.activeRepo).toBe('ssh://deploy@prod:22/srv/goblin')
})

test('drops malformed remote session entries and clears stale active repo', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  writeFileSync(
    path.join(tmp, 'settings.json'),
    JSON.stringify({
      session: {
        openRepos: [
          {
            kind: 'remote',
            id: 'ssh://deploy@prod:22/srv/other',
            target: {
              id: 'ssh://deploy@prod:22/srv/goblin',
              alias: null,
              host: 'prod',
              user: 'deploy',
              port: 22,
              remotePath: '/srv/goblin',
              displayName: 'prod:goblin',
            },
          },
        ],
        activeRepo: 'ssh://deploy@prod:22/srv/other',
        detailCollapsed: false,
        detailFocusMode: false,
        workspaceLayout: 'branches',
        detailPaneSizes: { 'top-bottom': 50, 'left-right': 60 },
      },
    }),
  )
  const settings = await import('#/main/settings.ts')

  const loaded = await settings.loadSettings()

  expect(loaded.session.openRepos).toEqual([])
  expect(loaded.session.activeRepo).toBeNull()
})
