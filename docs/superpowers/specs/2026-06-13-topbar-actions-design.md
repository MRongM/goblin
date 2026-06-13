# Topbar Actions Consolidation Design

## Intent

Move the repository-level operation area into the main topbar and remove the secondary repository toolbar. The selected direction is the compact icon-only layout: all repository controls sit before Settings in the topbar.

The goal is to reduce vertical chrome while preserving the existing repository workflows and state ownership.

## Scope

In scope:

- Move the current `RepoToolbar` button and input controls into `Topbar`, before the Settings button.
- Include the non-focus controls: branch view mode, branch search, refresh/activity, create worktree, and workspace layout controls.
- Include the focus-mode controls: branch switcher and selected-branch action menu, plus refresh/activity, create worktree, and workspace layout controls.
- Render the moved controls as compact icon-only controls in the topbar.
- Remove the secondary repository toolbar from loaded repository views.
- Remove the secondary toolbar placeholder from repository loading skeletons.
- Preserve existing tooltips, `aria-label` values, disabled states, compact-mode behavior, and store-driven data flow.

Out of scope:

- Changing repository actions, branch filtering semantics, worktree creation, refresh behavior, or workspace layout persistence.
- Adding an overflow menu.
- Changing the repository tab strip behavior.
- Changing the Settings screen topbar.

## Layout

The topbar order becomes:

1. Repository tab strip.
2. Flexible spacer.
3. Active repository controls.
4. Visual divider.
5. Settings button.

Repository controls are only rendered when an active repository exists. With no active repository, Settings remains the only right-side ambient action.

The controls use icon-only presentation. Each action must keep an accessible name through `aria-label` and a tooltip. Text labels such as Refresh or Create worktree are not shown in the topbar, including non-compact desktop mode. Search may temporarily expand to an input while active or while a query is present.

The selected non-focus control order is:

1. Branch view mode control.
2. Branch search control.
3. Refresh or current activity indicator.
4. Create worktree.
5. Workspace layout control.

The selected focus-mode control order is:

1. Branch switcher.
2. Selected-branch action menu.
3. Refresh or current activity indicator.
4. Create worktree.
5. Workspace layout control.

This keeps navigation/filtering controls closest to the repository tabs and keeps ambient app Settings at the far right.

`BranchSummaryInline` is not moved into the topbar in this icon-only direction because it is metadata rather than a button control and would undermine the compact layout. Selected branch context remains visible in the branch detail body and available through the branch switcher tooltip.

## Component Boundaries

`Topbar` should accept an optional `actions` slot, rendered immediately before Settings. This keeps `Topbar` responsible for shell placement while leaving repository-specific logic outside the generic shell component.

Create a focused topbar repository controls component that reuses the existing toolbar subcomponents and store selectors where practical. The component should not introduce new repository state or duplicate business logic.

`RepoView` should no longer import or render `RepoToolbar`. It should render repository content directly below the global topbar.

The existing `RepoToolbar` module may be refactored into reusable pieces or replaced by a new `TopbarRepoControls` component. The implementation should prefer the smaller change that avoids duplicated selectors and action handlers.

## Data Flow

The existing store remains the source of truth:

- Branch view mode reads from `repo.ui.branchViewMode` and writes through `setBranchViewMode`.
- Branch search reads from `branchSearchQueries[repoId]` and writes through `setBranchSearchQuery`.
- Focus-mode branch switching reads visible branches and selected branch state, then writes through existing navigation.
- Focus-mode selected-branch actions use the existing branch action item hook and shortcut registry.
- Refresh/activity reads repository operations and uses the existing refresh coordinator.
- Create worktree submits the existing `createWorktree` branch action.
- Workspace layout reads `workspaceLayout` and writes through `setWorkspaceLayout`.

No new server route, IPC channel, or persistence field is required.

## Responsive Behavior

The B layout is icon-only in all viewport sizes.

Existing compact behavior remains:

- Workspace layout control is hidden in compact mode.
- Activity and create worktree controls stay compact and do not show text labels.
- Focus-mode branch switcher stays icon-only and exposes selected branch context through tooltip or accessible label.
- Branch controls must avoid forcing the repository tabs or Settings button out of the topbar.

If available width is constrained, the tab strip remains the flexible region and the right-side controls stay shrink-wrapped.

## Loading And Empty States

Repository loading skeletons should not render a secondary repository toolbar placeholder. Skeletons should begin with the workspace body directly under the topbar.

The active repository controls should not render while there is no active repository or while the active repository record is unavailable from the store.

Unavailable repository views keep their existing behavior unless they currently depend on the removed secondary toolbar. No new unavailable-repo actions are introduced.

## Error Handling

No new error surface is added.

Existing disabled and failure states remain:

- Refresh/activity controls continue to show current operation state and fetch/cache indicators.
- Create worktree remains disabled while branch actions are busy.
- Search and branch view controls remain disabled when there are no branches.

## Tests

Update or add focused tests for:

- `Topbar` renders repository controls before Settings when an active repository action slot is provided.
- `RepoView` no longer renders the secondary repository toolbar.
- Topbar repository controls expose branch view, branch search, refresh/activity, create worktree, and layout controls for an active repository.
- Topbar repository controls expose the focus-mode branch switcher and selected-branch action menu when the workspace is focused.
- Topbar repository controls hide workspace layout in compact mode.
- Repository skeletons no longer render secondary toolbar placeholders.

Run:

```bash
bun run typecheck
bun run test
```

For a narrower local loop during implementation, run the affected component tests first, then the full commands above.

## Risks

The main risk is topbar crowding when many repository tabs are open. The icon-only direction reduces this risk, and the tab strip should remain the flexible portion of the row.

The second risk is behavior drift from duplicating existing toolbar logic. The implementation should reuse existing subcomponents or extract shared selectors rather than reimplementing repository action logic.

## Acceptance Criteria

- There is no second repository operation bar below the topbar.
- All former repository toolbar button and input controls are available in the topbar before Settings.
- Topbar controls are icon-only with accessible labels and tooltips.
- Existing repository actions, search/filter behavior, and layout switching continue to work.
- Typecheck and tests pass.
