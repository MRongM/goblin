import { GitCommitHorizontal } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import { workspacePaneTargetActionItems } from '#/web/components/workspace-pane/workspace-pane-target-action-items.tsx'

interface WorktreeActionsMenuProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onOpenTab: (type: WorkspacePaneStaticTabType) => void
}

export const WorktreeActionsMenu = defineComponent<WorktreeActionsMenuProps>({
  name: 'WorktreeActionsMenu',
  props: {
    open: { type: Boolean, default: undefined },
    onOpenChange: Function as PropType<(open: boolean) => void>,
    onOpenTab: { type: Function as PropType<(type: WorkspacePaneStaticTabType) => void>, required: true },
  },

  setup(props) {
    const t = useT()

    return () => {
      const items = workspacePaneTargetActionItems(t, {
        disabled: false,
        hasWorktree: true,
        statusIcon: <GitCommitHorizontal />,
        onOpenTab: props.onOpenTab,
      }).filter((item) => item.visible)
      return (
        <ActionPopover label={t('action.menu')} open={props.open} onOpenChange={props.onOpenChange}>
          {({ close }: { close: () => void }) => (
            <div class="space-y-0.5 p-1" role="list">
              {items.map((item) => (
                <div key={item.id} role="listitem">
                  <ActionPopoverItem
                    label={item.label}
                    icon={item.icon}
                    disabled={item.disabled}
                    onSelect={() => {
                      close()
                      item.onSelect()
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </ActionPopover>
      )
    }
  },
})
