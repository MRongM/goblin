/* @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RemotePortsPopover } from '#/renderer/components/repo-toolbar/RemotePortsPopover.tsx'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'

const storeActions = vi.hoisted(() => ({
  addRemotePortForward: vi.fn(),
  removeRemotePortForward: vi.fn(),
  startRemotePortForward: vi.fn(),
  stopRemotePortForward: vi.fn(),
  scanRemotePorts: vi.fn(),
}))

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('#/renderer/stores/repos/store.ts', () => ({
  useReposStore: (selector: any) => selector(storeActions),
}))

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

function remoteRepo(): RepoState {
  const repo = emptyRepo('ssh://deploy@prod:22/srv/goblin', 'prod:goblin', {
    kind: 'remote',
    remoteTarget: {
      id: 'ssh://deploy@prod:22/srv/goblin',
      alias: null,
      host: 'prod',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      displayName: 'prod:goblin',
    },
  })
  repo.remotePorts.configs = [{ id: 'cfg-1', remotePort: 3000, requestedLocalPort: 3000, label: 'dev' }]
  repo.remotePorts.sessions = {
    'cfg-1': {
      configId: 'cfg-1',
      repoId: repo.id,
      remotePort: 3000,
      requestedLocalPort: 3000,
      actualLocalPort: 49152,
      localHost: '127.0.0.1',
      remoteHost: '127.0.0.1',
      status: 'running',
      startedAt: 123,
    },
  }
  repo.remotePorts.scan.ports = [
    { port: 5173, protocol: 'tcp', processName: 'vite', pid: '123', address: '127.0.0.1' },
  ]
  return repo
}

function remoteRepoWithManyPorts(count: number): RepoState {
  const repo = remoteRepo()
  repo.remotePorts.sessions = {}
  repo.remotePorts.configs = Array.from({ length: count }, (_, index) => ({
    id: `cfg-${index + 1}`,
    remotePort: 3000 + index,
    requestedLocalPort: 3000 + index,
    label: `service-${index + 1}`,
  }))
  return repo
}

async function openPopover() {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="remote-ports.title"]')
  expect(trigger).not.toBeNull()
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('RemotePortsPopover', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: TestResizeObserver })
    Object.values(storeActions).forEach((fn) => fn.mockReset())
    storeActions.addRemotePortForward.mockReturnValue({
      id: 'new',
      remotePort: 8080,
      requestedLocalPort: null,
      label: null,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  })

  test('shows running url and requested local port hint', async () => {
    await act(async () => {
      root.render(<RemotePortsPopover repo={remoteRepo()} />)
    })
    await openPopover()

    expect(document.body.textContent).toContain('http://127.0.0.1:49152')
    expect(document.body.textContent).toContain('remote-ports.requested-local')
  })

  test('adds a manual remote port config', async () => {
    const repo = remoteRepo()
    await act(async () => {
      root.render(<RemotePortsPopover repo={repo} />)
    })
    await openPopover()

    const remoteInput = document.querySelector<HTMLInputElement>('#remote-port-forward-remote-port')
    expect(remoteInput).not.toBeNull()
    await act(async () => {
      setInputValue(remoteInput!, '8080')
    })
    await act(async () => {
      document.querySelector<HTMLFormElement>('[data-remote-port-form]')?.dispatchEvent(
        new SubmitEvent('submit', { bubbles: true, cancelable: true }),
      )
    })

    expect(storeActions.addRemotePortForward).toHaveBeenCalledWith(repo.id, {
      remotePort: 8080,
      requestedLocalPort: null,
      label: null,
    })
  })

  test('organizes saved and discovered ports in a wider management layout', async () => {
    await act(async () => {
      root.render(<RemotePortsPopover repo={remoteRepo()} />)
    })
    await openPopover()

    const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
    const layout = document.querySelector<HTMLElement>('[data-remote-port-layout]')
    const saved = document.querySelector<HTMLElement>('[data-remote-port-saved]')
    const discovered = document.querySelector<HTMLElement>('[data-remote-port-discovered]')

    expect(content?.className).toContain('w-[min(calc(100vw-1rem),44rem)]')
    expect(layout?.className).toContain('sm:grid-cols-[minmax(0,1fr)_11rem]')
    expect(saved?.textContent).toContain('remote-ports.saved')
    expect(discovered?.textContent).toContain('remote-ports.discovered')
    expect(discovered?.textContent).toContain('vite')
  })

  test('keeps long port lists inside a scrollable popover body', async () => {
    await act(async () => {
      root.render(<RemotePortsPopover repo={remoteRepoWithManyPorts(30)} />)
    })
    await openPopover()

    const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
    const scrollBody = document.querySelector<HTMLElement>('[data-remote-port-scroll]')

    expect(content?.className).toContain('max-h-(--radix-popover-content-available-height)')
    expect(content?.className).toContain('overflow-hidden')
    expect(scrollBody?.className).toContain('overflow-y-auto')
    expect(document.body.textContent).toContain('service-30')
  })
})
