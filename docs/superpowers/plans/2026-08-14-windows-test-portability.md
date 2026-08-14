# Windows Test Portability Implementation Plan

**Goal:** Make the repository test suite exercise the same domain contracts on Windows without feeding POSIX-only paths into native Windows execution boundaries.

**Architecture:** Keep production path admission strict. Test fixtures that cross a native boundary derive a current-platform path and canonical file locator from one shared helper. Tests that intentionally validate POSIX-only filesystem or shell behavior remain explicitly platform-scoped.

**Tech Stack:** TypeScript, Node.js strip-only mode, Vitest, Bun scripts, PowerShell/Windows 11.

---

### Task 1: Canonical native test fixtures

- Add native path and local workspace locator builders to `src/test-utils/workspace-id.ts`.
- Migrate shared repository, route, terminal, and physical-worktree fixtures.
- Run the affected server module, route, terminal, and worktree-removal suites.

### Task 2: Platform-aware path expectations

- Replace host-dependent literal path expectations in main-process and Git tests with `node:path` derived values.
- Preserve explicit POSIX and Windows grammar tests by passing their platform deliberately.
- Run the affected main and system suites.

### Task 3: Platform-specific operating-system behavior

- Scope Unix permission semantics and executable helper tests to non-Windows hosts.
- Make Bash integration invocations use a Windows-safe command boundary when Bash is available.
- Keep native Windows ConPTY coverage active.
- Run filesystem, node-pty, and SSH suites.

### Task 4: Full verification

- Run `bun run typecheck`.
- Run `bun run test`.
- Re-run the focused Windows terminal and packaging tests.
- Confirm the worktree contains only intentional source and documentation changes.
