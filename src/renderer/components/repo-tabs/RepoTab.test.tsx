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
})
