#!/usr/bin/env bun
import { parseArgs } from "node:util";
import * as cmd from "./commands";
import { fail, flags, interactive } from "./out";
import { menu } from "./menu";
import { accountsManager } from "./manage";
import { UserError } from "./store";

const HELP = `sbs — più account Supabase per la CLI

  sbs add                 aggiungi un account che hai già (ti fa le domande)
  sbs new                 crea un account per un cliente
  sbs use [alias]         la Supabase CLI usa questo account
  sbs accounts            vedi e gestisci gli account (miei e clienti)
  sbs open [alias]        apri la dashboard già loggata con quell'account

Altri comandi
  sbs list | current | doctor
  sbs run <alias> -- <comando>          un comando con un account, senza cambiare quello attivo
  sbs pin [alias]                       lega la cartella a un account (.supabase-account)
  sbs hook zsh                          cambio automatico entrando nelle cartelle legate
  sbs connect <alias>                   entra con email e password salvate e crea il token
  sbs login <alias>                     token con il supabase login ufficiale
  sbs set <alias> [--email] [--password] [--token-stdin] [--kind mine|client] [--label]
  sbs creds [alias] [--reveal] [--copy password|token|email]
  sbs rename <alias> <nuovo> | remove <alias> | env [alias]
  sbs orgs [create <nome>] | members [slug] | projects [create <nome> --org <slug>]
  sbs open [alias] --team --org <slug> | --project <ref>

Per script e agenti: tutte le domande hanno il loro flag
  (--email, --password-stdin, --token-stdin, --kind, --as, --org), --json per l'output, --yes per le conferme.
`;

async function main() {
  const argv = process.argv.slice(2);
  const dd = argv.indexOf("--");
  const passthrough = dd >= 0 ? argv.slice(dd + 1) : [];
  const { values: o, positionals } = parseArgs({
    args: dd >= 0 ? argv.slice(0, dd) : argv,
    allowPositionals: true,
    strict: false,
    options: Object.fromEntries(
      ["email", "token", "kind", "label", "as", "org", "region", "db-pass", "name", "copy", "project"].map((k) => [k, { type: "string" }]),
    ),
  });
  // `--password` alone asks for it, `--password x` sets it
  const pw = argv.indexOf("--password");
  if (pw >= 0 && argv[pw + 1] && !argv[pw + 1]!.startsWith("--")) {
    o.password = argv[pw + 1];
    positionals.splice(positionals.indexOf(argv[pw + 1]!), 1);
  }
  flags.json = Boolean(o.json) || process.env.SBS_JSON === "1";
  flags.yes = Boolean(o.yes);
  flags.quiet = Boolean(o.quiet);
  const [command, a1, ...rest] = positionals;
  const s = (v: unknown) => (typeof v === "string" ? v : undefined);

  if (o.help || command === "help") return console.log(HELP);
  if (o.version) return console.log("0.1.0");

  switch (command) {
    case undefined:
      if (interactive()) return menu();
      return cmd.cmdList();
    case "list":
    case "ls":
      return cmd.cmdList();
    case "current":
    case "whoami":
      return cmd.cmdCurrent();
    case "use":
    case "switch":
      return cmd.cmdUse(a1, o);
    case "run":
      return cmd.cmdRun(a1, passthrough);
    case "env":
      return cmd.cmdEnv(a1 ?? s(o.as));
    case "pin":
      return cmd.cmdPin(a1, o);
    case "hook":
      return cmd.cmdHook(a1);
    case "add":
      return cmd.cmdAdd(a1, o);
    case "new":
      return cmd.cmdNew(a1, o);
    case "login":
      return cmd.cmdLogin(a1, o);
    case "set":
      return cmd.cmdSet(a1, o);
    case "creds":
      return cmd.cmdCreds(a1 ?? s(o.as), o);
    case "remove":
    case "rm":
      return cmd.cmdRemove(a1, o);
    case "rename":
      return cmd.cmdRename(a1, rest[0]);
    case "accounts":
    case "manage":
      return accountsManager();
    case "doctor":
      return cmd.cmdDoctor();
    case "orgs":
      return cmd.cmdOrgs(a1, rest, o);
    case "members":
      return cmd.cmdMembers(a1, o);
    case "projects":
      return cmd.cmdProjects(a1, rest, o);
    case "connect":
      return cmd.cmdConnect(a1, o);
    case "open":
      return cmd.cmdOpen(a1, o);
    default:
      throw new UserError(`Comando sconosciuto: ${command}`, "unknown_command", "sbs --help");
  }
}

main().catch(fail);
