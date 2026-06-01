import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { dialog, ipcMain } from 'electron'
import { checkoutRemoteTrackingBranch, isAncestor, getCurrentBranch, getUpstream } from '#/main/git/branches.ts'
import { getWorktrees } from '#/main/git/worktrees.ts'
import { getWorkingStatus } from '#/main/git/status.ts'
import { resolveRemovableWorktree } from '#/main/git/guards.ts'
import {
  checkoutRemoteBranch,
  checkoutRemoteTrackingBranchOnRemote,
  createRemoteWorktree,
  deleteRemoteBranch,
  fetchRemoteRepository,
  getRemoteGitHubUrl,
  pushRemoteBranch,
} from '#/main/ssh/git.ts'
import {
  initializeSshAccess,
  prepareSshInit,
  trustSshHostKey,
} from '#/main/ssh/initialization.ts'
import { openHttpsExternal } from '#/main/external-url.ts'
import { registerTrustedAppPath, registerTrustedWebContents } from '#/main/ipc/trusted-webcontents.ts'
import { wireRpcIpc } from '#/main/rpc.ts'
import type { RpcResponse } from '#/shared/rpc.ts'

const ipcHandlers = new Map<string, (_event: unknown, input: any) => Promise<unknown>>()

const remotePortMocks = vi.hoisted(() => ({
  cleanupRepo: vi.fn(),
  list: vi.fn(),
  scan: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, input: any) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler)
    }),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
}))

vi.mock('#/main/git/branches.ts', () => ({
  checkoutBranch: vi.fn(),
  checkoutRemoteTrackingBranch: vi.fn(() => ({ ok: true, message: 'checked out' })),
  deleteBranch: vi.fn(),
  getBranches: vi.fn(),
  getCurrentBranch: vi.fn(),
  getDefaultBranch: vi.fn(),
  getLog: vi.fn(),
  getRepoName: vi.fn(),
  getRepoRoot: vi.fn(() => '/repo'),
  getUpstream: vi.fn(),
  isAncestor: vi.fn(),
  isGitRepo: vi.fn(),
}))

vi.mock('#/main/git/worktrees.ts', () => ({
  createWorktree: vi.fn(),
  getWorktrees: vi.fn(),
  removeWorktree: vi.fn(),
}))

vi.mock('#/main/git/guards.ts', () => ({
  resolveKnownWorktree: vi.fn(),
  resolveRemovableWorktree: vi.fn(),
}))

vi.mock('#/main/git/helper.ts', () => ({
  checkGitAvailable: vi.fn(() => ({ ok: true })),
}))

vi.mock('#/main/git/remote.ts', () => ({
  fetchAll: vi.fn(),
  getGitHubUrl: vi.fn(),
  getPullRequestUrl: vi.fn(),
  pullBranch: vi.fn(),
  pushBranch: vi.fn(),
}))

vi.mock('#/main/git/status.ts', () => ({
  getWorkingStatus: vi.fn(),
}))

vi.mock('#/main/git/patch.ts', () => ({
  getWorktreePatch: vi.fn(),
}))

vi.mock('#/main/git/clone.ts', () => ({
  cloneRepository: vi.fn(),
}))

vi.mock('#/main/git/pull-requests.ts', () => ({
  getBranchPullRequest: vi.fn(),
  getBranchPullRequests: vi.fn(),
}))

vi.mock('#/main/git/log.ts', () => ({
  getCommitFileStats: vi.fn(),
  getCommitMeta: vi.fn(),
}))

vi.mock('#/main/window.ts', () => ({
  getMainWindow: vi.fn(() => null),
}))

vi.mock('#/main/theme.ts', () => ({
  getTheme: vi.fn(() => ({ pref: 'auto', resolved: 'light', colorTheme: 'default' })),
  setColorTheme: vi.fn(),
  setThemePref: vi.fn(),
  subscribeTheme: vi.fn(),
}))

