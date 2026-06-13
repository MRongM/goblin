// Top app bar with embedded tab strip. Holds the ambient settings entry.
// The .topbar CSS rule turns this into the OS drag region; child buttons
// opt out via -webkit-app-region: no-drag (set globally on `button` and
// any element with `data-interactive`).

import type { ReactNode } from 'react'
import { Settings } from 'lucide-react'
import { useT } from '#/web/stores/i18n.ts'
import { Tip } from '#/web/components/Tip.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'

interface Props {
  onOpenSettings: () => void
  children: ReactNode
  actions?: ReactNode
}

export function Topbar({ onOpenSettings, children, actions }: Props) {
  const t = useT()

  return (
    <div
      className="topbar relative flex items-center gap-2 overflow-hidden border-b border-separator bg-background text-sm"
      style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}
    >
      {children}
      {actions && (
        <>
          <div data-testid="topbar-actions" className="flex h-full shrink-0 items-center gap-1">
            {actions}
          </div>
          <div aria-hidden="true" className="h-4 w-px shrink-0 bg-separator/70" />
        </>
      )}
      <Tip label={t('topbar.settings')}>
        <Button variant="ghost" size="icon" onClick={() => onOpenSettings()} aria-label={t('topbar.settings')}>
          <Settings />
        </Button>
      </Tip>
    </div>
  )
}
