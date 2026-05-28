# Remote Ports UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the opened remote repository port forwarding UX without touching the add-remote dialog or backend tunnel logic.

**Architecture:** Keep this as a renderer-only layout pass over `RemotePortsPopover`. Existing Zustand actions, shared port models, RPC calls, and persisted config shape remain unchanged. Tests exercise DOM structure and existing submit behavior to keep the change scoped.

**Tech Stack:** TypeScript, React, Tailwind CSS, lucide-react, Vitest/jsdom.

---

## File Structure

- Modify `src/renderer/components/repo-toolbar/RemotePortsPopover.tsx`: wider two-column popover layout, clearer saved/discovered sections, improved row hierarchy.
- Modify `src/renderer/components/repo-toolbar/RemotePortsPopover.ui.test.tsx`: TDD coverage for new layout contracts and existing manual add behavior.
- Modify `src/main/i18n/en.ts`, `src/main/i18n/zh.ts`, `src/main/i18n/ja.ts`, `src/main/i18n/ko.ts`: add concise labels for section summary and saved ports if needed.

## Task 1: Lock Layout Contract With Tests

- [ ] Add a failing UI test in `RemotePortsPopover.ui.test.tsx` that opens the popover and expects:
  - `data-remote-port-layout`
  - `data-remote-port-saved`
  - `data-remote-port-discovered`
  - wider content class `w-[min(calc(100vw-1rem),44rem)]`
- [ ] Run `bun run test "src/renderer/components/repo-toolbar/RemotePortsPopover.ui.test.tsx"` and verify the new test fails.

## Task 2: Implement Two-Column Ports Panel

- [ ] Update `RemotePortsPopover.tsx` so the popover header includes title, summary, and scan action.
- [ ] Move the manual form and saved configs into the left column.
- [ ] Move scan messages and discovered ports into the right column.
- [ ] Preserve all existing action handlers and payloads.
- [ ] Run `bun run test "src/renderer/components/repo-toolbar/RemotePortsPopover.ui.test.tsx"` and verify it passes.

## Task 3: Polish Copy And Verify

- [ ] Add any required i18n keys across all locale files.
- [ ] Run `bun run typecheck`.
- [ ] Run `bun run test`.
- [ ] Update `.planning/STATE.md` and write the quick task summary.

## Self-Review

- The plan covers the approved scope and excludes the add-remote dialog.
- No backend or persisted data changes are planned.
- No git commit steps are included because `AGENTS.md` forbids unrequested commit/branch operations.
