// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Topbar } from '#/web/components/Topbar.tsx'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('Topbar', () => {
  test('renders actions before settings', () => {
    render(
      <Topbar
        onOpenSettings={() => {}}
        actions={<button aria-label="Repository actions">Actions</button>}
      >
        <div data-testid="repo-tabs">Tabs</div>
      </Topbar>,
    )

    const actions = document.body.querySelector('button[aria-label="Repository actions"]')
    const settings = document.body.querySelector('button[aria-label="topbar.settings"]')
    expect(actions).toBeInstanceOf(HTMLButtonElement)
    expect(settings).toBeInstanceOf(HTMLButtonElement)
    expect(actions!.compareDocumentPosition(settings!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('keeps settings clickable with an action slot', () => {
    const openSettings = vi.fn()
    render(
      <Topbar onOpenSettings={openSettings} actions={<button aria-label="Repository actions">Actions</button>}>
        <div data-testid="repo-tabs">Tabs</div>
      </Topbar>,
    )

    const settings = document.body.querySelector('button[aria-label="topbar.settings"]')
    if (!(settings instanceof HTMLButtonElement)) throw new Error('missing settings button')

    act(() => {
      settings.click()
    })

    expect(openSettings).toHaveBeenCalledTimes(1)
  })
})

function render(element: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}
