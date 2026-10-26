<p align="center">
  <img src="assets/logo.svg" alt="sbs" width="300">
</p>

<p align="center">
  <strong>Switch the Supabase CLI between your own account and your clients' accounts.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-2fbf71"></a>
  <img alt="Platform: macOS" src="https://img.shields.io/badge/platform-macOS-lightgrey">
  <a href="#install"><img alt="Homebrew tap" src="https://img.shields.io/badge/brew-zxcvbinz%2Ftap%2Fsbs-fbb040?logo=homebrew&logoColor=white"></a>
  <a href="https://bun.sh"><img alt="Built with Bun" src="https://img.shields.io/badge/built%20with-Bun-f9f1e1?logo=bun&logoColor=black"></a>
</p>

## Why

Freelancers and agencies often create Supabase accounts for their clients and invite themselves to the organization. That works for day-to-day project access, but some admin tasks still need the client's own account. The Supabase CLI holds one login at a time, so you end up logging in and out all day.

`sbs` keeps all the accounts (yours and your clients') and switches the CLI between them in one command. It also remembers which account owns which project, so `sbs use crm-revenge` is enough.

```
$ sbs ls
Mine
   ALIAS  EMAIL            PROJECTS
*  me     you@example.com  2

Clients
   ALIAS      EMAIL               PROJECTS
   acme       admin@acme.example  2
   rossi-srl  info@rossi.example  1

$ sbs find crm-revenge
ACCOUNT    NAME         REF                   ORG        REGION        STATUS
rossi-srl  crm-revenge  efghijklmnopqrstuvwx  Rossi Srl  eu-central-1  ACTIVE_HEALTHY

$ sbs use crm-revenge
Using rossi-srl (info@rossi.example)  project crm-revenge
```

## Install

Requirements: macOS and the [Supabase CLI](https://supabase.com/docs/guides/cli).

**Homebrew**

```sh
brew install zxcvbinz/tap/sbs
```

**Install script** (downloads the release binary and verifies its SHA-256 checksum; installs to `~/.local/bin`, make sure it is on your `PATH`)

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/zxcvbinz/supabase-swap/main/scripts/install.sh | bash
```

To be safe, pin the script to a release tag instead of `main` (replace `main` with e.g. `v0.2.0` in the URL above).

**From source** (needs [Bun](https://bun.sh))

```sh
git clone https://github.com/zxcvbinz/supabase-swap.git
cd supabase-swap
bun install
bun run install-bin      # builds and installs ~/.local/bin/sbs
```

## Quick start

```sh
sbs add                  # opens your browser; sign in as the account to add
sbs use acme             # point the Supabase CLI at that account
supabase projects list
```

Before `sbs add`, make sure the right Supabase account is signed in in your default browser (sign out or switch there first if needed). Run `sbs` with no arguments for the interactive screen.

## Commands

| Command | What it does |
| --- | --- |
| `sbs` | Interactive screen: accounts and actions. |
| `sbs add [alias] [--mine\|--client]` | Sign in through your browser and save the account with its projects. |
| `sbs new <email> [alias]` | Create an account for a client: a generated password is copied to the clipboard and the sign-up page opens; after you confirm the email, sbs runs the browser login, creates an organization and opens its Team page so you can invite yourself. |
| `sbs use <account\|project>` | Point the Supabase CLI at an account. A project name or ref works too: `sbs use crm-revenge`. |
| `sbs run <account\|project> -- <cmd...>` | Run one command as that account only, without switching: `sbs run acme -- supabase db push`. |
| `sbs ls` | Accounts and project counts. |
| `sbs projects [text] [--refresh]` | All projects across accounts, with their account. |
| `sbs find <text>` | Which account owns a project (name, ref or organization). |
| `sbs open [account\|project] [--team]` | Open the dashboard in your default browser. |
| `sbs sync` | Check tokens and refresh the project lists. |
| `sbs rename <alias> <new>` | Rename an account. |
| `sbs rm <alias>` | Forget an account. Its token stays valid on Supabase until you revoke it. |
| `sbs creds <alias> [--copy]` | Show the password of an account created with `sbs new`. It is printed only on a terminal (never with `--json` or in a pipe); otherwise use `--copy`. |
| `sbs mcp` | MCP server for AI agents (stdio). |

`<account|project>` resolves as an alias, then a project ref, then a project name (exact, then unique substring). Every command supports `--json` (one JSON object with stable error codes) and `--yes` (skip confirmations).

`sbs open` uses your default browser, so the dashboard shows whichever Supabase account is signed in there.

## For AI agents

`sbs mcp` is an MCP server with four tools: `list_accounts`, `list_projects`, `find_project` and `sync`. It never returns tokens or passwords.

```sh
claude mcp add sbs -- sbs mcp
```

Without MCP, agents can use the CLI with `--json`. A typical flow: find the project, then run the Supabase CLI as its account without changing global state.

```sh
sbs find crm-revenge --json
sbs run crm-revenge -- supabase db push
```

`sbs add` and `sbs new` need a terminal (you type a verification code), so an agent should ask you to run them. See [AGENTS.md](AGENTS.md) for the full agent guide, commands and error codes.

## How it works

**Adding an account.** `sbs add` uses the same browser login as `supabase login`. It opens the Supabase CLI login page in your default browser, where the dashboard (already signed in) creates a personal access token and shows a verification code. You paste the code into the terminal. The token travels back encrypted with a one-time ECDH key generated by sbs and is decrypted locally. No captcha, no extra browser windows. When renewing an existing account, sbs refuses a login that ends up on a different email (`email_mismatch`) and changes nothing.

**Storage.** Everything is in one file, `~/.config/supabase-swap/config.json` (mode 0600, directory 0700): accounts, tokens, cached project lists and the passwords of accounts made with `sbs new`.

**Switching the CLI.** `sbs use` writes the account's token to `~/.supabase/access-token`, which the Supabase CLI reads. The CLI prefers a Keychain login over that file, so on the first `sbs use` sbs moves the CLI's own Keychain login out of the way, importing it as an account if it is not known yet. `SUPABASE_ACCESS_TOKEN` in the environment still overrides everything, including `sbs use`. `sbs run` passes the token to that one command only.

**Token checks.** Commands that need a token (`use`, `run`, `sync`, `projects --refresh`) verify it at most once an hour. If Supabase reports it revoked, sbs runs the browser login again for that account when a terminal is available. In non-interactive runs it fails with the error code `needs_login`.

## Security

- Tokens (and generated client passwords) are stored in plain JSON in `~/.config/supabase-swap/config.json`, readable only by your user (file 0600, directory 0700). This is the same model as `gh`'s `hosts.yml` or the Supabase CLI's own file fallback. Treat the file like an SSH key.
- sbs deliberately avoids the macOS Keychain: it prompted on every switch.
- `sbs use` writes the active token to `~/.supabase/access-token` (0600), as the Supabase CLI expects.
- Tokens leave your machine only to reach `api.supabase.com`.
- The MCP server and `--json` output never return tokens or passwords.
- `sbs rm` only forgets an account locally; it does not revoke the token on Supabase, so the token stays valid until you revoke it at <https://supabase.com/dashboard/account/tokens>. If the Supabase CLI token file held that token, sbs removes the file.
- `sbs creds` prints a password only on a terminal; `--json` and pipes never get it (use `--copy`).
- The release binary does not load `.env` or `bunfig.toml` from the current directory, so a hostile project folder cannot change how sbs runs.
- `SBS_CONFIG_DIR` moves the config directory (default `~/.config/supabase-swap`). Other `SBS_*` variables (API/dashboard URL, login code, browser opener, Keychain service names) are test hooks and are ignored unless `SBS_TEST=1`.
- Release files carry a build provenance attestation (`gh attestation verify <file> --repo zxcvbinz/supabase-swap`) besides the SHA-256 checksums.

## FAQ

**Does it work on Linux or Windows?** Not yet. macOS only.

**Is there a captcha or a Chrome window?** No. sbs reuses the browser login of the Supabase CLI in your default browser. The captcha, if any, is part of signing up to Supabase in the browser as usual.

**Can I keep using `supabase login`?** Yes, but it replaces the CLI's active login. Run `sbs use` again to switch back.

**The CLI still uses the wrong account.** Check whether `SUPABASE_ACCESS_TOKEN` is set in your environment; it takes precedence.

**A token was revoked.** Run `sbs add` again for that account, or any command that checks tokens in a terminal; sbs will start the browser login.

## License

[MIT](LICENSE). `sbs` is an independent project and is not affiliated with, endorsed by, or sponsored by Supabase. Supabase is a trademark of its owner.
