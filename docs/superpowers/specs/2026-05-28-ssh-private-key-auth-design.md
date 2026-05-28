# SSH Private Key Auth Design

## Goal

Allow remote SSH repositories to use a user-selected private key path while keeping Goblin aligned with its existing security boundary: do not store passwords, passphrases, or private key contents.

## Scope

- Support an optional private key file path for both SSH config and manual remote repository modes.
- Use OpenSSH/ssh-agent/system keychain behavior for passphrase handling.
- Preserve the current remote repository flow: resolve target, test diagnostics, browse remote folders, and add repository.
- Store only the private key path as non-secret connection metadata.

Out of scope:

- Remote account password authentication.
- Saving private key contents.
- Saving private key passphrases.
- Implementing an in-app password/passphrase prompt.

## Data Model

`RemoteRepoTarget` gains an optional `identityFile?: string` field. This value is a local private key path and is treated as connection metadata, not a secret.

`RemoteConnectionInput` gains `identityFile?: string` in both modes:

- Config mode: `{ mode: 'config', alias, remotePath, identityFile? }`
- Manual mode: `{ mode: 'manual', host, user, port?, remotePath, identityFile? }`

Target normalization keeps `identityFile` only when it is a safe path string. Secret-like fields such as `password`, `passphrase`, and `privateKey` remain stripped from normalized targets and settings.

## Path Handling

The UI accepts an empty value, an absolute path, or a `~/...` path.

Main-process normalization expands `~/...` to the current user home directory before the path is passed to `ssh -i`. Empty values are omitted.

Invalid values containing null bytes are rejected. Directory existence checks are not required before connection because users may rely on SSH config, agent state, symlinks, or platform-specific keychain behavior; OpenSSH will provide the authoritative failure message.

## SSH Command Behavior

When a target has `identityFile`, `buildRemoteCommandInvocation` adds:

```text
-i <identityFile>
```

The command continues to use non-PTY shell execution and strict host key checking.

The current forced password suppression conflicts with encrypted private keys. The SSH invocation should stop forcing `BatchMode=yes` and `NumberOfPasswordPrompts=0` for repository diagnostics and browsing so OpenSSH can use ssh-agent, system keychain, or askpass behavior to unlock the key.

Goblin still does not collect credentials directly.

## UI

`AddRemoteRepositoryDialog` adds a `Private key` input below the SSH host/manual fields.

Behavior:

- Empty input means "use system SSH defaults".
- The field is available in both SSH config and manual modes.
- Changing the field clears the resolved target and diagnostics, matching host/path changes.
- The helper text should state that Goblin stores only the path and relies on ssh-agent/system SSH for passphrases.

## Validation And RPC

The TRPC remote schemas accept optional `identityFile` for connection inputs and remote targets.

Remote target validation remains strict enough to reject malformed targets while preserving the optional key path across renderer/main boundaries.

## Tests

Add focused tests for:

- Shared target normalization preserves `identityFile` while stripping secret-like fields.
- Remote target IDs remain based on host/user/port/path, not the identity file path.
- SSH config target resolution carries `identityFile`.
- Manual target resolution carries `identityFile`.
- SSH command argv includes `-i <identityFile>` when present and omits it when absent.
- RPC schema accepts optional `identityFile`.
- Dialog input builders include `identityFile` for config and manual modes.

## Risks

Allowing passphrase prompts can cause a connection attempt to wait for user interaction depending on OS SSH/askpass setup. Existing command timeouts still bound long-running SSH operations.

If an environment has no ssh-agent or askpass available, encrypted keys may still fail. The failure should come from OpenSSH and be displayed in diagnostics without Goblin storing credentials.
