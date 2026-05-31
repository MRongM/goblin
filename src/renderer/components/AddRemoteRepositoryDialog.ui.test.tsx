/* @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AddRemoteRepositoryDialog } from '#/renderer/components/AddRemoteRepositoryDialog.tsx'

const rpcMocks = vi.hoisted(() => ({
  identityFileDialog: vi.fn(),
  initializeSshAccess: vi.fn(),
  listSshHosts: vi.fn(),
  prepareSshInit: vi.fn(),
  resolveTarget: vi.fn(),
  testRepository: vi.fn(),
  trustSshHostKey: vi.fn(),
}))

vi.mock('#/renderer/rpc.ts', () => ({
  rpc: {
    remote: {
      identityFileDialog: { mutate: rpcMocks.identityFileDialog },
      initializeSshAccess: { mutate: rpcMocks.initializeSshAccess },
      listSshHosts: { query: rpcMocks.listSshHosts },
      prepareSshInit: { query: rpcMocks.prepareSshInit },
      resolveTarget: { query: rpcMocks.resolveTarget },
      testRepository: { query: rpcMocks.testRepository },
      trustSshHostKey: { mutate: rpcMocks.trustSshHostKey },
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
    rpcMocks.initializeSshAccess.mockResolvedValue({ ok: true, message: 'installed' })
    rpcMocks.listSshHosts.mockResolvedValue([])
    rpcMocks.prepareSshInit.mockResolvedValue({ ok: true, keyStatus: 'existing', hostKeyStatus: 'trusted' })
    rpcMocks.trustSshHostKey.mockResolvedValue({ ok: true, message: 'trusted' })
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

  test('prefills and resets manual user and port defaults when opened', async () => {
    await act(async () => {
      root.render(<AddRemoteRepositoryDialog open={true} onClose={vi.fn()} onAddRemote={vi.fn()} />)
    })

    expect(document.querySelector<HTMLInputElement>('#remote-user')?.value).toBe('root')
    expect(document.querySelector<HTMLInputElement>('#remote-port')?.value).toBe('22')

    await changeInput('#remote-user', 'deploy')
    await changeInput('#remote-port', '2222')

    await act(async () => {
      root.render(<AddRemoteRepositoryDialog open={false} onClose={vi.fn()} onAddRemote={vi.fn()} />)
    })
    await act(async () => {
      root.render(<AddRemoteRepositoryDialog open={true} onClose={vi.fn()} onAddRemote={vi.fn()} />)
    })

    expect(document.querySelector<HTMLInputElement>('#remote-user')?.value).toBe('root')
    expect(document.querySelector<HTMLInputElement>('#remote-port')?.value).toBe('22')
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

  test('initializes SSH access from manual mode and then runs diagnostics', async () => {
    const target = {
      id: 'ssh://deploy@prod.example.com:22/srv/goblin',
      alias: null,
      host: 'prod.example.com',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      displayName: 'prod.example.com:goblin',
    }
    rpcMocks.resolveTarget.mockResolvedValue({ target })
    rpcMocks.testRepository.mockResolvedValue({ target, ok: true, stages: [] })

    await act(async () => {
      root.render(<AddRemoteRepositoryDialog open={true} onClose={vi.fn()} onAddRemote={vi.fn()} />)
    })
    await changeInput('#remote-host', 'prod.example.com')
    await changeInput('#remote-user', 'deploy')
    await changeInput('#remote-path', '/srv/goblin')
    await expandInitializationPanel()
    await changeInput('#remote-ssh-init-password', 'secret')

    await act(async () => {
      buttonWithText('remote.ssh-init-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(rpcMocks.prepareSshInit).toHaveBeenCalledWith({ host: 'prod.example.com', user: 'deploy', port: 22 })
    expect(rpcMocks.initializeSshAccess).toHaveBeenCalledWith({
      host: 'prod.example.com',
      user: 'deploy',
      port: 22,
      password: 'secret',
    })
    expect(rpcMocks.resolveTarget).toHaveBeenCalledWith({
      mode: 'manual',
      host: 'prod.example.com',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
    })
    expect(rpcMocks.testRepository).toHaveBeenCalledWith({ target })
  })

  test('refreshes SSH config hosts after successful manual initialization', async () => {
    const target = {
      id: 'ssh://deploy@prod.example.com:22/srv/goblin',
      alias: null,
      host: 'prod.example.com',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      displayName: 'prod.example.com:goblin',
    }
    rpcMocks.listSshHosts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ alias: 'prod-init', hostName: 'prod.example.com', user: 'deploy', port: 22 }])
    rpcMocks.resolveTarget.mockResolvedValue({ target })
    rpcMocks.testRepository.mockResolvedValue({ target, ok: true, stages: [] })

    await act(async () => {
      root.render(<AddRemoteRepositoryDialog open={true} onClose={vi.fn()} onAddRemote={vi.fn()} />)
    })
    await changeInput('#remote-host', 'prod.example.com')
    await changeInput('#remote-user', 'deploy')
    await changeInput('#remote-path', '/srv/goblin')
    await expandInitializationPanel()
    await changeInput('#remote-ssh-init-password', 'secret')

    await act(async () => {
      buttonWithText('remote.ssh-init-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(rpcMocks.listSshHosts).toHaveBeenCalledTimes(2)
    const configButton = buttonWithText('remote.ssh-config')
    expect(configButton?.disabled).toBe(false)

    await act(async () => {
      configButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.querySelector<HTMLSelectElement>('#remote-ssh-host')?.textContent).toContain('prod-init')
  })
})

async function expandInitializationPanel(): Promise<void> {
  const toggle = document.querySelector<HTMLButtonElement>('button[aria-expanded]')
  expect(toggle).not.toBeNull()
  await act(async () => {
    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function changeInput(selector: string, value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(selector)
  expect(input).not.toBeNull()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(text),
  )
}
