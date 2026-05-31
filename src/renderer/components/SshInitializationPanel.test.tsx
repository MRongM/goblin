/* @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SshInitializationPanel, canInitializeSshAccess } from '#/renderer/components/SshInitializationPanel.tsx'

const rpcMocks = vi.hoisted(() => ({
  initializeSshAccess: vi.fn(),
  prepareSshInit: vi.fn(),
  trustSshHostKey: vi.fn(),
}))

vi.mock('#/renderer/rpc.ts', () => ({
  rpc: {
    remote: {
      initializeSshAccess: { mutate: rpcMocks.initializeSshAccess },
      prepareSshInit: { query: rpcMocks.prepareSshInit },
      trustSshHostKey: { mutate: rpcMocks.trustSshHostKey },
    },
  },
}))

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

describe('SshInitializationPanel helpers', () => {
  test('requires manual connection fields and a temporary password', () => {
    expect(
      canInitializeSshAccess({
        mode: 'manual',
        host: 'prod.example.com',
        user: 'deploy',
        password: 'secret',
        portError: null,
        disabled: false,
        busy: false,
      }),
    ).toBe(true)

    expect(
      canInitializeSshAccess({
        mode: 'config',
        host: 'prod.example.com',
        user: 'deploy',
        password: 'secret',
        portError: null,
        disabled: false,
        busy: false,
      }),
    ).toBe(false)
  })
})

describe('SshInitializationPanel UI', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    rpcMocks.initializeSshAccess.mockResolvedValue({ ok: true, message: 'installed' })
    rpcMocks.prepareSshInit.mockResolvedValue({ ok: true, keyStatus: 'existing', hostKeyStatus: 'trusted' })
    rpcMocks.trustSshHostKey.mockResolvedValue({ ok: true, message: 'trusted' })
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  })

  test('prepares and initializes trusted SSH access with a temporary password', async () => {
    const onInitialized = vi.fn()

    await act(async () => {
      root.render(
        <SshInitializationPanel
          mode="manual"
          host="prod.example.com"
          user="deploy"
          port={2222}
          portError={null}
          disabled={false}
          onInitialized={onInitialized}
        />,
      )
    })
    await expandInitializationPanel()
    await changeInput('#remote-ssh-init-password', 'secret')

    await act(async () => {
      buttonWithText('remote.ssh-init-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(rpcMocks.prepareSshInit).toHaveBeenCalledWith({ host: 'prod.example.com', user: 'deploy', port: 2222 })
    expect(rpcMocks.initializeSshAccess).toHaveBeenCalledWith({
      host: 'prod.example.com',
      user: 'deploy',
      port: 2222,
      password: 'secret',
    })
    expect(onInitialized).toHaveBeenCalledTimes(1)
    expect(document.querySelector<HTMLInputElement>('#remote-ssh-init-password')?.value).toBe('')
  })

  test('requires host key confirmation before installing access', async () => {
    rpcMocks.prepareSshInit.mockResolvedValue({
      ok: true,
      keyStatus: 'generated',
      hostKeyStatus: 'needs-confirmation',
      confirmation: {
        host: 'prod.example.com',
        port: 22,
        key: 'prod.example.com ssh-ed25519 AAAA',
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:abc',
      },
    })

    await act(async () => {
      root.render(
        <SshInitializationPanel
          mode="manual"
          host="prod.example.com"
          user="deploy"
          port={22}
          portError={null}
          disabled={false}
        />,
      )
    })
    await expandInitializationPanel()
    await changeInput('#remote-ssh-init-password', 'secret')
    await act(async () => {
      buttonWithText('remote.ssh-init-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.body.textContent).toContain('SHA256:abc')
    await act(async () => {
      buttonWithText('remote.ssh-init-trust')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(rpcMocks.trustSshHostKey).toHaveBeenCalledWith({
      host: 'prod.example.com',
      port: 22,
      key: 'prod.example.com ssh-ed25519 AAAA',
      fingerprint: 'SHA256:abc',
    })
    expect(rpcMocks.initializeSshAccess).toHaveBeenCalledWith({
      host: 'prod.example.com',
      user: 'deploy',
      port: 22,
      password: 'secret',
    })
  })

  test('requires explicit confirmation before replacing a changed host key', async () => {
    rpcMocks.prepareSshInit.mockResolvedValue({
      ok: true,
      keyStatus: 'existing',
      hostKeyStatus: 'changed',
      confirmation: {
        host: 'prod.example.com',
        port: 22,
        key: 'prod.example.com ssh-ed25519 AAAA',
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:changed',
      },
    })

    await act(async () => {
      root.render(
        <SshInitializationPanel
          mode="manual"
          host="prod.example.com"
          user="deploy"
          port={22}
          portError={null}
          disabled={false}
        />,
      )
    })
    await expandInitializationPanel()
    await changeInput('#remote-ssh-init-password', 'secret')
    await act(async () => {
      buttonWithText('remote.ssh-init-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.body.textContent).toContain('error.ssh-host-key-changed')
    expect(document.body.textContent).toContain('SHA256:changed')
    expect(rpcMocks.initializeSshAccess).not.toHaveBeenCalled()

    await act(async () => {
      buttonWithText('remote.ssh-init-trust')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(rpcMocks.trustSshHostKey).toHaveBeenCalledWith({
      host: 'prod.example.com',
      port: 22,
      key: 'prod.example.com ssh-ed25519 AAAA',
      fingerprint: 'SHA256:changed',
    })
    expect(rpcMocks.initializeSshAccess).toHaveBeenCalledWith({
      host: 'prod.example.com',
      user: 'deploy',
      port: 22,
      password: 'secret',
    })
  })

  test('keeps initialization controls collapsed until the section is expanded', async () => {
    await act(async () => {
      root.render(
        <SshInitializationPanel
          mode="manual"
          host="prod.example.com"
          user="deploy"
          port={22}
          portError={null}
          disabled={false}
        />,
      )
    })

    const toggle = document.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
    expect(toggle?.textContent).toContain('remote.ssh-init-title')
    expect(document.querySelector<HTMLInputElement>('#remote-ssh-init-password')).toBeNull()

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')).not.toBeNull()
    expect(document.querySelector<HTMLInputElement>('#remote-ssh-init-password')).not.toBeNull()
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
