/* @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AddRemoteRepositoryDialog } from '#/renderer/components/AddRemoteRepositoryDialog.tsx'

const rpcMocks = vi.hoisted(() => ({
  identityFileDialog: vi.fn(),
  listSshHosts: vi.fn(),
  resolveTarget: vi.fn(),
  testRepository: vi.fn(),
}))

vi.mock('#/renderer/rpc.ts', () => ({
  rpc: {
    remote: {
      identityFileDialog: { mutate: rpcMocks.identityFileDialog },
      listSshHosts: { query: rpcMocks.listSshHosts },
      resolveTarget: { query: rpcMocks.resolveTarget },
      testRepository: { query: rpcMocks.testRepository },
    },
  },
}))

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

describe('AddRemoteRepositoryDialog UI', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    rpcMocks.identityFileDialog.mockResolvedValue('/Users/deploy/.ssh/id_ed25519')
    rpcMocks.listSshHosts.mockResolvedValue([])
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  })

  test('fills the private key field from the native identity file picker', async () => {
    await act(async () => {
      root.render(<AddRemoteRepositoryDialog open={true} onClose={vi.fn()} onAddRemote={vi.fn()} />)
    })

    const chooseButton = document.querySelector<HTMLButtonElement>('button[aria-label="remote.choose-private-key"]')
    expect(chooseButton).not.toBeNull()

    await act(async () => {
      chooseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const input = document.querySelector<HTMLInputElement>('#remote-private-key')
    expect(rpcMocks.identityFileDialog).toHaveBeenCalledTimes(1)
    expect(input?.value).toBe('/Users/deploy/.ssh/id_ed25519')
  })

  test('keeps the remote directory browser inside a scrollable dialog viewport', async () => {
    await act(async () => {
      root.render(<AddRemoteRepositoryDialog open={true} onClose={vi.fn()} onAddRemote={vi.fn()} />)
    })

    const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
    expect(dialog?.className).toContain('max-h-[calc(100vh-2rem)]')
    expect(dialog?.className).toContain('overflow-y-auto')
  })

  test('clears resolved target display when manual connection fields change', async () => {
    const target = {
      id: 'ssh://deploy@prod:22/srv/goblin',
      alias: null,
      host: 'prod',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      displayName: 'prod:goblin',
    }
    rpcMocks.resolveTarget.mockResolvedValue({ target })
    rpcMocks.testRepository.mockResolvedValue({ target, ok: true, stages: [] })

    await act(async () => {
      root.render(<AddRemoteRepositoryDialog open={true} onClose={vi.fn()} onAddRemote={vi.fn()} />)
    })
    await changeInput('#remote-host', 'prod')
    await changeInput('#remote-user', 'deploy')
    await changeInput('#remote-path', '/srv/goblin')

    const testButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('remote.test-connection'),
    )
    expect(testButton).not.toBeNull()
    await act(async () => {
      testButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.body.textContent).toContain(target.id)

    await changeInput('#remote-host', 'prod-new')

    expect(document.body.textContent).not.toContain(target.id)
  })
})

async function changeInput(selector: string, value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(selector)
  expect(input).not.toBeNull()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
