import type { ReposStore } from '#/renderer/stores/repos/types.ts'
import type { TerminalDescriptor, TerminalSessionBase } from '#/renderer/components/terminal/types.ts'

export type TerminalSessionScope =
  | { kind?: 'local'; repoRoot: string; worktreePath: string }
  | { kind: 'remote'; repoId: string; worktreePath: string }

export function terminalSessionScope(base: TerminalSessionBase | TerminalDescriptor): TerminalSessionScope {
  return base.kind === 'remote'
    ? { kind: 'remote', repoId: base.repoId, worktreePath: base.worktreePath }
    : { kind: 'local', repoRoot: base.repoRoot, worktreePath: base.worktreePath }
}

export function terminalSessionGroupKey(scope: TerminalSessionScope): string {
  return scope.kind === 'remote'
    ? `remote\0${scope.repoId}\0${scope.worktreePath}`
    : `local\0${scope.repoRoot}\0${scope.worktreePath}`
}

export function terminalSessionKey(scope: TerminalSessionScope, terminalId: string): string {
  return `${terminalSessionGroupKey(scope)}\0${terminalId}`
}

export function terminalDescriptor(base: TerminalSessionBase, terminalId: string, index: number): TerminalDescriptor {
  const scope = terminalSessionScope(base)
  const groupKey = terminalSessionGroupKey(scope)
  if (base.kind === 'remote') {
    return {
      ...base,
      groupKey,
      terminalId,
      index,
      key: terminalSessionKey(scope, terminalId),
    }
  }
  return {
    ...base,
    kind: 'local',
    groupKey,
    terminalId,
    index,
    key: terminalSessionKey(scope, terminalId),
  }
}

export function isTerminalDescriptorLive(repos: ReposStore['repos'], descriptor: TerminalDescriptor): boolean {
  const repoId = descriptor.kind === 'remote' ? descriptor.repoId : descriptor.repoRoot
  const repo = repos[repoId]
  return !!repo?.data.branches.some((branch) => branch.worktree?.path === descriptor.worktreePath)
}
