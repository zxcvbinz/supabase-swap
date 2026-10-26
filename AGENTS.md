# supabase-swap (`sbs`) - guide for agents

`sbs` manages several Supabase accounts (the owner's and his clients') for the Supabase CLI and remembers which account owns which project. Always pass `--json`: every command prints a single JSON object on stdout (`{"ok": true, ...}` or `{"ok": false, "error", "code", "hint"}`). Exit codes: 0 ok, 1 user error, 130 cancelled. Progress notes go to stderr.

## Rules
- Do not switch the global account when you do not need to. Prefer `sbs run <account|project> -- supabase <command>`: the token is passed to that command only. `sbs run` prints `sbs: running as <account>` to stderr; a loose substring match is refused without `--yes` when not on a terminal, so use the exact alias, ref or name.
- To find which account owns a project: `sbs find <name|ref|org> --json`. The project cache is local, so this is instant.
- `<account|project>` resolves as: alias, then project ref, then project name (exact, then unique substring). Otherwise `ambiguous` or `not_found`.
- Never print tokens or passwords. `sbs creds` never returns the password in JSON or when stdout is not a terminal.
- `sbs add` and `sbs new` open the user's default browser and need a terminal (the user types a verification code). Tell the user before running them. The browser must be signed in to Supabase as the account being added. In a non-interactive run they fail with `needs_login` / `needs_terminal`.
- Commands that need a valid token (`use`, `run`, `sync`, `projects --refresh`) re-check it at most once an hour. A revoked token needs the user to run `sbs add` again.
- `sbs rm` needs `--yes` (it only forgets the account; the token stays valid on Supabase until revoked).

## Commands
| Purpose | Command |
|---|---|
| Accounts | `sbs ls --json` |
| Projects of all accounts | `sbs projects [text] [--refresh] --json` |
| Which account owns a project | `sbs find <text> --json` |
| Run as an account/project | `sbs run <account\|project> -- supabase projects list` |
| Switch the CLI globally | `sbs use <account\|project> --json` |
| Add an existing account | `sbs add [alias] [--mine\|--client]` |
| Create a client account | `sbs new <email> [alias]` |
| Open the dashboard / team page | `sbs open [account\|project] [--team] --json` |
| Check tokens, refresh projects | `sbs sync --json` |
| Rename / forget | `sbs rename <alias> <new>` / `sbs rm <alias> --yes` |

## MCP
Register once: `claude mcp add sbs -- sbs mcp`. Tools: `list_accounts`, `list_projects {query?}`, `find_project {query}` (returns the account alias to use with `sbs run`), `sync`. No tokens or passwords are exposed.

## Error codes
`not_found`, `ambiguous`, `exists`, `invalid_alias`, `needs_login` (run `sbs add`), `needs_terminal`, `email_mismatch` (browser signed in as another account), `login_failed`, `confirmation_required` (repeat with `--yes`), `no_password`, `password_hidden`, `copy_failed`, `keychain_kept`, `locked`, `network`, `cancelled`, `http_<status>`.
