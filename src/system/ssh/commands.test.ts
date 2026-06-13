import { describe, expect, test } from 'vitest'
import { buildRemoteCommandInvocation, buildRemoteTerminalInvocation } from '#/system/ssh/commands.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'

const TARGET = normalizeRemoteTarget({
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo',
})!

describe('remote command scripts', () => {
  test('renders remote branch listing command', () => {
    expect(buildRemoteCommandInvocation(TARGET, { type: 'gitRemoteBranches', path: '/srv/repo' }).script).toContain(
      "for-each-ref '--format=%(refname:short)' refs/remotes/",
    )
  })

  test('renders all worktree add modes', () => {
    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitWorktreeAdd',
        path: '/srv/repo',
        input: { worktreePath: '/srv/repo-feature', mode: { kind: 'existingBranch', branch: 'feature/a' } },
      }).script,
    ).toContain("worktree add -- '/srv/repo-feature' 'feature/a'")

    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitWorktreeAdd',
        path: '/srv/repo',
        input: {
          worktreePath: '/srv/repo-feature',
          mode: { kind: 'trackRemoteBranch', remoteRef: 'origin/feature/a', localBranch: 'feature/a' },
        },
      }).script,
    ).toContain("worktree add -b 'feature/a' --track -- '/srv/repo-feature' 'origin/feature/a'")

    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitWorktreeAdd',
        path: '/srv/repo',
        input: { worktreePath: '/srv/repo-detached', mode: { kind: 'detached', ref: 'origin/feature/a' } },
      }).script,
    ).toContain("worktree add --detach -- '/srv/repo-detached' 'origin/feature/a'")
  })

  test('renders branch create commands', () => {
    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitBranchCreate',
        path: '/srv/repo',
        branch: 'feature/new',
        baseBranch: 'main',
      }).script,
    ).toContain("git -C '/srv/repo' branch -- 'feature/new' 'main'")

    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitBranchTrackRemote',
        path: '/srv/repo',
        localBranch: 'feature/remote',
        remoteRef: 'origin/feature/remote',
      }).script,
    ).toContain("git -C '/srv/repo' branch --track 'feature/remote' 'origin/feature/remote'")
  })

  test('renders tmux-aware managed remote terminal invocation through the ssh command adapter', () => {
    const invocation = buildRemoteTerminalInvocation(TARGET, '/srv/repo-feature', {
      cols: 100,
      rows: 30,
      terminalNumber: 2,
    })

    expect(invocation.command).toBe('ssh')
    expect(invocation.args).toEqual(['-tt', '--', 'prod', expect.stringContaining('sh -lc')])
    expect(invocation.script).toContain("cd '/srv/repo-feature' || exit")
    expect(invocation.script).toContain('command -v tmux >/dev/null 2>&1')
    expect(invocation.script).toContain("exec tmux new-session -A -s 'goblin-")
    expect(invocation.script).toContain('exec "${SHELL:-/bin/sh}" -l')
  })

  test('managed remote terminal hash uses endpoint and terminal number instead of alias', () => {
    const first = buildRemoteTerminalInvocation(TARGET, '/srv/repo-feature', {
      cols: 100,
      rows: 30,
      terminalNumber: 1,
    })
    const sameEndpointDifferentAlias = buildRemoteTerminalInvocation(
      { ...TARGET, alias: 'renamed-prod', id: 'ssh-config://renamed-prod/srv/repo' },
      '/srv/repo-feature',
      { cols: 100, rows: 30, terminalNumber: 1 },
    )
    const secondTerminal = buildRemoteTerminalInvocation(TARGET, '/srv/repo-feature', {
      cols: 100,
      rows: 30,
      terminalNumber: 2,
    })

    const sessionNamePattern = /goblin-[a-f0-9]{24}/
    const firstName = first.script.match(sessionNamePattern)?.[0]
    const renamedName = sameEndpointDifferentAlias.script.match(sessionNamePattern)?.[0]
    const secondName = secondTerminal.script.match(sessionNamePattern)?.[0]

    expect(firstName).toBeTruthy()
    expect(renamedName).toBe(firstName)
    expect(secondName).not.toBe(firstName)
  })
})
