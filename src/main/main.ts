import { app } from 'electron'
import { activateMainWindow } from '#/main/window.ts'
import { initTheme } from '#/main/theme.ts'
import { loadSettings, flushSettings } from '#/main/settings.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { assertDictionaryParity, resolveLang, setCurrentLang } from '#/main/i18n/index.ts'
import { wireRpcIpc } from '#/main/rpc.ts'
import { wireTerminalIpc } from '#/main/terminal.ts'
import { shutdownTerminalSessions } from '#/main/terminal-core.ts'
import { remotePortForwardManager } from '#/main/ssh/port-forward.ts'
import { syncGlobalShortcuts, unregisterAppShortcuts } from '#/main/shortcuts.ts'
import { wireAppShutdown } from '#/main/app-shutdown.ts'
import { enqueueExternalOpenPath } from '#/main/external-open.ts'

function activateMainWindowFromEvent(): void {
  void activationBarrier
    .then(() => {
      if (isQuitting) return null
      return activateMainWindow()
    })
    .catch((err) => {
      console.error('[window] failed to activate main window', err)
    })
}

let activationBarrier: Promise<void> = Promise.resolve()
let isQuitting = false

app.on('open-file', (event, path) => {
  event.preventDefault()
  if (!enqueueExternalOpenPath(path)) return
  activateMainWindowFromEvent()
})

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  activationBarrier = initializeMainProcess()

  app.on('second-instance', () => {
    activateMainWindowFromEvent()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
  })
  wireAppShutdown(app, {
    flushSettings,
    shutdownTerminalSessions,
    cleanupPortForwards: () => remotePortForwardManager.cleanupAll(),
    unregisterAppShortcuts,
  })

  await activationBarrier
  if (isQuitting) return
  await activateMainWindow()
  if (isQuitting) return
  app.on('activate', activateMainWindowFromEvent)
}

async function initializeMainProcess(): Promise<void> {
  await app.whenReady()

  const settings = await loadSettings()
  await initTheme()

  // Resolve language BEFORE buildMenu — every menu label runs through
  // `t()` and would otherwise render in the default ('en') for the
  // first frame.
  assertDictionaryParity(!app.isPackaged)
  setCurrentLang(resolveLang(settings.lang))

  wireRpcIpc()
  wireTerminalIpc()

  buildAppMenu()
  syncGlobalShortcuts(settings.globalShortcutDisabled, settings.globalShortcut)
}

void main()
