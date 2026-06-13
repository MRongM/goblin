import { describe, expect, test } from 'vitest'
import {
  buildExternalRemoteTerminalInvocation,
  buildManagedRemoteTerminalInvocation,
  buildManagedRemoteTerminalSessionName,
} from '#/system/remote-terminal.ts'

const BASE_MANAGED_TARGET = {
  alias: 'prod',
  endpoint: { user: 'alice', host: '192.168.1.20', port: 22 },
  repoPath: '/srv/repo',
  worktreePath: '/srv/repo-feature',
  terminalNumber: 1,
}

describe('buildManagedRemoteTerminalSessionName', () => {
  test('is stable for the same resolved endpoint, repo path, worktree path, and terminal number', () => {
    expect(buildManagedRemoteTerminalSessionName(BASE_MANAGED_TARGET)).toBe(
      buildManagedRemoteTerminalSessionName(BASE_MANAGED_TARGET),
    )
  })

  test('does not change when only the ssh alias changes', () => {
    const renamedAlias = { ...BASE_MANAGED_TARGET, alias: 'renamed-prod' }

    expect(buildManagedRemoteTerminalSessionName(renamedAlias)).toBe(
      buildManagedRemoteTerminalSessionName(BASE_MANAGED_TARGET),
    )
  })

  test('changes when endpoint, paths, or terminal number change', () => {
    const base = buildManagedRemoteTerminalSessionName(BASE_MANAGED_TARGET)

    expect(
      buildManagedRemoteTerminalSessionName({
        ...BASE_MANAGED_TARGET,
        endpoint: { user: 'bob', host: '192.168.1.20', port: 22 },
      }),
    ).not.toBe(base)
    expect(
      buildManagedRemoteTerminalSessionName({
        ...BASE_MANAGED_TARGET,
        endpoint: { user: 'alice', host: '192.168.1.21', port: 22 },
      }),
    ).not.toBe(base)
    expect(
      buildManagedRemoteTerminalSessionName({
        ...BASE_MANAGED_TARGET,
        endpoint: { user: 'alice', host: '192.168.1.20', port: 2222 },
      }),
    ).not.toBe(base)
    expect(buildManagedRemoteTerminalSessionName({ ...BASE_MANAGED_TARGET, repoPath: '/srv/other' })).not.toBe(base)
    expect(buildManagedRemoteTerminalSessionName({ ...BASE_MANAGED_TARGET, worktreePath: '/srv/repo-other' })).not.toBe(base)
    expect(buildManagedRemoteTerminalSessionName({ ...BASE_MANAGED_TARGET, terminalNumber: 2 })).not.toBe(base)
  })

  test('returns a short tmux-safe session name', () => {
    expect(
      buildManagedRemoteTerminalSessionName({
        alias: 'prod',
        endpoint: { user: 'alice', host: 'dev.example.com', port: 2222 },
        repoPath: '/srv/repo with spaces',
        worktreePath: "/srv/repo's-feature",
        terminalNumber: 3,
      }),
    ).toMatch(/^goblin-[a-f0-9]{24}$/)
  })
})

describe('buildManagedRemoteTerminalInvocation', () => {
  test('builds a tmux-first ssh invocation with native shell fallback', () => {
    const invocation = buildManagedRemoteTerminalInvocation(BASE_MANAGED_TARGET)

    expect(invocation).not.toBeNull()
    expect(invocation?.command).toBe('ssh')
    expect(invocation?.args).toEqual(['-tt', '--', 'prod', expect.stringContaining('sh -lc')])
    expect(invocation?.script).toContain("cd '/srv/repo-feature' || exit")
    expect(invocation?.script).toContain('command -v tmux >/dev/null 2>&1')
    expect(invocation?.script).toContain("exec tmux new-session -A -s 'goblin-")
    expect(invocation?.script).toContain("-c '/srv/repo-feature'")
    expect(invocation?.script).toContain('exec "${SHELL:-/bin/sh}" -l')
    expect(invocation?.shellCommand).toContain('ssh')
    expect(invocation?.shellCommand).toContain('prod')
    expect(invocation?.shellCommand).toContain('tmux')
  })

  test('shell-quotes remote paths that contain single quotes', () => {
    const invocation = buildManagedRemoteTerminalInvocation({
      ...BASE_MANAGED_TARGET,
      worktreePath: "/srv/repo's-feature",
    })

    expect(invocation).not.toBeNull()
    expect(invocation?.script).toContain("cd '/srv/repo'\\''s-feature' || exit")
    expect(invocation?.script).toContain("-c '/srv/repo'\\''s-feature'")
  })

  test('keeps non-ascii paths as quoted shell data', () => {
    const invocation = buildManagedRemoteTerminalInvocation({
      ...BASE_MANAGED_TARGET,
      repoPath: '/srv/\u9879\u76ee',
      worktreePath: '/srv/\u9879\u76ee/\u529f\u80fd',
    })

    expect(invocation?.script).toContain("cd '/srv/\u9879\u76ee/\u529f\u80fd' || exit")
  })

  test('rejects unsafe managed target input', () => {
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, alias: 'bad alias' })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, repoPath: 'relative/repo' })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, worktreePath: 'relative/repo' })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, worktreePath: '/srv/\u0000repo' })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, endpoint: { user: '', host: 'host', port: 22 } })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, endpoint: { user: 'alice', host: '', port: 22 } })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, endpoint: { user: 'alice', host: 'host', port: 0 } })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, terminalNumber: 0 })).toBeNull()
  })
})

describe('buildExternalRemoteTerminalInvocation', () => {
  test('builds a plain ssh login-shell invocation without tmux', () => {
    const invocation = buildExternalRemoteTerminalInvocation({
      alias: 'prod',
      worktreePath: '/srv/repo-feature',
    })

    expect(invocation).not.toBeNull()
    expect(invocation?.command).toBe('ssh')
    expect(invocation?.args).toEqual(['-tt', '--', 'prod', expect.stringContaining('sh -lc')])
    expect(invocation?.script).toContain("cd '/srv/repo-feature' || exit")
    expect(invocation?.script).toContain('exec "${SHELL:-/bin/sh}" -l')
    expect(invocation?.script).not.toContain('tmux')
    expect(invocation?.shellCommand).not.toContain('tmux')
  })

  test('rejects unsafe external target input', () => {
    expect(buildExternalRemoteTerminalInvocation({ alias: 'bad alias', worktreePath: '/srv/repo' })).toBeNull()
    expect(buildExternalRemoteTerminalInvocation({ alias: 'prod', worktreePath: 'relative/repo' })).toBeNull()
    expect(buildExternalRemoteTerminalInvocation({ alias: 'prod', worktreePath: '/srv/\u0000repo' })).toBeNull()
  })
})
