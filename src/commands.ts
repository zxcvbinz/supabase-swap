import * as p from "@clack/prompts";
import { api, snapshot } from "./api";
import {
  allProjects,
  buildAccount,
  ensureToken,
  refreshStale,
  resolveTarget,
  searchProjects,
  syncAccounts,
  type ProjectHit,
  type Target,
} from "./accounts";
import { browserLogin, loginAs, openUrl } from "./login";
import { clearCliToken, writeCliToken } from "./cli-slot";
import { takeoverCliKeychain } from "./legacy";
import { bold, dim, done, flags, green, info, interactive, isTTY, table, yellow } from "./out";
import {
  assertAlias,
  getAccount,
  getActive,
  listAccounts,
  patchAccount,
  putAccount,
  removeAccount,
  renameAccount,
  requireAccount,
  setActive,
  uniqueAlias,
  UserError,
  type Account,
  type Kind,
} from "./store";
import { DASHBOARD, urls } from "./urls";

export type Opts = Record<string, string | boolean | undefined>;

// ---------- helpers ----------

export function cancelled<T>(v: T): Exclude<T, symbol> {
  if (p.isCancel(v)) throw new UserError("Cancelled.", "cancelled");
  return v as Exclude<T, symbol>;
}

async function confirm(message: string): Promise<boolean> {
  if (flags.yes) return true;
  if (!interactive()) throw new UserError(`Confirmation needed: ${message}`, "confirmation_required", "Repeat with --yes");
  return cancelled(await p.confirm({ message }));
}

