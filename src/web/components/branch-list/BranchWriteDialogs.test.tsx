// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

const mocks = vi.hoisted(() => ({
  getRepositoryRemoteBranches: vi.fn(),
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

vi.mock('#/web/repo-client.ts', () => ({
  getRepositoryRemoteBranches: mocks.getRepositoryRemoteBranches,
}))

vi.mock('#/web/components/ui/select.tsx', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <div data-select-item={value}>{children}</div>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  mocks.getRepositoryRemoteBranches.mockReset()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('BranchWriteDialogs', () => {
  test('checkout-to excludes the current branch and branches already checked out in worktrees', async () => {
    const { CheckoutToDialog } = await import('#/web/components/branch-list/BranchWriteDialogs.tsx')
    render(
      <CheckoutToDialog
        open
        branch={branch('feature/current', { worktree: { path: '/tmp/current' } })}
        allBranches={[
          branch('feature/current', { worktree: { path: '/tmp/current' } }),
          branch('feature/free'),
          branch('feature/worktree', { worktree: { path: '/tmp/worktree' } }),
        ]}
        onClose={vi.fn()}
        onCheckout={vi.fn(async () => {})}
      />,
    )

    const items = selectItems()
    expect(items).toEqual(['feature/free'])
    expect(document.body.textContent).not.toContain('feature/worktree')
  })

  test('create branch submits the selected row branch as the base', async () => {
    const { CreateBranchDialog } = await import('#/web/components/branch-list/BranchWriteDialogs.tsx')
    const onCreate = vi.fn(async () => {})
    const onClose = vi.fn()
    render(
      <CreateBranchDialog
        open
        branch={branch('feature/base')}
        allBranches={[branch('feature/base')]}
        onClose={onClose}
        onCreate={onCreate}
      />,
    )

    setInputValue('#create-branch-name', 'feature/new')
    click('button[type="submit"]')
    await flush()

    expect(onCreate).toHaveBeenCalledWith('feature/new', 'feature/base')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('track remote branch derives a local branch name and submits it with the remote ref', async () => {
    mocks.getRepositoryRemoteBranches.mockResolvedValueOnce(['origin/feature/remote'])
    const { TrackRemoteBranchDialog } = await import('#/web/components/branch-list/BranchWriteDialogs.tsx')
    const onTrack = vi.fn(async () => {})
    const onClose = vi.fn()
    render(
      <TrackRemoteBranchDialog
        open
        repoId="/tmp/repo"
        allBranches={[branch('main')]}
        onClose={onClose}
        onTrack={onTrack}
      />,
    )

    await waitForAssertion(() => {
      expect(input('#track-remote-local-branch').placeholder).toBe('feature/remote')
    })
    click('button[type="submit"]')
    await flush()

    expect(onTrack).toHaveBeenCalledWith('feature/remote', 'origin/feature/remote')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('track remote branch blocks duplicate local branch names', async () => {
    mocks.getRepositoryRemoteBranches.mockResolvedValueOnce(['origin/feature/remote'])
    const { TrackRemoteBranchDialog } = await import('#/web/components/branch-list/BranchWriteDialogs.tsx')
    render(
      <TrackRemoteBranchDialog
        open
        repoId="/tmp/repo"
        allBranches={[branch('feature/remote')]}
        onClose={vi.fn()}
        onTrack={vi.fn(async () => {})}
      />,
    )

    await waitForAssertion(() => {
      expect(document.body.textContent).toContain('action.track-remote-branch-exists')
    })
    expect(button('button[type="submit"]').disabled).toBe(true)
  })
})

function branch(name: string, options: Partial<RepoBranchState> = {}): RepoBranchState {
  return {
    name,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
    ...options,
  }
}

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}

function input(selector: string): HTMLInputElement {
  const element = document.body.querySelector(selector)
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input: ${selector}`)
  return element
}

function button(selector: string): HTMLButtonElement {
  const element = document.body.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`)
  return element
}

function setInputValue(selector: string, value: string) {
  const element = input(selector)
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(element, value)
  act(() => {
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function click(selector: string) {
  const element = button(selector)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function selectItems(): string[] {
  return [...document.body.querySelectorAll('[data-select-item]')].map((element) => {
    return element.getAttribute('data-select-item') ?? ''
  })
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function waitForAssertion(assertion: () => void) {
  let lastError: unknown
  for (let i = 0; i < 10; i += 1) {
    try {
      assertion()
      return
    } catch (err) {
      lastError = err
      await flush()
    }
  }
  throw lastError
}
