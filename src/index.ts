#!/usr/bin/env bun
import { parseArgs } from "node:util";
import * as cmd from "./commands";
import { VERSION } from "./env";
import { fail, flags, interactive } from "./out";
import { menu } from "./menu";
import { migrateOldFormat } from "./legacy";
import { UserError } from "./store";

const HELP = `sbs - switch between Supabase accounts

  sbs                          interactive screen (accounts and actions)
  sbs add [alias]              sign in via your browser, save the account  [--mine|--client]
  sbs new <email> [alias]      create a Supabase account for a client
  sbs use <account|project>    point the Supabase CLI at that account
  sbs run <account|project> -- <cmd...>
                               run a command as that account only
  sbs ls                       accounts and project counts
  sbs projects [text]          all projects, with their account  [--refresh]
  sbs find <text>              which account owns a project
  sbs open [account|project]   dashboard in your browser  [--team]
  sbs sync                     check tokens, refresh the project list
  sbs rename <alias> <new>
  sbs rm <alias>               forget an account (changes nothing on Supabase)
  sbs creds <alias> [--copy]   password of an account made with 'new'
  sbs mcp                      MCP server for agents (stdio)

Flags: --json (machine output)  --yes (skip confirmations)  --help  --version
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
      ["json", "yes", "help", "version", "mine", "client", "team", "refresh", "copy"].map((k) => [k, { type: "boolean" as const }]),
    ),
  });
  flags.json = Boolean(o.json) || process.env.SBS_JSON === "1";
  flags.yes = Boolean(o.yes);
  const [command, a1, a2] = positionals;

  if (o.version) return console.log(VERSION);
  if (o.help || command === "help") return console.log(HELP);
  if (command === "mcp") return (await import("./mcp")).runMcp();

  await migrateOldFormat();

  switch (command) {
    case undefined:
      return interactive() ? menu() : cmd.cmdLs();
    case "ls":
    case "list":
      return cmd.cmdLs();
    case "add":
      return cmd.cmdAdd(a1, o);
    case "new":
      return cmd.cmdNew(a1, a2);
    case "use":
      return cmd.cmdUse(a1);
    case "run":
      return cmd.cmdRun(a1, passthrough);
    case "projects":
      return cmd.cmdProjects(a1, o);
    case "find":
      return cmd.cmdFind(a1);
    case "open":
      return cmd.cmdOpen(a1, o);
    case "sync":
      return cmd.cmdSync();
    case "rename":
      return cmd.cmdRename(a1, a2);
    case "rm":
      return cmd.cmdRm(a1);
    case "creds":
      return cmd.cmdCreds(a1, o);
    default:
      throw new UserError(`Unknown command: ${command}`, "unknown_command", "Try: sbs --help");
  }
}

main().catch(fail);
