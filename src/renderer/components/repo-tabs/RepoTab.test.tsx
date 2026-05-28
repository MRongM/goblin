import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { RepoTab } from '#/renderer/components/repo-tabs/RepoTab.tsx'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    setActivatorNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))

describe('RepoTab', () => {
  test('renders remote tab name without prefix and includes remote metadata', () => {
    const html = renderToStaticMarkup(
      <RepoTab
        repo={{
          id: 'ssh://deploy@prod:22/srv/goblin',
          name: 'prod:goblin',
          kind: 'remote',
          targetLabel: 'deploy@prod:/srv/goblin',
        }}
        isActive
        showSeparator={false}
        onHoverChange={() => {}}
        onActivate={() => {}}
        onClose={() => {}}
        onKeyboardNavigate={() => {}}
        closeLabel="Close"
      />,
    )

    expect(html).toContain('prod:goblin')
    expect(html).not.toContain('[remote]')
    expect(html).toContain('remote')
    expect(html).toContain('deploy@prod:/srv/goblin')
  })

  test('renders a green health dot for connected remote repositories', () => {
    const html = renderToStaticMarkup(
      <RepoTab
        repo={{
          id: 'ssh://deploy@prod:22/srv/goblin',
          name: 'prod:goblin',
          kind: 'remote',
          targetLabel: 'deploy@prod:/srv/goblin',
          diagnosticStatus: 'online',
        }}
        isActive
        showSeparator={false}
        onHoverChange={() => {}}
        onActivate={() => {}}
        onClose={() => {}}
        onKeyboardNavigate={() => {}}
        closeLabel="Close"
      />,
    )

    expect(html).toContain('data-remote-status="online"')
    expect(html).toContain('bg-success')
  })

  test('renders a red health dot for disconnected remote repositories', () => {
    const html = renderToStaticMarkup(
      <RepoTab
        repo={{
          id: 'ssh://deploy@prod:22/srv/goblin',
          name: 'prod:goblin',
          kind: 'remote',
          targetLabel: 'deploy@prod:/srv/goblin',
          diagnosticStatus: 'offline',
          diagnosticMessage: 'connection refused',
        }}
        isActive
        showSeparator={false}
        onHoverChange={() => {}}
        onActivate={() => {}}
        onClose={() => {}}
        onKeyboardNavigate={() => {}}
        closeLabel="Close"
      />,
    )

    expect(html).toContain('data-remote-status="offline"')
    expect(html).toContain('bg-danger')
    expect(html).toContain('connection refused')
  })
})