vi.mock('#/main/settings.ts', () => ({
  DEFAULT_SESSION_DETAIL_COLLAPSED: false,
  addRecentRepo: vi.fn(),
  clearRecentRepos: vi.fn(),
  getEditorApp: vi.fn(() => 'auto'),
  getTerminalApp: vi.fn(() => 'auto'),
  loadSettings: vi.fn(() => ({
    theme: 'auto',
    colorTheme: 'default',
    fetchIntervalSec: 120,
    shortcutsDisabled: false,
    globalShortcut: '',
    terminalApp: 'auto',
    editorApp: 'auto',
    lang: 'auto',
    session: {
      openRepos: [],
      activeRepo: null,
      detailCollapsed: false,
      detailFocusMode: false,
      workspaceLayout: 'branches',
      detailPaneSizes: {},
    },
    recentRepos: [],
  })),
  onSettingsWriteError: vi.fn(),
  setEditorApp: vi.fn(),
  setFetchInterval: vi.fn(),
  setGlobalShortcut: vi.fn(),
  setSession: vi.fn(),
  setShortcutsDisabled: vi.fn(),
  setTerminalApp: vi.fn(),
}))

vi.mock('#/main/shortcuts.ts', () => ({
  isGlobalShortcutRegistered: vi.fn(() => false),
  replaceGlobalShortcut: vi.fn(() => true),
  syncGlobalShortcuts: vi.fn(),
}))

vi.mock('#/main/menu.ts', () => ({
  buildAppMenu: vi.fn(),
  setMenuWorkspaceLayout: vi.fn(),
}))

vi.mock('#/main/i18n/index.ts', () => ({
  applyLangPref: vi.fn(),
  getCurrentLang: vi.fn(() => 'en'),
  getDictionary: vi.fn(() => ({})),
}))

vi.mock('#/main/system/terminals.ts', () => ({
  getResolvedTerminalApp: vi.fn(() => null),
  openInPreferredTerminal: vi.fn(),
  openRemoteInPreferredTerminal: vi.fn(() => ({ ok: true, message: '/srv/goblin-feature-x' })),
}))

vi.mock('#/main/system/editors.ts', () => ({
  getResolvedEditorApp: vi.fn(() => null),
  openInPreferredEditor: vi.fn(),
  openRemoteInPreferredEditor: vi.fn(() => ({ ok: true, message: '/srv/goblin-feature-x' })),
}))

vi.mock('#/main/events.ts', () => ({
  broadcastRpcEvent: vi.fn(),
}))

vi.mock('#/main/terminal.ts', () => ({
  closeWorktreeSession: vi.fn(),
}))

vi.mock('#/main/external-url.ts', () => ({
  openHttpExternal: vi.fn(),
  openHttpsExternal: vi.fn(),
}))

vi.mock('#/main/ssh/port-forward.ts', () => ({
  remotePortForwardManager: remotePortMocks,
  wireRemotePortForwardCleanup: vi.fn(),
}))

vi.mock('#/main/ssh/config.ts', () => ({
  listSshConfigHosts: vi.fn(() => []),
  resolveRemoteTarget: vi.fn((input) => ({
    target: {
      id: `ssh://${input.user ?? 'deploy'}@${input.host ?? input.alias}:22${input.remotePath}`,
      alias: input.mode === 'config' ? input.alias : null,
      host: input.host ?? input.alias,
      user: input.user ?? 'deploy',
      port: input.port ?? 22,
      remotePath: input.remotePath,
      identityFile: input.identityFile,
      displayName: `${input.host ?? input.alias}:repo`,
    },
  })),
}))

vi.mock('#/main/ssh/diagnostics.ts', () => ({
  testRemoteRepository: vi.fn((target) => ({ target, ok: true, stages: [] })),
}))

vi.mock('#/main/ssh/git.ts', () => ({
  checkoutRemoteBranch: vi.fn(() => ({ ok: true, message: 'checked out' })),
  checkoutRemoteTrackingBranchOnRemote: vi.fn(() => ({ ok: true, message: 'checked out on server' })),
  createRemoteWorktree: vi.fn(() => ({ ok: true, message: 'created' })),
  deleteRemoteBranch: vi.fn(() => ({ ok: true, message: 'deleted' })),
  fetchRemoteRepository: vi.fn(() => ({ ok: true, message: 'fetched' })),
  getRemoteGitHubUrl: vi.fn(() => 'https://github.com/nano-props/goblin/pull/new/feature/x'),
  getRemoteLog: vi.fn(() => []),
  getRemotePatch: vi.fn(() => ({ ok: true, message: 'patch' })),
  getRemoteSnapshot: vi.fn(() => ({ branches: [], current: '' })),
  getRemoteStatus: vi.fn(() => []),
  pullRemoteBranch: vi.fn(() => ({ ok: true, message: 'pulled' })),
  pushRemoteBranch: vi.fn(() => ({ ok: true, message: 'pushed' })),
  removeRemoteWorktree: vi.fn(() => ({ ok: true, message: 'removed' })),
}))

