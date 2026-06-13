import { describe, expect, test } from 'vitest'
import { buildRemoteCommandInvocation } from '#/system/ssh/commands.ts'
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

  test('builds a quoted one-level remote directory listing command', () => {
    const invocation = buildRemoteCommandInvocation(TARGET, {
      type: 'listDirectoryEntries',
      worktreePath: '/srv/repo',
      dirPath: "/srv/repo/src with 'quote'",
    })
    expect(invocation.script).toContain('python3')
    expect(invocation.script).toContain('"/srv/repo"')
    expect(invocation.script).toContain('src with')
    expect(invocation.args).toContain(TARGET.alias)
  })

  test('builds a fixed remote rename command with JSON encoded inputs', () => {
    const invocation = buildRemoteCommandInvocation(TARGET, {
      type: 'renameFileTreeEntry',
      worktreePath: '/srv/repo',
      oldPath: "/srv/repo/src/old 'name'.ts",
      newName: 'new name.ts',
    })

    expect(invocation.script).toContain('python3')
    expect(invocation.script).toContain('os.rename')
    expect(invocation.script).toContain('"/srv/repo"')
    expect(invocation.script).toContain("old 'name'.ts")
    expect(invocation.script).toContain('new name.ts')
    expect(invocation.args).toContain(TARGET.alias)
  })

  test('builds a fixed remote delete command with JSON encoded paths', () => {
    const invocation = buildRemoteCommandInvocation(TARGET, {
      type: 'deleteFileTreeEntries',
      worktreePath: '/srv/repo',
      paths: ['/srv/repo/README.md', '/srv/repo/src'],
    })

    expect(invocation.script).toContain('python3')
    expect(invocation.script).toContain('shutil.rmtree')
    expect(invocation.script).toContain('"/srv/repo/README.md"')
    expect(invocation.script).toContain('"/srv/repo/src"')
    expect(invocation.args).toContain(TARGET.alias)
  })

  test('builds quoted remote file inventory command', () => {
    const invocation = buildRemoteCommandInvocation(TARGET, {
      type: 'fileTransferInventory',
      rootPath: '/srv/repo',
      paths: ['/srv/repo/src', "/srv/repo/file with 'quote'.txt"],
    })
    expect(invocation.script).toContain('fileTransferInventory')
    expect(invocation.script).toContain('"/srv/repo"')
    expect(invocation.args).toContain(TARGET.alias)
  })

  test('builds remote uploaded file write command', () => {
    const invocation = buildRemoteCommandInvocation(TARGET, {
      type: 'fileTransferWriteBase64',
      targetPath: '/srv/repo/pasted.txt',
    })
    expect(invocation.script).toContain('base64')
    expect(invocation.script).toContain('/srv/repo/pasted.txt')
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

  test('renders quoted remote commit command', () => {
    const invocation = buildRemoteCommandInvocation(TARGET, {
      type: 'gitCommitAll',
      path: '/srv/repo-feature',
      message: "feat: handle user's changes",
    })

    expect(invocation.script).toContain("git -C '/srv/repo-feature' add -A")
    expect(invocation.script).toContain("git -C '/srv/repo-feature' commit -m 'feat: handle user'\\''s changes'")
  })
})
