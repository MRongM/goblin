import { useEffect } from 'react'
import { onRpcEventType } from '#/renderer/rpc.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'

export function useRemotePortSessionEvents(): void {
  useEffect(() => {
    return onRpcEventType('remote-port-session-changed', (event) => {
      useReposStore.getState().applyRemotePortSessionChanged(event.session)
    })
  }, [])
}