vi.mock('#/main/ssh/initialization.ts', () => ({
  initializeSshAccess: vi.fn(() => ({ ok: true, message: 'ssh initialized' })),
  prepareSshInit: vi.fn(() => ({ ok: true, keyStatus: 'existing', hostKeyStatus: 'trusted' })),
  trustSshHostKey: vi.fn(() => ({ ok: true, message: 'host key trusted' })),
}))

vi.mock('#/main/ssh/path-picker.ts', () => ({
  getRemoteHome: vi.fn(() => '/home/deploy'),
  listRemoteDirectory: vi.fn(() => ({ path: '/home/deploy', entries: [], truncated: false })),
}))

const trustedSender = { id: 1 }
const trustedEvent = {
  sender: trustedSender,
  senderFrame: { url: 'file:///app/dist/renderer/index.html?theme=light' },
}

const REMOTE_TARGET = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: null,
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

async function invokeRpc(
  path: string,
  input?: unknown,
  event: unknown = trustedEvent,
  requestId?: string,
): Promise<RpcResponse> {
  const handler = ipcHandlers.get('goblin:rpc')
  if (!handler) throw new Error('RPC handler not wired')
  return handler(event, { path, input, requestId }) as Promise<RpcResponse>
}

async function invokeAbortRpc(input: unknown, event: unknown = trustedEvent): Promise<unknown> {
  const handler = ipcHandlers.get('goblin:rpc-abort')
  if (!handler) throw new Error('RPC abort handler not wired')
  return handler(event, input)
}