function genPassword(len = 24) {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#%^*-_=+"];
  const all = sets.join("");
  const rnd = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0]! % n;
  const chars = sets.map((s) => s[rnd(s.length)]!);
  while (chars.length < len) chars.push(all[rnd(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/** Put text on the clipboard; false if pbcopy is missing or fails. */
function copy(text: string): boolean {
  try {
    return Bun.spawnSync(["pbcopy"], { stdin: Buffer.from(text) }).exitCode === 0;
  } catch {
    return false;
  }
}

function warnEnvOverride() {
  if (process.env.SUPABASE_ACCESS_TOKEN)
    info(yellow("! ") + "SUPABASE_ACCESS_TOKEN is set in this shell: the Supabase CLI will use it instead. Fix: unset SUPABASE_ACCESS_TOKEN");
}

const TOKENS_URL = "https://supabase.com/dashboard/account/tokens";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export async function pickAccount(message: string, initial?: string): Promise<string> {
  const accounts = listAccounts();
  if (!accounts.length) throw new UserError("No accounts yet.", "no_accounts", "Add one with: sbs add");
  return cancelled(
    await p.select({
      message,
      initialValue: initial,
      options: accounts.map((a) => ({ value: a.alias, label: a.alias, hint: a.email })),
    }),
  ) as string;
}

/** Explicit target, else the active account (asking on a terminal). */
async function targetOrActive(query: string | undefined): Promise<Target> {
  if (query) return resolveTarget(query);
  const active = getActive();
  if (interactive()) return { account: requireAccount(await pickAccount("Which account?", active)) };
  if (!active) throw new UserError("No account given and none is active.", "missing_target", "Pass an account or project: sbs <cmd> <name>");
  return { account: requireAccount(active) };
}

const project = (h: ProjectHit) => ({ account: h.account, name: h.name, ref: h.ref, org: h.org_name, region: h.region, status: h.status });

// ---------- listing ----------

export function cmdLs() {
  const active = getActive();
  const rows = listAccounts().map((a) => ({
    alias: a.alias,
    email: a.email,
    kind: a.kind,
    label: a.label,
    active: a.alias === active,
    projects: a.projects.length,
    has_password: Boolean(a.password),
  }));
  done({ active: active ?? null, accounts: rows }, () => {
    if (!rows.length) return console.log("No accounts yet. Add one with: sbs add");
    for (const [title, kind] of [["Mine", "mine"], ["Clients", "client"]] as const) {
      const list = rows.filter((r) => r.kind === kind);
      if (!list.length) continue;
      console.log(bold(title));
      table(
        list.map((r) => ({ " ": r.active ? green("*") : " ", alias: r.alias, email: r.email, projects: r.projects })),
        [" ", "alias", "email", "projects"],
      );
      console.log();
    }
  });
}

export async function cmdProjects(query: string | undefined, o: Opts) {
  const failures = (await refreshStale(Boolean(o.refresh))).filter((r) => !r.ok);
  for (const f of failures) info(yellow("! ") + `${f.alias}: ${f.error} (showing cached projects)`);
  const rows = (query ? searchProjects(query) : allProjects()).map(project);
  done({ projects: rows }, () => (rows.length ? table(rows, ["account", "name", "ref", "org", "region", "status"]) : console.log("No projects.")));
}

export async function cmdFind(query: string | undefined) {
  if (!query) throw new UserError("Missing search text.", "missing_query", "sbs find <name, ref or org>");
  let hits = searchProjects(query);
  if (!hits.length) {
    await syncAccounts(listAccounts().map((a) => a.alias), false); // maybe the project is new
    hits = searchProjects(query);
  }
  if (!hits.length) throw new UserError(`No project matches "${query}".`, "not_found");
  const rows = hits.map(project);
  done({ matches: rows }, () => table(rows, ["account", "name", "ref", "org", "region", "status"]));
}

export async function cmdSync() {
  const results = await syncAccounts(listAccounts().map((a) => a.alias), true);
  const failed = results.filter((r) => !r.ok);
  done({ ok: !failed.length, accounts: results }, () => {
    for (const r of results) console.log(r.ok ? `${green("ok")}  ${r.alias}  ${plural(r.projects!, "project")}` : `${yellow("!!")}  ${r.alias}  ${r.error}`);
  });
  if (failed.length) process.exitCode = 1;
}

// ---------- switching ----------

export async function useAccount(alias: string) {
  const acc = await ensureToken(alias);
  await takeoverCliKeychain(); // only now: a typo or a dead account never touches the Keychain
  writeCliToken(acc.token);
  setActive(alias);
  return acc;
}

export async function cmdUse(query: string | undefined) {
  warnEnvOverride();
  const t = await targetOrActive(query);
  const acc = await useAccount(t.account.alias);
  done({ alias: acc.alias, email: acc.email, project: t.project?.ref ?? null }, () =>
    console.log(`Using ${bold(acc.alias)} (${acc.email})${t.project ? dim(`  project ${t.project.name}`) : ""}`),
  );
}

export async function cmdRun(query: string | undefined, argv: string[]) {
  if (!query || !argv.length) throw new UserError("Usage: sbs run <account|project> -- <command...>", "usage");
  const t = resolveTarget(query);
  // A loose (substring) match must not silently pick an account when nobody can answer for it.
  if (t.loose && (flags.json || !isTTY()) && !flags.yes)
    throw new UserError(`"${query}" only matches ${t.project!.name} (${t.account.alias}) loosely.`, "confirmation_required", "Use the exact alias, ref or name, or repeat with --yes");
  const acc = await ensureToken(t.account.alias);
  process.stderr.write(`sbs: running as ${acc.alias}${t.project ? ` (project ${t.project.name}, ref ${t.project.ref})` : ""}\n`);
  const child = Bun.spawn(argv, { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, SUPABASE_ACCESS_TOKEN: acc.token } });
  process.exit(await child.exited);
}

export async function cmdOpen(query: string | undefined, o: Opts) {
  const t = await targetOrActive(query);
  const acc = t.account;
  let url = DASHBOARD;
  if (o.team) {
    let slugs = [...new Set(acc.projects.map((p) => p.org_slug))];
    if (!slugs.length) slugs = (await api((await ensureToken(acc.alias)).token).orgs()).map((x) => x.slug);
    const slug = t.project?.org_slug ?? slugs[0];
    if (!slug) throw new UserError(`"${acc.alias}" has no organization.`, "no_org");
    url = urls.team(slug);
  } else if (t.project) url = urls.project(t.project.ref);
  openUrl(url);
  done({ alias: acc.alias, url }, () => {
    console.log(`Opened ${url}`);
    console.log(dim(`Your browser uses whichever Supabase account is signed in there (expected: ${acc.email}).`));
  });
}

// ---------- adding accounts ----------

export async function cmdAdd(aliasArg: string | undefined, o: Opts) {
  const wanted = aliasArg ? assertAlias(aliasArg) : undefined;
  const token = await browserLogin(wanted ?? "user");
  const snap = await snapshot(token);
  const email = snap.profile.primary_email;
  const existing = listAccounts().find((a) => a.email.toLowerCase() === email.toLowerCase());
  const now = new Date().toISOString();
  let acc: Account;
  if (existing) {
    acc = patchAccount(existing.alias, { token, projects: snap.projects, projectsSyncedAt: now, tokenCheckedAt: now });
  } else {
    if (wanted && getAccount(wanted)) throw new UserError(`Account "${wanted}" already exists with another email.`, "exists");
    const kind = o.mine ? "mine" : o.client ? "client" : interactive() ? await askKind() : "client";
    const alias = wanted ?? uniqueAlias(snap.orgs[0]?.name ?? email.split("@")[0]!, email);
    acc = buildAccount({ alias, kind, email, userId: snap.profile.gotrue_id, token, projects: snap.projects });
    putAccount(acc);
  }
  done({ alias: acc.alias, email, kind: acc.kind, projects: acc.projects.length, refreshed: Boolean(existing) }, () =>
    console.log(`${existing ? "Refreshed" : "Added"} ${bold(acc.alias)} (${email}) - ${plural(acc.projects.length, "project")}`),
  );
}

async function askKind(): Promise<Kind> {
  return cancelled(
    await p.select({
      message: "Whose account is this?",
      options: [
        { value: "client" as Kind, label: "A client's" },
        { value: "mine" as Kind, label: "Mine" },
      ],
    }),
  ) as Kind;
}

export async function cmdNew(emailArg: string | undefined, aliasArg: string | undefined) {
  let email = emailArg;
  if (!email && interactive())
    email = cancelled(await p.text({ message: "Client email for the new Supabase account", validate: (v) => (v?.includes("@") ? undefined : "Not an email") }));
  if (!email?.includes("@")) throw new UserError("Missing client email.", "missing_email", "sbs new <email> [alias]");
  if (!interactive()) throw new UserError("sbs new needs a terminal.", "needs_terminal", "Run it in a terminal: it waits for the email confirmation.");
  if (listAccounts().some((a) => a.email.toLowerCase() === email!.toLowerCase())) throw new UserError(`${email} is already saved.`, "exists");
  const alias = aliasArg ? assertAlias(aliasArg) : uniqueAlias(email.split("@")[0]!);
  if (getAccount(alias)) throw new UserError(`Account "${alias}" already exists.`, "exists");

  const password = genPassword();
  const copied = copy(password);
  console.log(`Password for ${email}: ${bold(password)}${copied ? "  (copied to the clipboard)" : "  (could not copy it: note it down)"}`);
  console.log(dim("Sign out of your own Supabase account in the browser first, or use a private window."));
  console.log(dim("Sign up with the email and password above, then confirm the email."));
  openUrl(`${DASHBOARD}/sign-up`);
  cancelled(await p.text({ message: "Once the email is confirmed and you are signed in as the new account, press Enter" }));

  const token = await loginAs(alias, email);
  const orgName = cancelled(await p.text({ message: "Organization name", defaultValue: alias, placeholder: alias }));
  const org = await api(token).createOrg(orgName || alias);
  const snap = await snapshot(token);
  putAccount(buildAccount({ alias, kind: "client", email, userId: snap.profile.gotrue_id, token, password, projects: snap.projects }));
  openUrl(urls.team(org.slug));
  done({ status: "created", alias, email, org: org.slug, team_url: urls.team(org.slug) }, () => {
    console.log(`Created ${bold(alias)} (${email}), organization "${org.name}".`);
    console.log(dim("The team page is open: sign back in to your own account there to invite yourself."));
  });
}

// ---------- managing accounts ----------

export function cmdRename(from: string | undefined, to: string | undefined) {
  if (!from || !to) throw new UserError("Usage: sbs rename <alias> <new>", "usage");
  requireAccount(from);
  assertAlias(to);
  if (getAccount(to)) throw new UserError(`Account "${to}" already exists.`, "exists");
  renameAccount(from, to);
  done({ from, to }, () => console.log(`Renamed ${from} -> ${to}`));
}

export async function cmdRm(alias: string | undefined) {
  if (!alias) throw new UserError("Usage: sbs rm <alias>", "usage");
  const acc = requireAccount(alias);
  if (!(await confirm(`Remove "${alias}" from sbs? (its token stays valid on Supabase)`))) throw new UserError("Cancelled.", "cancelled");
  removeAccount(alias);
  // The CLI would otherwise keep acting as the removed account.
  const cleared = clearCliToken(acc.token);
  done({ removed: alias, cli_token_removed: cleared, token_revoked: false, revoke_at: TOKENS_URL }, () => {
    console.log(`Removed ${alias}.${cleared ? " The Supabase CLI token file held this account's token, so it was removed too." : ""}`);
    console.log(dim(`The token is still valid on Supabase. Revoke it at ${TOKENS_URL}`));
  });
}

export function cmdKind(alias: string, kind: Kind) {
  patchAccount(alias, { kind });
  done({ alias, kind }, () => console.log(`${alias} is now ${kind === "mine" ? "mine" : "a client"}.`));
}

export function cmdCreds(alias: string | undefined, o: Opts) {
  if (!alias) throw new UserError("Usage: sbs creds <alias> [--copy]", "usage");
  const acc = requireAccount(alias);
  if (!acc.password) throw new UserError(`No saved password for "${alias}".`, "no_password", "Only accounts created with sbs new have one.");
  // The password is shown only to a person at a terminal; pipes, logs and agents (--json) get --copy or nothing.
  const show = Boolean(process.stdout.isTTY) && !flags.json;
  if (!o.copy && !show)
    throw new UserError("Refusing to print the password here (not a terminal, or --json).", "password_hidden", "Use: sbs creds <alias> --copy");
  const copied = Boolean(o.copy) && copy(acc.password);
  if (o.copy && !copied) throw new UserError("Could not copy to the clipboard (pbcopy failed).", "copy_failed", show ? "Run without --copy to show it." : "Run it in a terminal without --json to show it.");
  // --json never prints the password: agents must not read it
  done({ alias, email: acc.email, copied }, () => {
    console.log(`${acc.email}`);
    if (copied) console.log("Password copied to the clipboard.");
    else console.log(`Password: ${acc.password}`);
  });
}
