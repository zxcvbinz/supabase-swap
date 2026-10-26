# supabase-swap (`sbs`) — guida per agenti

`sbs` gestisce più account Supabase per la Supabase CLI. Usalo sempre con `--json`: ogni comando stampa un solo oggetto JSON su stdout (`{"ok": true, ...}` oppure `{"ok": false, "error", "code", "hint"}`), exit code 0 se va bene, 1 per errori dell'utente.

## Regole
- **Non cambiare l'account globale se non serve.** Per lanciare la Supabase CLI con un account usa `sbs run <alias> -- supabase <comando>`: il token passa solo a quel comando.
- Senza `--as`, i comandi usano l'account del file `.supabase-account` più vicino (cartella corrente o sopra), altrimenti quello attivo. Controlla con `sbs current --json`.
- Le azioni che costano o non si annullano (creare progetti, annullare inviti, togliere account) chiedono `--yes`. Senza, ricevi `code: "confirmation_required"`: chiedi all'utente prima di ripetere con `--yes`.
- Non stampare segreti in chiaro. `sbs creds <alias> --reveal` solo se l'utente lo chiede.
- Registrazione e accesso alla dashboard passano da una finestra di Chrome sullo schermo dell'utente, perché Supabase chiede un captcha che risolve lui. `sbs new <alias> --email <email> --json` registra l'account, salva le credenziali e restituisce `status: "pending_confirmation"`: l'utente conferma la mail, poi `sbs connect <alias> --json` entra e crea il token da solo. Avvisa l'utente prima di lanciarli.
- Gli inviti non sono automatici: `sbs open <alias> --team --org <slug>` apre la pagina Team già loggata con quell'account.

## Comandi
| Scopo | Comando |
|---|---|
| Account salvati | `sbs list --json` |
| Account in uso | `sbs current --json` |
| Comando con un account | `sbs run <alias> -- supabase projects list` |
| Cambia account globale | `sbs use <alias> --json` |
| Aggiungi account esistente | `printf %s "$TOKEN" \| sbs add <alias> --email <email> --token-stdin --json` |
| Salva/aggiorna password | `printf %s "$PW" \| sbs set <alias> --password-stdin --json` |
| Organizzazioni | `sbs orgs --as <alias> --json` · `sbs orgs create "<nome>" --as <alias> --json` |
| Membri e inviti in attesa | `sbs members <slug> --as <alias> --json` |
| Progetti | `sbs projects --as <alias> [--org <slug>] --json` |
| Crea progetto | `sbs projects create "<nome>" --org <slug> --region eu-central-1 --as <alias> --yes --json` (la password del DB viene salvata) |
| Nuovo account cliente | `sbs new <alias> --email <email> --json` poi, dopo la conferma della mail, `sbs connect <alias> --json` |
| Collega il token dal browser (con la password salvata entra da solo, senza password entra l'utente) | `sbs connect <alias> --json` |
| Apri la dashboard come quell'account | `sbs open <alias> [--team --org <slug> \| --project <ref>] --json` |
| Rinomina / togli da sbs | `sbs rename <alias> <nuovo> --json` · `sbs remove <alias> --yes --json` |
| Stato dei token | `sbs doctor --json` |

## Codici di errore utili
`unknown_account`, `missing_token` (serve `sbs login <alias>` dall'utente), `email_mismatch` (token di un altro account), `token_rejected`, `ambiguous_org` (aggiungi `--org`), `confirmation_required`, `email_not_confirmed`, `bad_credentials`, `already_registered`, `browser_busy` (finestra di Chrome di quell'account già aperta), `cancelled` (l'utente ha annullato).

`sbs list --json` divide gli account con `kind`: `mine` (account dell'utente) o `client`.