describe('main repo rpc cancellation', () => {
  beforeAll(() => {
    registerTrustedAppPath('/app/dist/renderer/index.html')
    registerTrustedWebContents({ id: 1, once: vi.fn() } as any)
    wireRpcIpc()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentBranch).mockResolvedValue('main')
    vi.mocked(getWorktrees).mockResolvedValue([{ path: '/repo', branch: 'main', isBare: false, isPrimary: true }])
    vi.mocked(getUpstream).mockResolvedValue(null)
    vi.mocked(isAncestor).mockImplementation(async () => {
      await invokeRpc('repo.abort', { cwd: '/repo' })
      return false
    })
    vi.mocked(resolveRemovableWorktree).mockReturnValue({
      ok: true,
      target: { path: '/repo-feature', branch: 'feature/cancel', isBare: false, isPrimary: false, isDirty: false },
    })
  })

  test('returns cancelled when deleteBranch is aborted during safety checks', async () => {
    const result = await invokeRpc('repo.deleteBranch', { cwd: '/repo', branch: 'feature/cancel' })

    expect(result).toEqual({ ok: true, data: { ok: false, message: 'cancelled' } })
  })

  test('returns cancelled when removeWorktree is aborted during safety checks', async () => {
    const result = await invokeRpc('repo.removeWorktree', {
      cwd: '/repo',
      branch: 'feature/cancel',
      worktreePath: '/repo-feature',
      alsoDeleteBranch: true,
    })

    expect(result).toEqual({ ok: true, data: { ok: false, message: 'cancelled' } })
  })

  test('rejects RPC calls from untrusted senders', async () => {
    const result = await invokeRpc('settings.get', undefined, {
      sender: { id: 99 },
      senderFrame: { url: 'https://example.com/' },
    })

    expect(result).toEqual({
      ok: false,
      error: { name: 'TRPCError', code: 'FORBIDDEN', message: 'Untrusted IPC sender' },
    })
  })

  test('rejects RPC calls without a sender frame', async () => {
    const result = await invokeRpc('settings.get', undefined, {
      sender: trustedSender,
      senderFrame: null,
    })

    expect(result).toEqual({
      ok: false,
      error: { name: 'TRPCError', code: 'FORBIDDEN', message: 'Untrusted IPC sender' },
    })
  })

  test('aborts a cancellable read RPC by request id', async () => {
    let observedSignal: AbortSignal | undefined
    vi.mocked(getWorkingStatus).mockImplementation(
      (_cwd, options) =>
        new Promise((resolve) => {
          observedSignal = options?.signal
          options?.signal?.addEventListener('abort', () => resolve([{ path: '/repo', isMain: true, entries: [] }]), {
            once: true,
          })
        }),
    )

    const status = invokeRpc('repo.status', { cwd: '/repo' }, trustedEvent, 'rpc-read-status')
    await vi.waitFor(() => expect(getWorkingStatus).toHaveBeenCalled())
    expect(observedSignal).toBeInstanceOf(AbortSignal)
    const aborted = await invokeAbortRpc({ requestId: 'rpc-read-status' }, trustedEvent)

    expect(aborted).toBe(true)
    await expect(status).resolves.toEqual({ ok: true, data: [] })
    expect(getWorkingStatus).toHaveBeenCalledWith('/repo', { signal: expect.any(AbortSignal) })
  })

  test('returns null when snapshot is aborted during worktree loading', async () => {
    let observedSignal: AbortSignal | undefined
    vi.mocked(getWorktrees).mockImplementation(
      (_cwd, options) =>
        new Promise((_resolve, reject) => {
          observedSignal = options?.signal
          options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        }),
    )

    const snapshot = invokeRpc('repo.snapshot', { cwd: '/repo' }, trustedEvent, 'rpc-read-snapshot')
    await vi.waitFor(() => expect(getWorktrees).toHaveBeenCalled())
    expect(observedSignal).toBeInstanceOf(AbortSignal)
    const aborted = await invokeAbortRpc({ requestId: 'rpc-read-snapshot' }, trustedEvent)

    expect(aborted).toBe(true)
    await expect(snapshot).resolves.toEqual({ ok: true, data: null })
  })

  test('aborts remote cancellable operations by request id', async () => {
    let observedSignal: AbortSignal | undefined
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    vi.mocked(fetchRemoteRepository).mockImplementation(
      (_target, options) =>
        new Promise((resolve) => {
          observedSignal = options?.signal
          markStarted()
          options?.signal?.addEventListener('abort', () => resolve({ ok: false, message: 'cancelled' }), {
            once: true,
          })
          setTimeout(() => resolve({ ok: true, message: 'not-cancelled' }), 100)
        }),
    )

    const fetch = invokeRpc('remote.fetch', { target: REMOTE_TARGET, kind: 'user' }, trustedEvent, 'rpc-remote-fetch')
    await started
    expect(observedSignal).toBeInstanceOf(AbortSignal)

    const aborted = await invokeAbortRpc({ requestId: 'rpc-remote-fetch' }, trustedEvent)

    expect(aborted).toBe(true)
    expect(observedSignal?.aborted).toBe(true)
    await expect(fetch).resolves.toEqual({ ok: true, data: { ok: false, message: 'cancelled' } })
  })

  test('rejects invalid remote manual ports at the router boundary', async () => {
    for (const port of [0, 65536, Number.NaN]) {
      const result = await invokeRpc('remote.resolveTarget', {
        mode: 'manual',
        host: 'prod',
        user: 'deploy',
        port,
        remotePath: '/srv/goblin',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('BAD_REQUEST')
    }
  })

  test('accepts optional remote identity file at the router boundary', async () => {
    const result = await invokeRpc('remote.resolveTarget', {
      mode: 'manual',
      host: 'prod',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      identityFile: '~/.ssh/prod_ed25519',
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toMatchObject({ target: { identityFile: '~/.ssh/prod_ed25519' } })
  })

  test('exposes typed SSH initialization procedures', async () => {
    await expect(
      invokeRpc(
        'remote.prepareSshInit',
        { host: 'prod.example.com', user: 'deploy', port: 2222 },
        trustedEvent,
        'rpc-ssh-init-prepare',
      ),
    ).resolves.toEqual({
      ok: true,
      data: { ok: true, keyStatus: 'existing', hostKeyStatus: 'trusted' },
    })
    await expect(
      invokeRpc(
        'remote.trustSshHostKey',
        {
          host: 'prod.example.com',
          port: 2222,
          key: 'prod.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKv7g9tYvQ==',
          fingerprint: 'SHA256:abc123',
        },
        trustedEvent,
        'rpc-ssh-init-trust-host-key',
      ),
    ).resolves.toEqual({ ok: true, data: { ok: true, message: 'host key trusted' } })
    await expect(
      invokeRpc(
        'remote.initializeSshAccess',
        {
          host: 'prod.example.com',
          user: 'deploy',
          port: 2222,
          password: 'temporary-password',
        },
        trustedEvent,
        'rpc-ssh-init-access',
      ),
    ).resolves.toEqual({ ok: true, data: { ok: true, message: 'ssh initialized' } })

    expect(prepareSshInit).toHaveBeenCalledWith(
      { host: 'prod.example.com', user: 'deploy', port: 2222 },
      { signal: expect.any(AbortSignal) },
    )
    expect(trustSshHostKey).toHaveBeenCalledWith(
      {
        host: 'prod.example.com',
        port: 2222,
        key: 'prod.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKv7g9tYvQ==',
        fingerprint: 'SHA256:abc123',
      },
      { signal: expect.any(AbortSignal) },
    )
    expect(initializeSshAccess).toHaveBeenCalledWith(
      { host: 'prod.example.com', user: 'deploy', port: 2222, password: 'temporary-password' },
      { signal: expect.any(AbortSignal) },
    )
  })

  test('rejects invalid SSH initialization inputs at the router boundary', async () => {
    const invalidInputs = [
      ['remote.prepareSshInit', { host: '', user: 'deploy', port: 22 }],
      ['remote.prepareSshInit', { host: 'bad\0host', user: 'deploy', port: 22 }],
      ['remote.prepareSshInit', { host: 'bad\nhost', user: 'deploy', port: 22 }],
      ['remote.prepareSshInit', { host: 'bad\rhost', user: 'deploy', port: 22 }],
      ['remote.prepareSshInit', { host: 'bad\u0001host', user: 'deploy', port: 22 }],
      ['remote.prepareSshInit', { host: 'prod', user: '', port: 22 }],
      ['remote.prepareSshInit', { host: 'prod', user: '   ', port: 22 }],
      ['remote.prepareSshInit', { host: 'prod', user: 'bad\ruser', port: 22 }],
      ['remote.prepareSshInit', { host: 'prod', user: 'deploy', port: 0 }],
      ['remote.trustSshHostKey', { host: 'prod', port: 22, key: '', fingerprint: 'SHA256:abc123' }],
      ['remote.trustSshHostKey', { host: 'prod', port: 22, key: 'prod\rssh-ed25519 AAAA', fingerprint: 'SHA256:abc123' }],
      ['remote.trustSshHostKey', { host: 'prod', port: 22, key: 'prod\u0001 ssh-ed25519 AAAA', fingerprint: 'SHA256:abc123' }],
      ['remote.trustSshHostKey', { host: 'prod', port: 22, key: 'prod ssh-ed25519 AAAA', fingerprint: '' }],
      ['remote.trustSshHostKey', { host: 'prod', port: 22, key: 'prod ssh-ed25519 AAAA', fingerprint: '   ' }],
      ['remote.trustSshHostKey', { host: 'prod', port: 22, key: 'prod ssh-ed25519 AAAA', fingerprint: 'bad\nfp' }],
      ['remote.trustSshHostKey', { host: 'prod', port: 22, key: 'prod ssh-ed25519 AAAA', fingerprint: 'SHA256:\u0001abc' }],
      ['remote.initializeSshAccess', { host: 'prod', user: 'deploy', port: 22, password: '' }],
      ['remote.initializeSshAccess', { host: 'prod', user: 'deploy', port: 65536, password: 'secret' }],
    ] as const
    const prepareSshInitCallCount = vi.mocked(prepareSshInit).mock.calls.length
    const trustSshHostKeyCallCount = vi.mocked(trustSshHostKey).mock.calls.length
    const initializeSshAccessCallCount = vi.mocked(initializeSshAccess).mock.calls.length

    for (const [path, input] of invalidInputs) {
      const result = await invokeRpc(path, input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('BAD_REQUEST')
    }
    expect(prepareSshInit).toHaveBeenCalledTimes(prepareSshInitCallCount)
    expect(trustSshHostKey).toHaveBeenCalledTimes(trustSshHostKeyCallCount)
    expect(initializeSshAccess).toHaveBeenCalledTimes(initializeSshAccessCallCount)
  })

  test('opens an SSH identity file dialog in the local .ssh directory', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/Users/deploy/.ssh/id_ed25519'],
    })

    const result = await invokeRpc('remote.identityFileDialog')

    expect(result).toEqual({ ok: true, data: '/Users/deploy/.ssh/id_ed25519' })
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringMatching(/[/\\]\.ssh$/),
        properties: expect.arrayContaining(['openFile', 'showHiddenFiles']),
        title: 'Choose SSH Private Key',
      }),
    )
  })

  test('accepts read-only remote snapshot, status, and log procedures', async () => {
    await expect(invokeRpc('remote.snapshot', { target: REMOTE_TARGET })).resolves.toMatchObject({ ok: true })
    await expect(invokeRpc('remote.status', { target: REMOTE_TARGET })).resolves.toMatchObject({ ok: true })
    await expect(
      invokeRpc('remote.log', {
        target: REMOTE_TARGET,
        branch: 'feature/x',
        count: 30,
        skip: 0,
      }),
    ).resolves.toMatchObject({ ok: true })
  })

  test('exposes typed remote fetch procedure', async () => {
    await expect(invokeRpc('remote.fetch', { target: REMOTE_TARGET, kind: 'background' })).resolves.toEqual({
      ok: true,
      data: { ok: true, message: 'fetched' },
    })

    expect(fetchRemoteRepository).toHaveBeenCalledWith(expect.objectContaining({ id: REMOTE_TARGET.id }), {
      signal: expect.any(AbortSignal),
    })
  })

  test('exposes typed remote branch action procedures', async () => {
    await expect(invokeRpc('remote.checkout', { target: REMOTE_TARGET, branch: 'feature/x' })).resolves.toMatchObject({
      ok: true,
    })
    await expect(
      invokeRpc('remote.checkoutRemoteBranch', { target: REMOTE_TARGET, remoteBranch: 'origin/feature/x' }),
    ).resolves.toEqual({ ok: true, data: { ok: true, message: 'checked out on server' } })
    await expect(invokeRpc('remote.push', { target: REMOTE_TARGET, branch: 'feature/x' })).resolves.toMatchObject({
      ok: true,
    })
    await expect(
      invokeRpc('remote.createWorktree', {
        target: REMOTE_TARGET,
        worktreePath: '/srv/goblin-feature-x',
        newBranch: 'feature/x',
        baseBranch: 'main',
      }),
    ).resolves.toMatchObject({ ok: true })

    expect(checkoutRemoteBranch).toHaveBeenCalledWith(
      expect.objectContaining({ id: REMOTE_TARGET.id }),
      'feature/x',
      undefined,
      { signal: expect.any(AbortSignal) },
    )
    expect(checkoutRemoteTrackingBranchOnRemote).toHaveBeenCalledWith(
      expect.objectContaining({ id: REMOTE_TARGET.id }),
      'origin/feature/x',
      { signal: expect.any(AbortSignal) },
    )
    expect(pushRemoteBranch).toHaveBeenCalledWith(expect.objectContaining({ id: REMOTE_TARGET.id }), 'feature/x', {
      signal: expect.any(AbortSignal),
    })
    expect(createRemoteWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ id: REMOTE_TARGET.id }),
      expect.objectContaining({
        baseBranch: 'main',
        newBranch: 'feature/x',
        signal: expect.any(AbortSignal),
        worktreePath: '/srv/goblin-feature-x',
      }),
    )
  })

  test('rejects invalid remote worktree action inputs', async () => {
    const result = await invokeRpc('remote.removeWorktree', {
      target: REMOTE_TARGET,
      branch: 'feature/x',
      worktreePath: 'relative',
      alsoDeleteBranch: true,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('BAD_REQUEST')
  })

  test('rejects invalid remote tracking checkout inputs before handler execution', async () => {
    const result = await invokeRpc('remote.checkoutRemoteBranch', {
      target: REMOTE_TARGET,
      remoteBranch: 'origin/bad branch',
    })

    expect(result).toEqual({ ok: true, data: { ok: false, message: 'error.invalid-arguments' } })
    expect(checkoutRemoteTrackingBranchOnRemote).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: REMOTE_TARGET.id }),
      'origin/bad branch',
      expect.anything(),
    )
  })

  test('routes local remote tracking checkout through typed repo RPC', async () => {
    const result = await invokeRpc('repo.checkoutRemoteBranch', {
      cwd: '/repo',
      remoteBranch: 'origin/feature/x',
    })

    expect(result).toEqual({ ok: true, data: { ok: true, message: 'checked out' } })
    expect(checkoutRemoteTrackingBranch).toHaveBeenCalledWith('/repo', 'origin/feature/x', expect.any(AbortSignal))
  })

  test('rejects invalid local remote tracking checkout inputs', async () => {
    const result = await invokeRpc('repo.checkoutRemoteBranch', {
      cwd: '/repo',
      remoteBranch: 'origin/bad branch',
    })

    expect(result).toEqual({ ok: true, data: { ok: false, message: 'error.invalid-arguments' } })
    expect(checkoutRemoteTrackingBranch).not.toHaveBeenCalledWith('/repo', 'origin/bad branch', expect.anything())
  })

  test('opens remote editor and external terminal through typed remote RPC', async () => {
    await expect(
      invokeRpc('remote.openEditor', { target: REMOTE_TARGET, path: '/srv/goblin-feature-x' }),
    ).resolves.toEqual({ ok: true, data: { ok: true, message: '/srv/goblin-feature-x' } })
    await expect(
      invokeRpc('remote.openTerminal', { target: REMOTE_TARGET, path: '/srv/goblin-feature-x' }),
    ).resolves.toEqual({ ok: true, data: { ok: true, message: '/srv/goblin-feature-x' } })
  })

  test('routes remote branch delete and GitHub PR opening', async () => {
    vi.mocked(openHttpsExternal).mockResolvedValueOnce(true)

    await expect(
      invokeRpc('remote.deleteBranch', { target: REMOTE_TARGET, branch: 'feature/x', force: false }),
    ).resolves.toEqual({ ok: true, data: { ok: true, message: 'deleted' } })
    await expect(invokeRpc('remote.openGitHub', { target: REMOTE_TARGET, branch: 'feature/x' })).resolves.toEqual({
      ok: true,
      data: { ok: true, message: 'https://github.com/nano-props/goblin/pull/new/feature/x' },
    })

    expect(deleteRemoteBranch).toHaveBeenCalledWith(
      expect.objectContaining({ id: REMOTE_TARGET.id }),
      expect.objectContaining({ branch: 'feature/x', force: false, signal: expect.any(AbortSignal) }),
    )
    expect(getRemoteGitHubUrl).toHaveBeenCalledWith(
      expect.objectContaining({ id: REMOTE_TARGET.id }),
      'feature/x',
      { signal: undefined },
    )
    expect(openHttpsExternal).toHaveBeenCalledWith('https://github.com/nano-props/goblin/pull/new/feature/x')
  })

  test('routes remote port start through the manager', async () => {
    remotePortMocks.start.mockResolvedValue({
      configId: 'cfg-1',
      repoId: REMOTE_TARGET.id,
      remotePort: 3000,
      requestedLocalPort: null,
      actualLocalPort: 3000,
      localHost: '127.0.0.1',
      remoteHost: '127.0.0.1',
      status: 'running',
      startedAt: 123,
    })

    const result = await invokeRpc('remotePorts.start', {
      target: REMOTE_TARGET,
      config: { id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: null },
    })

    expect(result).toEqual({
      ok: true,
      data: {
        configId: 'cfg-1',
        repoId: REMOTE_TARGET.id,
        remotePort: 3000,
        requestedLocalPort: null,
        actualLocalPort: 3000,
        localHost: '127.0.0.1',
        remoteHost: '127.0.0.1',
        status: 'running',
        startedAt: 123,
      },
    })
    expect(remotePortMocks.start).toHaveBeenCalledWith(REMOTE_TARGET, {
      id: 'cfg-1',
      remotePort: 3000,
      requestedLocalPort: null,
      label: null,
    })
  })

  test('rejects invalid remote port configs at the router boundary', async () => {
    const result = await invokeRpc('remotePorts.start', {
      target: REMOTE_TARGET,
      config: { id: 'cfg-1', remotePort: 0, requestedLocalPort: null, label: null },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('BAD_REQUEST')
  })

  test('rejects mismatched remote target ids at the RPC boundary', async () => {
    const result = await invokeRpc('remote.snapshot', {
      target: { ...REMOTE_TARGET, id: 'ssh://deploy@prod:22/srv/other' },
    })

    expect(result).toEqual({
      ok: false,
      error: { name: 'TRPCError', code: 'BAD_REQUEST', message: 'Invalid remote repository target' },
    })
  })

  test('does not expose a raw remote command RPC procedure', async () => {
    const result = await invokeRpc('remote.command', { command: 'uname -a' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ name: 'TRPCError', code: 'NOT_FOUND' })
  })
})
