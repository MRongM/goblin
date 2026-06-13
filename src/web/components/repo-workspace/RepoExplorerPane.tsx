import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useState } from 'react'
import { BranchList } from '#/web/components/BranchList.tsx'
import { SplitPane } from '#/web/components/SplitPane.tsx'
import { ProjectFileTree } from '#/web/components/file-tree/ProjectFileTree.tsx'
import { ProjectChangesPanel } from '#/web/components/repo-workspace/ProjectChangesPanel.tsx'
import { ProjectStatusPanel } from '#/web/components/repo-workspace/ProjectStatusPanel.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { Toolbar } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { Badge } from '#/web/components/ui/badge.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'

type ExplorerTab = 'files' | 'changes' | 'status'

interface FileTreeRevealRequest {
  id: number
  relativePath: string
}

interface RepoExplorerPaneProps {
  repoId: string
  layout: RepoWorkspaceLayout
  showActions: boolean
}

export function RepoExplorerPane({ repoId, layout, showActions }: RepoExplorerPaneProps) {
  const { fileTreePaneSizes, setFileTreePaneSize, changeCount } = useStoreWithEqualityFn(
    useReposStore,
    (state) => {
      const repo = state.repos[repoId]
      const selected = repo?.data.branches.find((branch) => branch.name === repo.ui.selectedBranch) ?? null
      const worktreePath = selected?.worktree?.path
      return {
        fileTreePaneSizes: state.fileTreePaneSizes,
        setFileTreePaneSize: state.setFileTreePaneSize,
        changeCount: worktreePath
          ? (repo?.data.status.find((status) => status.path === worktreePath)?.entries.length ?? 0)
          : 0,
      }
    },
    (a, b) =>
      a.fileTreePaneSizes === b.fileTreePaneSizes &&
      a.setFileTreePaneSize === b.setFileTreePaneSize &&
      a.changeCount === b.changeCount,
  )
  const [activeTab, setActiveTab] = useState<ExplorerTab>('files')
  const fileTreeSize = fileTreePaneSizes[layout]
  const splitOrientation = layout === 'top-bottom' ? 'horizontal' : 'vertical'
  const sideBySide = splitOrientation === 'horizontal'

  return (
    <div data-file-tree-layout={layout} className="flex min-h-0 min-w-0 flex-1">
      <SplitPane
        orientation={splitOrientation}
        before={<BranchList repoId={repoId} showActions={showActions} />}
        after={
          <ExplorerTabs
            repoId={repoId}
            layout={layout}
            activeTab={activeTab}
            changeCount={changeCount}
            onTabChange={setActiveTab}
          />
        }
        afterSize={fileTreeSize}
        onAfterSizeChange={(size) => setFileTreePaneSize(layout, size)}
        beforeMinSize={sideBySide ? '12rem' : '8rem'}
        afterMinSize={sideBySide ? '12rem' : '8rem'}
        afterMaxSize="80%"
        className="flex-1"
      />
    </div>
  )
}

function ExplorerTabs({
  repoId,
  layout,
  activeTab,
  changeCount,
  onTabChange,
}: {
  repoId: string
  layout: RepoWorkspaceLayout
  activeTab: ExplorerTab
  changeCount: number
  onTabChange: (tab: ExplorerTab) => void
}) {
  const t = useT()
  const [revealRequest, setRevealRequest] = useState<FileTreeRevealRequest | null>(null)
  const tabs = [
    { id: 'files' as const, label: t('file-tree.title') },
    { id: 'changes' as const, label: t('tab.changes') },
    { id: 'status' as const, label: t('tab.status') },
  ]

  function handleRevealPath(relativePath: string) {
    onTabChange('files')
    setRevealRequest((current) => ({ id: (current?.id ?? 0) + 1, relativePath }))
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-separator/70 bg-background">
      <Toolbar className="h-8 px-2" variant="detail">
        <div className="flex h-full min-w-0 items-center gap-1" role="tablist" aria-label={t('file-tree.title')}>
          {tabs.map((tab) => {
            const selected = activeTab === tab.id
            return (
              <Button
                key={tab.id}
                type="button"
                variant="ghost"
                role="tab"
                aria-selected={selected}
                aria-controls={`repo-explorer-${tab.id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'h-7 gap-1.5 border px-2.5 text-sm font-normal',
                  selected
                    ? 'border-transparent bg-selected text-selected-foreground'
                    : 'border-separator text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                {tab.label}
                {tab.id === 'changes' && changeCount > 0 && (
                  <Badge variant="attention" className="font-normal font-mono tabular-nums">
                    {changeCount}
                  </Badge>
                )}
              </Button>
            )
          })}
        </div>
      </Toolbar>
      <div
        id={`repo-explorer-${activeTab}-panel`}
        role="tabpanel"
        className="flex min-h-0 flex-1 flex-col"
      >
        {activeTab === 'files' ? (
          <ProjectFileTree repoId={repoId} revealRequest={revealRequest} />
        ) : activeTab === 'changes' ? (
          <ProjectChangesPanel repoId={repoId} onRevealPath={handleRevealPath} />
        ) : (
          <ProjectStatusPanel repoId={repoId} layout={layout} />
        )}
      </div>
    </section>
  )
}
