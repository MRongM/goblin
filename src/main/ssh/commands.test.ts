import { afterEach, describe, expect, test, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const execaMock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({
  ExecaError: Error,
  execa: execaMock,
}))

afterEach(() => {
  execaMock.mockReset()
  vi.resetModules()
})

const MANUAL_TARGET: RemoteRepoTarget = {
  id: 'ssh://deploy@prod.example.com:2222/srv/goblin',
  alias: null,
  host: 'prod.example.com',
  user: 'deploy',
  port: 2222,
  remotePath: '/srv/goblin',
  displayName: 'prod.example.com:goblin',
}

const ALIAS_TARGET: RemoteRepoTarget = {
  ...MANUAL_TARGET,
  alias: 'prod',
}

describe('remote ssh command runner', () => {
  test('builds non-interactive ssh argv for manual targets', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(MANUAL_TARGET, { type: 'checkShell' })

    expect(invocation.command).toBe('ssh')
    expect(invocation.args).toEqual(
      expect.arrayContaining([
        '-T',
        '-o',
        'RequestTTY=no',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'ConnectTimeout=10',
        '-p',
        '2222',
        '--',
        'deploy@prod.example.com',
      ]),
    )
    expect(invocation.args.slice(invocation.args.indexOf('deploy@prod.example.com') + 1)).toHaveLength(1)
    expect(invocation.args.at(-1)).toMatch(/^sh -lc '/)
  })

  test('uses ssh config alias as the destination when present', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(ALIAS_TARGET, { type: 'checkGit' })

    expect(invocation.args).toContain('prod')
    expect(invocation.args).not.toContain('deploy@prod.example.com')
    expect(invocation.args).not.toContain('-p')
  })

  test('uses identity file when provided', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(
      { ...MANUAL_TARGET, identityFile: '/Users/deploy/.ssh/prod_ed25519' },
      { type: 'checkShell' },
    )

    expect(invocation.args).toEqual(expect.arrayContaining(['-i', '/Users/deploy/.ssh/prod_ed25519']))
  })

  test('expands home-relative identity files before invoking ssh', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(
      { ...MANUAL_TARGET, identityFile: '~/.ssh/prod_ed25519' },
      { type: 'checkShell' },
    )

    expect(invocation.args).toEqual(expect.arrayContaining(['-i', path.join(os.homedir(), '.ssh/prod_ed25519')]))
  })

  test('allows ssh-agent or system ssh to handle encrypted key passphrases', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(MANUAL_TARGET, { type: 'checkShell' })

    expect(invocation.args).not.toContain('BatchMode=yes')
    expect(invocation.args).not.toContain('NumberOfPasswordPrompts=0')
  })

  test('shell-quotes paths in fixed scripts', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'testDirectory',
      path: "/srv/team's app",
    })

    expect(invocation.script).toContain("test -d '/srv/team'\\''s app'")
  })

  test('quotes the shell check as one remote sh script', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(MANUAL_TARGET, { type: 'checkShell' })

    expect(invocation.script).toBe("printf '%s\\n' ok")
    expect(invocation.args.slice(invocation.args.indexOf('deploy@prod.example.com') + 1)).toEqual([
      expect.stringContaining("printf '\\''%s\\n'\\'' ok"),
    ])
  })

  test('runRemoteCommand returns stdout and transient stderr without accepting raw command text', async () => {
    execaMock.mockResolvedValue({ stdout: 'ok\n', stderr: '' })
    const { runRemoteCommand } = await import('#/main/ssh/commands.ts')

    const result = await runRemoteCommand(MANUAL_TARGET, { type: 'checkShell' })

    expect(result).toEqual({ ok: true, stdout: 'ok', stderr: '' })
    expect(execaMock).toHaveBeenCalledWith('ssh', expect.any(Array), expect.objectContaining({ timeout: 15_000 }))
  })

  test('builds remote read commands with quoted paths', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const worktrees = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitWorktreeList',
      path: "/srv/team's app",
    })
    const status = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitStatus',
      path: "/srv/team's app",
    })

    expect(worktrees.script).toBe("git -C '/srv/team'\\''s app' worktree list --porcelain")
    expect(status.script).toBe("git -C '/srv/team'\\''s app' status --porcelain -z")
  })

  test('builds remote status and log commands with bounded numeric args', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const status = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitStatus',
      path: '/srv/goblin-linked',
    })
    const log = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitLog',
      path: '/srv/goblin',
      branch: 'feature/x',
      count: 30,
      skip: 60,
    })

    expect(status.script).toBe("git -C '/srv/goblin-linked' status --porcelain -z")
    expect(log.script).toBe(
      "git -C '/srv/goblin' log --format='%H\u001f%h\u001f%s\u001f%an\u001f%aI' --max-count=30 --skip=60 'feature/x' --",
    )
  })

  test('builds remote branch action commands with quoted refs and paths', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const fetchAll = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitFetchAll',
      path: "/srv/team's app",
    })
    const checkout = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitCheckout',
      path: "/srv/team's app",
      branch: 'feature/x',
    })
    const push = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitPush',
      path: '/srv/goblin',
      branch: "feature/quote's",
    })
    const currentPull = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitPullCurrent',
      path: '/srv/goblin-feature-x',
    })
    const fetchBranch = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitFetchBranch',
      path: '/srv/goblin',
      remote: 'origin',
      remoteBranch: 'feature/x',
      branch: 'feature/x',
    })

    expect(fetchAll.script).toBe("git -C '/srv/team'\\''s app' fetch --all --prune")
    expect(checkout.script).toBe("git -C '/srv/team'\\''s app' switch -- 'feature/x'")
    expect(push.script).toBe("git -C '/srv/goblin' push -u origin 'feature/quote'\\''s'")
    expect(currentPull.script).toBe("git -C '/srv/goblin-feature-x' pull --ff-only")
    expect(fetchBranch.script).toBe("git -C '/srv/goblin' fetch -- 'origin' 'feature/x:feature/x'")
  })

  test('builds remote destructive guard commands with quoted args', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const remove = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitWorktreeRemove',
      path: '/srv/goblin',
      worktreePath: "/srv/goblin-feature's",
    })
    const safeDelete = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitBranchDelete',
      path: '/srv/goblin',
      branch: 'feature/delete',
      force: false,
    })
    const forceDelete = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitBranchDelete',
      path: '/srv/goblin',
      branch: 'feature/delete',
      force: true,
    })
    const upstream = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitUpstream',
      path: '/srv/goblin',
      branch: "feature/quote's",
    })
    const ancestor = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitIsAncestor',
      path: '/srv/goblin',
      ancestor: "feature/quote's",
      descendant: 'origin/main',
    })

    expect(remove.script).toBe("git -C '/srv/goblin' worktree remove -- '/srv/goblin-feature'\\''s'")
    expect(safeDelete.script).toBe("git -C '/srv/goblin' branch -d -- 'feature/delete'")
    expect(forceDelete.script).toBe("git -C '/srv/goblin' branch -D -- 'feature/delete'")
    expect(upstream.script).toBe("git -C '/srv/goblin' rev-parse --abbrev-ref 'feature/quote'\\''s@{u}'")
    expect(ancestor.script).toBe(
      "git -C '/srv/goblin' merge-base --is-ancestor -- 'feature/quote'\\''s' 'origin/main'",
    )
  })

  test('builds remote origin and patch commands without raw command input', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const origin = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitRemoteGetUrl',
      path: '/srv/goblin',
    })
    const patch = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitPatch',
      path: '/srv/goblin-feature-x',
    })

    expect(origin.script).toBe("git -C '/srv/goblin' remote get-url origin")
    expect(patch.script).toBe("git -C '/srv/goblin-feature-x' diff HEAD --binary")
  })

  test('builds separate remote patch support commands for tracked and untracked files', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const tracked = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitPatch',
      path: '/srv/goblin-feature-x',
    })
    const statusAll = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitStatusAll',
      path: '/srv/goblin-feature-x',
    })
    const untracked = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitDiffNoIndex',
      path: '/srv/goblin-feature-x',
      filePath: "new file's.txt",
    })

    expect(tracked.script).toBe("git -C '/srv/goblin-feature-x' diff HEAD --binary")
    expect(statusAll.script).toBe("git -C '/srv/goblin-feature-x' status --porcelain -z -uall")
    expect(untracked.script).toContain(
      "git -C '/srv/goblin-feature-x' diff --binary --no-index -- /dev/null 'new file'\\''s.txt'",
    )
  })
})
