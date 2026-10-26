# supabase-swap (`sbs`)

Più account Supabase sulla stessa Supabase CLI: i tuoi e quelli dei clienti.

```sh
bun install
bun run install-bin      # compila e installa ~/.local/bin/sbs
```

## Uso

```sh
sbs add          # aggiungi un account che hai già: domande, poi Chrome per il token
sbs new          # crea un account per un cliente su Supabase
sbs use rossi    # la Supabase CLI ora usa "rossi"
sbs accounts     # vedi e gestisci gli account (miei e clienti)
sbs open rossi   # dashboard già loggata con quell'account (--team --org <slug> per invitare)
```

- `sbs run rossi -- supabase db push` usa un account solo per quel comando.
- `sbs pin rossi` lega la cartella a un account (file `.supabase-account`, senza segreti); con `eval "$(sbs hook zsh)"` nel `~/.zshrc` il cambio è automatico.
- `sbs --help` per tutti i comandi, `AGENTS.md` per l'uso da agenti (`--json`).

## Dove stanno i dati

- Elenco account (senza segreti): `~/.config/supabase-swap/accounts.json`
- Email, password, token e password dei database: Portachiavi macOS, servizio `supabase-swap`
- Un profilo Chrome per account: `~/.config/supabase-swap/browser/<alias>`
- Il token attivo della Supabase CLI: Portachiavi, servizio `Supabase CLI`, voce `supabase`. Prima di sovrascrivere un token sconosciuto `sbs` ne fa un backup.

Registrazione e accesso alla dashboard hanno un captcha: si risolve nella finestra di Chrome che `sbs` apre.
