import { describe, expect, test } from 'vitest'
import { normalizeCreateBranchInput } from '#/shared/branch-create.ts'

describe('normalizeCreateBranchInput', () => {
  test('normalizes local branch creation input', () => {
    expect(
      normalizeCreateBranchInput({
        kind: 'local',
        branch: ' feature/new ',
        baseBranch: ' main ',
      }),
    ).toEqual({ kind: 'local', branch: 'feature/new', baseBranch: 'main' })
  })

  test('normalizes remote tracking branch creation input', () => {
    expect(
      normalizeCreateBranchInput({
        kind: 'trackRemote',
        localBranch: ' feature/remote ',
        remoteRef: ' origin/feature/remote ',
      }),
    ).toEqual({ kind: 'trackRemote', localBranch: 'feature/remote', remoteRef: 'origin/feature/remote' })
  })

  test.each([
    [null],
    [{}],
    [{ kind: 'local', branch: '', baseBranch: 'main' }],
    [{ kind: 'local', branch: '-bad', baseBranch: 'main' }],
    [{ kind: 'local', branch: 'feature/new', baseBranch: '-bad' }],
    [{ kind: 'trackRemote', localBranch: '', remoteRef: 'origin/main' }],
    [{ kind: 'trackRemote', localBranch: '-bad', remoteRef: 'origin/main' }],
    [{ kind: 'trackRemote', localBranch: 'feature/main', remoteRef: 'main' }],
    [{ kind: 'trackRemote', localBranch: 'feature/main', remoteRef: 'origin/HEAD' }],
  ])('rejects invalid input %#', (input) => {
    expect(normalizeCreateBranchInput(input)).toBeNull()
  })
})
