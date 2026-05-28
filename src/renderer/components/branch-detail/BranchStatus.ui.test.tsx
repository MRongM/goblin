/* @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchStatus } from '#/renderer/components/branch-detail/BranchStatus.tsx'
import { getSelectedBranchDetail } from '#/renderer/components/branch-detail/model.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { createBranch } from '#/renderer/stores/repos/test-utils.ts'

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useI18nStore: (selector: any) => selector({ lang: 'en' }),
  useT: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join(',')}` : key,
}))

describe('BranchStatus remote worktree display', () => {
  let host: HTMLDivElement
  let root: Root
  const writeText = vi.fn()

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    writeText.mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
    writeText.mockReset()
  })

  test('shows host context while copying the raw remote path', async () => {
    const repo = emptyRepo('ssh://deploy@prod:22/srv/goblin', 'prod:goblin', {
      kind: 'remote',
      remoteTarget: {
        id: 'ssh://deploy@prod:22/srv/goblin',
        alias: 'prod',
        host: 'prod',
        user: 'deploy',
        port: 22,
        remotePath: '/srv/goblin',
        displayName: 'prod:goblin',
      },
    })
    repo.data.branches = [createBranch('feature/x', { worktreePath: '/srv/goblin-feature-x' })]
    repo.ui.selectedBranch = 'feature/x'

    await act(async () => {
      root.render(<BranchStatus repo={repo} detail={getSelectedBranchDetail(repo)} layout="top-bottom" />)
    })

    expect(host.textContent).toContain('deploy@prod:/srv/goblin-feature-x')

    const copyButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="branch-status.copy-worktree-path"]',
    )
    expect(copyButton).not.toBeNull()

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(writeText).toHaveBeenCalledWith('/srv/goblin-feature-x')
  })
})
