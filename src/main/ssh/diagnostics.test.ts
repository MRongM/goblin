import { describe, expect, test } from 'vitest'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import type { RemoteCommandKind, RemoteCommandResult } from '#/main/ssh/commands.ts'

const TARGET: RemoteRepoTarget = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: 'prod',
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

function runner(failAt?: RemoteCommandKind['type'], stderr = 'failed') {
  return async (command: RemoteCommandKind): Promise<RemoteCommandResult> => {
    if (command.type === failAt) return { ok: false, stdout: '', stderr, message: stderr }
    return { ok: true, stdout: command.type === 'revParseTopLevel' ? TARGET.remotePath : 'ok', stderr: '' }
  }
}

describe('remote diagnostics', () => {
  test('returns five passed stages on success', async () => {
    const { testRemoteRepository } = await import('#/main/ssh/diagnostics.ts')

    const result = await testRemoteRepository(TARGET, { run: runner() })

    expect(result.ok).toBe(true)
    expect(result.stages.map((stage) => [stage.name, stage.status])).toEqual([
      ['ssh', 'passed'],
      ['shell', 'passed'],
      ['git', 'passed'],
      ['path', 'passed'],
      ['repo', 'passed'],
    ])
  })

  test.each([
    ['Host key verification failed', 'host key'],
    ['Permission denied (publickey)', 'auth failed'],
    ['Could not resolve hostname prod', 'unreachable'],
  ] as const)('classifies ssh failure %s as %s', async (stderr, category) => {
    const { testRemoteRepository } = await import('#/main/ssh/diagnostics.ts')

    const result = await testRemoteRepository(TARGET, { run: runner('checkShell', stderr) })

    expect(result.ok).toBe(false)
    expect(result.category).toBe(category)
    expect(result.stages[0]).toMatchObject({ name: 'ssh', status: 'failed', category })
    expect(result.stages.slice(1).every((stage) => stage.status === 'skipped')).toBe(true)
  })

  test.each([
    ['checkGit', 'git missing'],
    ['testDirectory', 'path missing'],
    ['revParseTopLevel', 'not a repo'],
  ] as const)('maps %s failure to %s', async (failAt, category) => {
    const { testRemoteRepository } = await import('#/main/ssh/diagnostics.ts')

    const result = await testRemoteRepository(TARGET, { run: runner(failAt, 'failed') })

    expect(result.ok).toBe(false)
    expect(result.category).toBe(category)
  })
})
