import type { RemoteDiagnosticCategory, RepoKind } from '#/shared/remote-repo.ts'

export interface RepoTabSummary {
  id: string
  name: string
  kind: RepoKind
  targetLabel: string | null
  diagnosticCategory?: RemoteDiagnosticCategory
}

export interface RepoTabStripLabels {
  repositories: string
  emptyBefore: string
  emptyOpenLabel: string
  emptyAfter: string
  close: string
  dragToReorder: string
  open: string
  openLocal: string
  openLocalShortcut: string | null
  clone: string
  cloneShortcut: string | null
  addRemote: string
  missingTitle: string
  missingDismiss: string
}
