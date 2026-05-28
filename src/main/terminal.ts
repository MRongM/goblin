import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { getWorktrees } from '#/main/git/worktrees.ts'
import { resolveKnownWorktree } from '#/main/git/guards.ts'
import { isValidAbsolutePath, isValidBranch, isValidCwd, MAX_IPC_PATH_LENGTH } from '#/main/ipc/validation.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'
import { buildRemoteTerminalInvocation } from '#/main/ssh/commands.ts'
import {
  closeAllTerminalSessions,
  closeOwnedTerminalSession,
  closeTerminalKey,
  closeTerminalOwner,
  isValidTerminalSessionId,
  isValidTerminalWriteData,
  openTerminalSession,
  pruneTerminalScope,
  resizeTerminalSession,
  writeTerminalSession,
} from '#/main/terminal-core.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import {
  isValidTerminalSize,
  type LocalTerminalOpenInput,
  type RemoteTerminalOpenInput,
  type TerminalMutationResult,
  type TerminalOpenInput,
  type TerminalOpenResult,
  type TerminalPruneRepoInput,
  type TerminalResizeInput,
  type TerminalRestartInput,
  type TerminalSessionInput,
  type TerminalWriteInput,
} from '#/shared/terminal.ts'

const MAX_TERMINAL_PRUNE_WORKTREES = 1000
const TERMINAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export { closeAllTerminalSessions } from '#/main/terminal-core.ts'

let wired = false

export function wireTerminalIpc(): void {
  if (wired) return
  wired = true

  ipcMain.handle('goblin:terminal-open', async (event, input: TerminalOpenInput): Promise<TerminalOpenResult> => {
    if (!isTrustedIpcEvent(event)) return { ok: false, message: 'error.invalid-arguments' }
    registerTerminalOwnerCleanup(event.sender)
    return openGoblinWorktreeTerminal(event.sender.id, input)
  })
  ipcMain.handle('goblin:terminal-restart', async (event, input: TerminalRestartInput): Promise<TerminalOpenResult> => {
    if (!isTrustedIpcEvent(event)) return { ok: false, message: 'error.invalid-arguments' }
    registerTerminalOwnerCleanup(event.sender)
    return openGoblinWorktreeTerminal(event.sender.id, input, { restart: true })
  })
  ipcMain.handle('goblin:terminal-write', (event, input: TerminalWriteInput): TerminalMutationResult => {
    if (!isTrustedIpcEvent(event)) return false
    if (!isValidTerminalSessionId(input?.sessionId) || !isValidTerminalWriteData(input?.data)) return false
    return writeTerminalSession(event.sender.id, input.sessionId, input.data)
  })
  ipcMain.handle('goblin:terminal-resize', (event, input: TerminalResizeInput): TerminalMutationResult => {
    if (!isTrustedIpcEvent(event)) return false
    if (!isValidTerminalSessionId(input?.sessionId) || !isValidTerminalSize(input?.cols, input?.rows)) return false
    return resizeTerminalSession(event.sender.id, input.sessionId, input.cols, input.rows)
  })
  ipcMain.handle('goblin:terminal-close', (event, input: TerminalSessionInput): TerminalMutationResult => {
    if (!isTrustedIpcEvent(event)) return false
    return isValidTerminalSessionId(input?.sessionId)
      ? closeOwnedTerminalSession(event.sender.id, input.sessionId)
      : false
  })
  ipcMain.handle('goblin:terminal-prune-repo', (event, input: TerminalPruneRepoInput): TerminalMutationResult => {
    if (!isTrustedIpcEvent(event)) return false
    if (input?.kind === 'remote') {
      if (!isValidRemoteRepoId(input.repoId) || !isValidTerminalWorktreePathList(input.worktreePaths)) return false
      pruneRemoteRepoSessions(event.sender.id, input.repoId, input.worktreePaths)
      return true
    }
    if (!isValidCwd(input?.repoRoot) || !isValidTerminalWorktreePathList(input?.worktreePaths)) return false
    pruneRepoSessions(event.sender.id, input.repoRoot, input.worktreePaths)
    return true
  })
}

async function openGoblinWorktreeTerminal(
  ownerWebContentsId: number,
  input: TerminalOpenInput,
  options: { restart?: boolean } = {},
): Promise<TerminalOpenResult> {
  if (input?.kind === 'remote') return openGoblinRemoteTerminal(ownerWebContentsId, input, options)
  return openGoblinLocalWorktreeTerminal(ownerWebContentsId, input, options)
}

