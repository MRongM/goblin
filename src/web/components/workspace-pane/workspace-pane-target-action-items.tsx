import { Diff, FolderTree, History } from '@lucide/vue'
import type { VNodeChild } from 'vue'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

export interface WorkspacePaneTargetActionItem {
  id: WorkspacePaneStaticTabType
  label: string
  disabled: boolean
  visible: boolean
  icon: VNodeChild
  onSelect: () => void
}

interface WorkspacePaneTargetActionItemsOptions {
  disabled: boolean
  hasWorktree: boolean
  statusIcon: VNodeChild
  onOpenTab: (type: WorkspacePaneStaticTabType) => void
}

type WorkspacePaneTargetActionTranslator = (key: string) => string

export function workspacePaneTargetActionItems(
  t: WorkspacePaneTargetActionTranslator,
  options: WorkspacePaneTargetActionItemsOptions,
): WorkspacePaneTargetActionItem[] {
  return [
    {
      id: 'status',
      label: t('tab.status'),
      disabled: options.disabled,
      visible: true,
      icon: options.statusIcon,
      onSelect: () => options.onOpenTab('status'),
    },
    {
      id: 'changes',
      label: t('tab.changes'),
      disabled: options.disabled,
      visible: options.hasWorktree,
      icon: <Diff />,
      onSelect: () => options.onOpenTab('changes'),
    },
    {
      id: 'files',
      label: t('tab.files'),
      disabled: options.disabled,
      visible: options.hasWorktree,
      icon: <FolderTree />,
      onSelect: () => options.onOpenTab('files'),
    },
    {
      id: 'history',
      label: t('tab.log'),
      disabled: options.disabled,
      visible: true,
      icon: <History />,
      onSelect: () => options.onOpenTab('history'),
    },
  ]
}
