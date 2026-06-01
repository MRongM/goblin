import type { RemoteDiagnosticCategory, RepoKind } from '#/shared/remote-repo.ts'
import type { GitRemoteInfo } from '#/renderer/types.ts'

export type RepoTabConnectionStatus = 'unknown' | 'checking' | 'online' | 'offline'

export interface RepoTabSummary {
  id: string
  name: string
  kind?: RepoKind
  targetLabel?: string | null
  diagnosticStatus?: RepoTabConnectionStatus
  diagnosticCategory?: RemoteDiagnosticCategory
  diagnosticMessage?: string | null
  remoteDetails?: GitRemoteInfo[]
  unavailable?: boolean
}

export interface RepoTabStripLabels {
  repositories: string
  close: string
  dragToReorder: string
  open: string
  openLocal: string
  openLocalShortcut: string | null
  clone: string
  cloneShortcut: string | null
  addRemote: string
  unavailable: string
}