async function openGoblinLocalWorktreeTerminal(
  ownerWebContentsId: number,
  input: LocalTerminalOpenInput,
  options: { restart?: boolean } = {},
): Promise<TerminalOpenResult> {
  if (
    !isValidCwd(input?.repoRoot) ||
    !isValidBranch(input?.branch) ||
    !isValidAbsolutePath(input?.worktreePath) ||
    !isValidTerminalId(input?.terminalId) ||
    !isValidTerminalSize(input?.cols, input?.rows)
  ) {
    return { ok: false, message: 'error.invalid-arguments' }
  }

  const worktrees = await getWorktrees(input.repoRoot, { includeStatus: false })
  const resolved = resolveKnownWorktree(worktrees, input.worktreePath, input.branch)
  if (!resolved.ok) return resolved

  const repoRoot = path.resolve(input.repoRoot)
  const worktreePath = path.resolve(resolved.path)
  return openTerminalSession({
    ownerWebContentsId,
    scope: repoRoot,
    key: sessionKey(repoRoot, worktreePath, input.terminalId),
    cwd: worktreePath,
    cols: input.cols,
    rows: input.rows,
    forceNew: options.restart === true,
  })
}

async function openGoblinRemoteTerminal(
  ownerWebContentsId: number,
  input: RemoteTerminalOpenInput,
  options: { restart?: boolean } = {},
): Promise<TerminalOpenResult> {
  const targetInput = input.target && typeof input.target === 'object' ? input.target : {}
  const target = normalizeRemoteTarget(targetInput)
  if (
    !target ||
    target.id !== input.target.id ||
    !isValidBranch(input.branch) ||
    !isValidRemoteAbsolutePath(input.worktreePath) ||
    !isValidTerminalId(input.terminalId) ||
    !isValidTerminalSize(input.cols, input.rows)
  ) {
    return { ok: false, message: 'error.invalid-arguments' }
  }

  const invocation = buildRemoteTerminalInvocation(target, input.worktreePath, { cols: input.cols, rows: input.rows })
  return openTerminalSession({
    ownerWebContentsId,
    scope: target.id,
    key: remoteSessionKey(target.id, input.worktreePath, input.terminalId),
    cwd: os.homedir(),
    cols: input.cols,
    rows: input.rows,
    forceNew: options.restart === true,
    command: { command: invocation.command, args: invocation.args },
  })
}

const terminalOwnerCleanupIds = new Set<number>()

function registerTerminalOwnerCleanup(webContents: WebContents): void {
  if (terminalOwnerCleanupIds.has(webContents.id)) return
  terminalOwnerCleanupIds.add(webContents.id)
  webContents.once('destroyed', () => {
    terminalOwnerCleanupIds.delete(webContents.id)
    closeTerminalOwner(webContents.id)
  })
}

export function closeWorktreeSession(repoRoot: string, worktreePath: string): void {
  closeTerminalKey(sessionKey(path.resolve(repoRoot), path.resolve(worktreePath)))
}

export function pruneRepoSessions(ownerWebContentsId: number, repoRoot: string, worktreePaths: string[]): void {
  const root = path.resolve(repoRoot)
  const liveKeys = new Set(worktreePaths.filter(isValidAbsolutePath).map((p) => sessionKey(root, path.resolve(p))))
  pruneTerminalScope(ownerWebContentsId, root, liveKeys)
}

export function pruneRemoteRepoSessions(ownerWebContentsId: number, repoId: string, worktreePaths: string[]): void {
  const liveKeys = new Set(worktreePaths.filter(isValidRemoteAbsolutePath).map((p) => remoteSessionKey(repoId, p)))
  pruneTerminalScope(ownerWebContentsId, repoId, liveKeys)
}

function isValidTerminalWorktreePathList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_TERMINAL_PRUNE_WORKTREES &&
    value.every((pathValue) => typeof pathValue === 'string' && isValidAbsolutePath(pathValue))
  )
}

function isValidTerminalId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_ID_RE.test(value)
}

function isValidRemoteAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_IPC_PATH_LENGTH &&
    value.startsWith('/') &&
    !value.includes('\0')
  )
}

function isValidRemoteRepoId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_IPC_PATH_LENGTH && !value.includes('\0')
}

function sessionKey(repoRoot: string, worktreePath: string, terminalId?: string): string {
  return terminalId ? `${repoRoot}\0${worktreePath}\0${terminalId}` : `${repoRoot}\0${worktreePath}`
}

function remoteSessionKey(repoId: string, worktreePath: string, terminalId?: string): string {
  return terminalId ? `remote\0${repoId}\0${worktreePath}\0${terminalId}` : `remote\0${repoId}\0${worktreePath}`
}
