import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { ApiError, v1, type Org, type Profile } from "./api";
import { urls } from "./urls";
import { backupCliToken, readCliToken, writeCliToken } from "./cli-slot";
import { bold, cyan, dim, done, flags, green, info, interactive, mask, table, yellow } from "./out";
import {
  ALIAS_RE,
  assertAlias,
  clearSecrets,
  findAliasByToken,
  getAccount,
  getActive,
  getSecrets,
  listAccounts,
  removeAccount,
  renameAccount,
  requireAccount,
  setActive,
  updateSecrets,
  upsertAccount,
  UserError,
  type Kind,
} from "./store";

export const PIN_FILE = ".supabase-account";
const TOKEN_RE = /^sbp_(oauth_|v0_)?[a-f0-9]{40}$/; // same check as the Supabase CLI

export type Opts = Record<string, string | boolean | undefined>;
const str = (v: unknown) => (typeof v === "string" && v.length ? v : undefined);

// ---------- helpers ----------

function cancelled<T>(v: T): Exclude<T, symbol> {
  if (p.isCancel(v)) throw new UserError("Annullato.", "cancelled");
  return v as Exclude<T, symbol>;
}

async function confirm(message: string): Promise<boolean> {
  if (flags.yes) return true;
  if (!interactive())
    throw new UserError(`Serve una conferma: ${message}`, "confirmation_required", "Ripeti il comando con --yes");
  return cancelled(await p.confirm({ message }));
}

async function readStdin(): Promise<string> {
  return (await new Response(Bun.stdin.stream()).text()).trim();
}

export function findPin(from = process.cwd()): { alias: string; file: string } | undefined {
  let dir = resolve(from);
  while (true) {
    const file = join(dir, PIN_FILE);
    if (existsSync(file)) {
      const alias = readFileSync(file, "utf8").trim().split(/\s/)[0];
      if (alias) return { alias, file };
    }
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** Explicit alias > .supabase-account in the folder > active account. */
export function resolveAlias(explicit?: string): string {
  const alias = explicit ?? findPin()?.alias ?? getActive();
  if (!alias)
    throw new UserError("Nessun account selezionato.", "no_account", "Indica --as <alias>, oppure: sbs use <alias>");
  requireAccount(alias);
  return alias;
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

function copy(text: string) {
  Bun.spawnSync(["pbcopy"], { stdin: Buffer.from(text) });
}

function open(url: string) {
  Bun.spawnSync(["open", url]);
}

function warnEnvOverride() {
  if (process.env.SUPABASE_ACCESS_TOKEN)
    info(yellow("! ") + "In questo terminale è impostata SUPABASE_ACCESS_TOKEN: la Supabase CLI userà quella. Toglila con: unset SUPABASE_ACCESS_TOKEN");
}

/** Validate a token, check it matches the account email, then store it. */
async function attachToken(alias: string, token: string) {
  if (!TOKEN_RE.test(token))
    throw new UserError("Il token non ha il formato giusto (sbp_ seguito da 40 caratteri).", "invalid_token");
  updateSecrets(alias, { token });
  let profile;
  try {
    profile = await v1(alias).profile();
  } catch (e) {
    clearSecrets(alias, "token");
    throw e instanceof ApiError && e.status === 401 ? new UserError("Supabase ha rifiutato il token.", "token_rejected") : e;
  }
  const acc = requireAccount(alias);
  if (acc.email && profile.primary_email.toLowerCase() !== acc.email.toLowerCase()) {
    clearSecrets(alias, "token");
    throw new UserError(
      `Il token è dell'account ${profile.primary_email}, non di ${acc.email}.`,
      "email_mismatch",
      "Probabilmente nel browser eri loggato con un altro account. Esci dalla dashboard (o usa una finestra privata) e riprova.",
    );
  }
  upsertAccount(alias, { email: acc.email ?? profile.primary_email, userId: profile.gotrue_id });
  return profile;
}

/** Undo a half-created account: registry entry, keychain item and browser profile. */
async function discardAccount(alias: string) {
  removeAccount(alias);
  const { profileDir } = await import("./browser");
  (await import("node:fs")).rmSync(profileDir(alias), { recursive: true, force: true });
}

// ---------- accounts ----------

export async function cmdList() {
  const active = getActive();
  const pin = findPin();
  const rows = listAccounts().map((a) => {
    const s = getSecrets(a.alias);
    return {
      alias: a.alias,
      email: a.email ?? "",
      label: a.label ?? "",
      kind: a.kind,
      active: a.alias === active,
      pinned_here: a.alias === pin?.alias,
      has_token: Boolean(s.token),
      has_password: Boolean(s.password),
    };
  });
  done({ active: active ?? null, pinned_here: pin?.alias ?? null, accounts: rows }, () => {
    if (!rows.length) return console.log("Nessun account. Aggiungine uno con: sbs add <alias>  oppure crea un cliente con: sbs new <alias>");
    const groups: [string, typeof rows][] = [
      ["I miei account", rows.filter((r) => r.kind === "mine")],
      ["Clienti", rows.filter((r) => r.kind !== "mine")],
    ];
    for (const [title, list] of groups) {
      if (!list.length) continue;
      console.log(bold(title));
      table(
        list.map((r) => ({
          " ": r.active ? green("●") : r.pinned_here ? cyan("◆") : " ",
          alias: r.alias,
          email: r.email,
          token: r.has_token ? "sì" : yellow("manca"),
          password: r.has_password ? "sì" : dim("no"),
          nota: r.label,
        })),
        [" ", "alias", "email", "token", "password", "nota"],
      );
      console.log();
    }
    if (pin && pin.alias !== active) console.log(dim(`◆ questa cartella usa "${pin.alias}" (${pin.file})`));
  });
}

export async function cmdAdd(aliasArg: string | undefined, o: Opts) {
  let alias = str(aliasArg);
  let kind = str(o.kind) as Kind | undefined;
  let email = str(o.email);
  let password = str(o.password);
  let token = str(o.token);
  if (o["password-stdin"]) password = await readStdin();
  else if (o["token-stdin"]) token = await readStdin();

  if (interactive()) {
    kind ??= cancelled(
      await p.select({
        message: "Di chi è l'account?",
        options: [
          { value: "client" as Kind, label: "Di un cliente" },
          { value: "mine" as Kind, label: "Mio" },
        ],
      }),
    );
    alias ??= cancelled(
      await p.text({ message: "Nome breve (alias)", placeholder: "cliente-rossi", validate: (v) => (v && ALIAS_RE.test(v) ? undefined : "minuscole, numeri, . _ -") }),
    );
  }
  alias = assertAlias(alias);
  if (getAccount(alias)) throw new UserError(`L'account "${alias}" esiste già.`, "exists", `Per modificarlo: sbs accounts  (oppure sbs set ${alias} ...)`);

  if (interactive()) {
    email ??= cancelled(await p.text({ message: "Email dell'account Supabase", validate: (v) => (v?.includes("@") ? undefined : "email non valida") }));
    if (!password && !token) password = cancelled(await p.password({ message: "Password  (invio se entri con GitHub o SSO: entrerai tu nel browser)" })) || undefined;
  }

  upsertAccount(alias, { email, label: str(o.label), kind: kind ?? "client" });
  updateSecrets(alias, { email, password });

  // Guided add is all-or-nothing: the account stays only if its token got linked.
  let profile: Profile | undefined;
  try {
    if (token) profile = await attachToken(alias, token);
    else if (interactive()) profile = (await cmdConnect(alias, { silent: true })).profile;
  } catch (e) {
    await discardAccount(alias);
    if (e instanceof UserError) e.hint = [e.hint, "Account non salvato: niente è cambiato."].filter(Boolean).join("\n  ");
    throw e;
  }

  const linked = Boolean(getSecrets(alias).token);
  done({ alias, kind: kind ?? "client", email: requireAccount(alias).email ?? null, token: linked, user_id: profile?.gotrue_id ?? null }, () => {
    console.log(green("✓ ") + `Account ${bold(alias)} salvato${profile ? ` e collegato (${profile.primary_email})` : ""}.`);
    if (!linked) console.log(dim(`  Per collegarlo: ${password ? `sbs connect ${alias}` : `sbs set ${alias} --token-stdin`}`)); // non-interactive only
  });
}

export async function cmdSet(aliasArg: string | undefined, o: Opts) {
  const alias = assertAlias(aliasArg);
  requireAccount(alias);
  let password = str(o.password);
  let token = str(o.token);
  if (o["password-stdin"]) password = await readStdin();
  else if (o["token-stdin"]) token = await readStdin();
  if (interactive() && o.password === true) password = cancelled(await p.password({ message: "Nuova password" }));

  upsertAccount(alias, { email: str(o.email), label: str(o.label), kind: str(o.kind) as Kind | undefined });
  updateSecrets(alias, { email: str(o.email), password });
  const profile = token ? await attachToken(alias, token) : undefined;
  done({ alias, updated: true, user_id: profile?.gotrue_id ?? null }, () => console.log(green("✓ ") + `Account ${bold(alias)} aggiornato.`));
}

export async function cmdCreds(aliasArg: string | undefined, o: Opts) {
  const alias = resolveAlias(str(aliasArg));
  const acc = requireAccount(alias);
  const s = getSecrets(alias);
  const reveal = Boolean(o.reveal);
  if (str(o.copy)) {
    const what = o.copy as "password" | "token" | "email";
    const v = what === "email" ? acc.email : s[what];
    if (!v) throw new UserError(`Nessun valore "${what}" per ${alias}.`, "missing_value");
    copy(v);
    return done({ alias, copied: what }, () => console.log(green("✓ ") + `${what} di ${alias} copiato negli appunti.`));
  }
  const out = {
    alias,
    email: acc.email ?? null,
    password: s.password ? (reveal ? s.password : mask(s.password)) : null,
    token: s.token ? (reveal ? s.token : mask(s.token)) : null,
    db_passwords: reveal ? (s.dbPasswords ?? {}) : Object.keys(s.dbPasswords ?? {}),
  };
  done(out, () => {
    console.log(`${bold(alias)}  ${dim(acc.kind === "mine" ? "mio" : "cliente")}${acc.label ? "  " + acc.label : ""}`);
    console.log(`  email     ${out.email ?? dim("—")}`);
    console.log(`  password  ${out.password ?? dim("—")}`);
    console.log(`  token     ${out.token ?? dim("—")}`);
    const db = s.dbPasswords ?? {};
    for (const ref of Object.keys(db)) console.log(`  db ${ref}  ${reveal ? db[ref] : mask(db[ref])}`);
    if (!reveal) console.log(dim("  --reveal per vedere in chiaro, --copy password per copiarla"));
  });
}

export async function cmdRemove(aliasArg: string | undefined, o: Opts = {}) {
  const alias = assertAlias(aliasArg);
  requireAccount(alias);
  if (!o.yes && !(await confirm(`Togliere "${alias}" da supabase-swap? (l'account su Supabase resta com'è)`))) return;
  removeAccount(alias);
  done({ alias, removed: true }, () => console.log(green("✓ ") + `${alias} tolto da supabase-swap.`));
}

/** Run the official `supabase login` and capture the token it writes. */
export async function cmdLogin(aliasArg: string | undefined, o: Opts & { silent?: boolean } = {}) {
  const alias = assertAlias(aliasArg);
  const acc = requireAccount(alias);
  if (!process.stdin.isTTY)
    throw new UserError("Il login nel browser serve un terminale interattivo.", "needs_tty", `Da agente: sbs set ${alias} --token-stdin`);

  const prev = readCliToken();
  if (prev && !findAliasByToken(prev)) backupCliToken(prev);

  info(`\nLogin per ${bold(alias)}${acc.email ? ` (${acc.email})` : ""}.`);
  info(dim("Nel browser deve essere aperta la dashboard con QUESTO account. Se sei loggato con un altro, usa una finestra privata: incolla lì il link che appare.\n"));

  const env = { ...process.env };
  delete env.SUPABASE_ACCESS_TOKEN;
  const args = ["supabase", "login", "--name", `supabase-swap ${alias} ${new Date().toISOString().slice(0, 10)}`];
  if (o["no-browser"]) args.push("--no-browser");
  const r = Bun.spawnSync(args, { stdio: ["inherit", "inherit", "inherit"], env });
  const token = readCliToken();
  if (r.exitCode !== 0 || !token || token === prev) {
    if (prev) writeCliToken(prev);
    throw new UserError("Login non completato.", "login_failed");
  }
  let profile;
  try {
    profile = await attachToken(alias, token);
  } catch (e) {
    if (prev) writeCliToken(prev);
    throw e;
  }
  setActive(alias);
  if (!o.silent)
    done({ alias, email: profile.primary_email, active: true }, () =>
      console.log(green("✓ ") + `${bold(alias)} collegato (${profile.primary_email}) ed è l'account attivo.`),
    );
  return { profile };
}

export async function cmdRename(from: string | undefined, to: string | undefined) {
  const a = assertAlias(from);
  const b = assertAlias(to);
  renameAccount(a, b);
  done({ from: a, to: b }, () => console.log(green("✓ ") + `${a} ora si chiama ${bold(b)}.`));
}

// ---------- switching ----------

export async function cmdUse(aliasArg: string | undefined, o: Opts): Promise<void> {
  let alias = str(aliasArg);
  if (o.auto || !alias) {
    const pin = findPin();
    if (!pin) {
      if (o.auto) return done({ changed: false });
      if (interactive()) return cmdPick();
      throw new UserError("Manca l'alias.", "missing_alias", "sbs use <alias>");
    }
    alias = pin.alias;
    if (o.auto && getActive() === alias && readCliToken() === getSecrets(alias).token) return done({ changed: false, active: alias });
  }
  alias = assertAlias(alias);
  requireAccount(alias);
  const prev = readCliToken();
  if (prev && !findAliasByToken(prev)) backupCliToken(prev);
  const token = (await import("./api")).tokenOf(alias);
  writeCliToken(token);
  setActive(alias);
  warnEnvOverride();
  const acc = requireAccount(alias);
  done({ active: alias, email: acc.email ?? null, changed: true }, () =>
    console.log(green("✓ ") + `Supabase CLI ora usa ${bold(alias)}${acc.email ? dim(" · " + acc.email) : ""}`),
  );
}

async function cmdPick(): Promise<void> {
  const accs = listAccounts();
  if (!accs.length) throw new UserError("Nessun account.", "no_accounts", "sbs add <alias>");
  const active = getActive();
  const alias = cancelled(
    await p.select({
      message: "Quale account usa la Supabase CLI?",
      initialValue: active,
      options: accs.map((a) => ({ value: a.alias, label: a.alias, hint: [a.email, a.alias === active ? "attivo" : ""].filter(Boolean).join(" · ") })),
    }),
  );
  return cmdUse(alias, {});
}

export async function cmdCurrent() {
  const cli = readCliToken();
  const alias = cli ? findAliasByToken(cli) : undefined;
  const pin = findPin();
  const envAlias = process.env.SUPABASE_ACCESS_TOKEN ? findAliasByToken(process.env.SUPABASE_ACCESS_TOKEN) : undefined;
  const effective = process.env.SUPABASE_ACCESS_TOKEN ? (envAlias ?? "env-sconosciuto") : (alias ?? (cli ? "sconosciuto" : null));
  const acc = alias ? getAccount(alias) : undefined;
  done(
    { cli_account: alias ?? (cli ? "unknown" : null), env_account: envAlias ?? (process.env.SUPABASE_ACCESS_TOKEN ? "unknown" : null), effective, email: acc?.email ?? null, pinned_here: pin?.alias ?? null },
    () => {
      if (!cli && !process.env.SUPABASE_ACCESS_TOKEN) return console.log("La Supabase CLI non è loggata. " + dim("sbs use <alias>"));
      console.log(`${bold(effective ?? "")}${acc?.email ? dim(" · " + acc.email) : ""}`);
      if (cli && !alias) console.log(yellow("! ") + "La CLI usa un token che supabase-swap non conosce. " + dim("sbs add <alias> --token-stdin per registrarlo"));
      if (process.env.SUPABASE_ACCESS_TOKEN) console.log(dim("(da SUPABASE_ACCESS_TOKEN in questo terminale)"));
      if (pin && pin.alias !== effective) console.log(yellow("! ") + `Questa cartella è legata a "${pin.alias}". ${dim("sbs use")}`);
    },
  );
}

export async function cmdPin(aliasArg: string | undefined, o: Opts) {
  const file = join(process.cwd(), PIN_FILE);
  if (o.remove) {
    if (existsSync(file)) (await import("node:fs")).unlinkSync(file);
    return done({ pinned: null }, () => console.log(green("✓ ") + "Questa cartella non è più legata a un account."));
  }
  const alias = assertAlias(str(aliasArg) ?? getActive());
  requireAccount(alias);
  writeFileSync(file, alias + "\n");
  done({ pinned: alias, file }, () => {
    console.log(green("✓ ") + `Questa cartella usa ${bold(alias)} (${PIN_FILE}).`);
    console.log(dim("  Il file non contiene segreti: puoi committarlo. Per il cambio automatico: eval \"$(sbs hook zsh)\" nel ~/.zshrc"));
  });
}

export async function cmdRun(aliasArg: string | undefined, cmd: string[]) {
  if (!cmd.length) throw new UserError("Manca il comando.", "missing_command", "sbs run <alias> -- supabase projects list");
  const alias = resolveAlias(aliasArg);
  const token = (await import("./api")).tokenOf(alias);
  const r = Bun.spawnSync(cmd, { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, SUPABASE_ACCESS_TOKEN: token } });
  process.exit(r.exitCode ?? 1);
}

export async function cmdEnv(aliasArg: string | undefined) {
  const alias = resolveAlias(aliasArg);
  const token = (await import("./api")).tokenOf(alias);
  if (flags.json) return done({ alias, SUPABASE_ACCESS_TOKEN: token });
  console.log(`export SUPABASE_ACCESS_TOKEN=${token}`);
}

export function cmdHook(shell = "zsh") {
  if (shell !== "zsh" && shell !== "bash") throw new UserError("Shell supportate: zsh, bash", "bad_shell");
  const fn = `_sbs_auto() { command sbs use --auto --quiet >/dev/null 2>&1; }`;
  console.log(
    shell === "zsh"
      ? `${fn}\nautoload -U add-zsh-hook\nadd-zsh-hook chpwd _sbs_auto\n_sbs_auto`
      : `${fn}\ncd() { builtin cd "$@" && _sbs_auto; }\n_sbs_auto`,
  );
}

// ---------- create a client account ----------

export async function cmdNew(aliasArg: string | undefined, o: Opts) {
  let alias = str(aliasArg);
  let email = str(o.email);
  if (interactive()) {
    alias ??= cancelled(await p.text({ message: "Alias del nuovo account", placeholder: "cliente-rossi", validate: (v) => (v && ALIAS_RE.test(v) ? undefined : "minuscole, numeri, . _ -") }));
    email ??= cancelled(await p.text({ message: "Email del cliente per l'account Supabase", validate: (v) => (v?.includes("@") ? undefined : "email non valida") }));
  }
  alias = assertAlias(alias);
  if (!email) throw new UserError("Manca l'email.", "missing_email", `sbs new ${alias} --email cliente@example.com`);
  const existing = getAccount(alias);
  if (existing && existing.email?.toLowerCase() !== email.toLowerCase())
    throw new UserError(`L'alias "${alias}" è già usato per ${existing.email}.`, "exists", "Scegli un altro alias");

  // Credentials are saved before anything else, so nothing is lost if a later step fails.
  const password = getSecrets(alias).password ?? genPassword();
  upsertAccount(alias, { email, label: str(o.label), kind: "client" });
  updateSecrets(alias, { email, password });

  info(`Apro Chrome e registro ${bold(email)} su Supabase. ${dim("Se compare un captcha, risolvilo nella finestra.")}`);
  const { launch, signUp } = await import("./browser");
  try {
    const { ctx, page } = await launch(alias);
    try {
      await signUp(page, email, password);
    } finally {
      await ctx.close();
    }
  } catch (e) {
    if (!existing) await discardAccount(alias);
    throw e;
  }
  info(green("✓ ") + `Registrazione inviata. Credenziali salvate in sbs (password: sbs creds ${alias} --copy password).`);

  if (!interactive())
    return done({ alias, email, status: "pending_confirmation", credentials_saved: true, next: `sbs connect ${alias}` }, () =>
      console.log(`Conferma la mail arrivata a ${email}, poi: sbs connect ${alias}`),
    );

  cancelled(await p.confirm({ message: `Conferma la mail arrivata a ${email}. Fatto?` }));
  await cmdConnect(alias, { ...o, silent: true });

  let org: Org | undefined;
  const orgs = await v1(alias).orgs();
  const orgName = str(o.org) ?? (orgs.length ? undefined : cancelled(await p.text({ message: "Nome dell'organizzazione", initialValue: str(o.label) ?? alias })));
  if (orgName) {
    org = await v1(alias).createOrg(orgName);
    info(green("✓ ") + `Organizzazione ${bold(org.name)} creata (${org.slug}).`);
  } else org = orgs[0];

  if (org) {
    const { openDetached } = await import("./browser");
    openDetached(alias, urls.team(org.slug));
  }
  done({ alias, email, org: org ?? null }, () => {
    console.log(green("✓ ") + `Account ${bold(alias)} pronto e attivo nella Supabase CLI.`);
    if (org) console.log(`  Ti ho aperto la pagina Team di ${org.name}: invitati da lì.`);
  });
}

/** Sign in on the dashboard (saved password, or by hand) and create a token for the CLI. */
export async function cmdConnect(aliasArg: string | undefined, o: Opts & { silent?: boolean } = {}) {
  const alias = resolveAlias(str(aliasArg));
  const acc = requireAccount(alias);
  const s = getSecrets(alias);

  info(
    s.password && acc.email
      ? `Entro nella dashboard come ${bold(acc.email)}. ${dim("Se compare un captcha o il codice MFA, completali nella finestra.")}`
      : `Apro Chrome: entra con ${bold(acc.email ?? "l'account")} (GitHub, SSO o password). ${dim("Al resto penso io.")}`,
  );
  const { launch, signIn, createAccessToken } = await import("./browser");
  const { ctx, page } = await launch(alias);
  let token: string;
  try {
    const email = await signIn(page, acc.email, acc.email ? s.password : undefined);
    if (!acc.email) upsertAccount(alias, { email });
    token = await createAccessToken(page, `supabase-swap ${alias} ${new Date().toISOString().slice(0, 10)}`);
  } finally {
    await ctx.close();
  }
  const profile = await attachToken(alias, token);

  const prev = readCliToken();
  if (prev && !findAliasByToken(prev)) backupCliToken(prev);
  writeCliToken(token);
  setActive(alias);
  if (!o.silent)
    done({ alias, email: profile.primary_email, token: true, active: true }, () =>
      console.log(green("✓ ") + `${bold(alias)} collegato: token creato, ed è l'account attivo nella Supabase CLI.`),
    );
  return { profile };
}

/** Open the dashboard in Chrome, logged in as this account (its own browser profile). */
export async function cmdOpen(aliasArg: string | undefined, o: Opts) {
  const alias = resolveAlias(str(aliasArg) ?? str(o.as));
  const { openDetached } = await import("./browser");
  let url = urls.dashboard;
  if (o.team || str(o.org)) {
    const slug = await pickOrg(alias, str(o.org));
    url = o.team ? urls.team(slug) : urls.org(slug);
  } else if (str(o.project)) url = urls.project(str(o.project)!);
  openDetached(alias, url);
  done({ alias, url }, () => {
    console.log(green("✓ ") + `Aperta la dashboard di ${bold(alias)}: ${dim(url)}`);
    if (getSecrets(alias).password) console.log(dim(`  Se chiede di entrare: sbs creds ${alias} --copy password`));
  });
}

// ---------- organizations, members, projects ----------

export async function cmdOrgs(sub: string | undefined, rest: string[], o: Opts) {
  const alias = resolveAlias(str(o.as));
  if (sub === "create") {
    const name = rest.join(" ") || (interactive() ? cancelled(await p.text({ message: "Nome dell'organizzazione" })) : "");
    if (!name) throw new UserError("Manca il nome.", "missing_name", "sbs orgs create <nome>");
    const org = await v1(alias).createOrg(name);
    return done({ alias, org }, () => console.log(green("✓ ") + `Organizzazione ${bold(org.name)} creata · ${org.slug}`));
  }
  const orgs = await v1(alias).orgs();
  done({ alias, orgs }, () => {
    if (!orgs.length) return console.log(`Nessuna organizzazione per ${alias}. ${dim("sbs orgs create <nome>")}`);
    table(orgs.map((x) => ({ slug: x.slug, nome: x.name })), ["slug", "nome"]);
  });
}

async function pickOrg(alias: string, slug?: string): Promise<string> {
  if (slug) return slug;
  const orgs = await v1(alias).orgs();
  if (orgs.length === 1) return orgs[0]!.slug;
  if (!orgs.length) throw new UserError(`${alias} non ha organizzazioni.`, "no_orgs", "sbs orgs create <nome>");
  if (!interactive())
    throw new UserError("Più organizzazioni: indica quale.", "ambiguous_org", "--org " + orgs.map((x) => x.slug).join(" | --org "));
  return cancelled(await p.select({ message: "Organizzazione", options: orgs.map((x) => ({ value: x.slug, label: x.name, hint: x.slug })) }));
}

export async function cmdMembers(slugArg: string | undefined, o: Opts) {
  const alias = resolveAlias(str(o.as));
  const slug = await pickOrg(alias, str(slugArg) ?? str(o.org));
  const members = await v1(alias).members(slug);
  done({ alias, org: slug, members, team_url: urls.team(slug) }, () => {
    table(members.map((m) => ({ email: m.email, ruolo: m.role_name, mfa: m.mfa_enabled ? "sì" : "no" })), ["email", "ruolo", "mfa"]);
    console.log(dim(`\nPer invitare qualcuno: sbs open ${alias} --team --org ${slug}`));
  });
}

export async function cmdProjects(sub: string | undefined, rest: string[], o: Opts) {
  const alias = resolveAlias(str(o.as));
  if (sub === "create") {
    const name = rest.join(" ") || str(o.name);
    if (!name) throw new UserError("Manca il nome del progetto.", "missing_name", "sbs projects create <nome> --org <slug>");
    const slug = await pickOrg(alias, str(o.org));
    const region = str(o.region) ?? "eu-central-1";
    const db_pass = str(o["db-pass"]) ?? genPassword(28).replace(/[^A-Za-z0-9]/g, "x");
    if (!(await confirm(`Creare il progetto "${name}" in ${slug} (${region})? Può avere un costo se l'organizzazione è a pagamento.`))) return;
    const proj = await v1(alias).createProject({ name, organization_slug: slug, db_pass, region });
    const ref = proj.ref ?? proj.id;
    const s = getSecrets(alias);
    updateSecrets(alias, { dbPasswords: { ...(s.dbPasswords ?? {}), [ref]: db_pass } });
    return done({ alias, project: { ...proj, ref }, db_password_saved: true }, () => {
      console.log(green("✓ ") + `Progetto ${bold(name)} creato · ${ref} · ${region}`);
      console.log(dim(`  Password del database salvata: sbs creds ${alias} --reveal`));
    });
  }
  let projects = await v1(alias).projects();
  const org = str(o.org);
  if (org) projects = projects.filter((x) => x.organization_slug === org || x.organization_id === org);
  done({ alias, projects }, () => {
    if (!projects.length) return console.log("Nessun progetto.");
    table(
      projects.map((x) => ({ ref: x.ref ?? x.id, nome: x.name, org: x.organization_slug ?? x.organization_id, regione: x.region, stato: x.status })),
      ["ref", "nome", "org", "regione", "stato"],
    );
  });
}

// ---------- health ----------

export async function cmdDoctor() {
  const accs = listAccounts();
  const results = await Promise.all(
    accs.map(async (a) => {
      const s = getSecrets(a.alias);
      if (!s.token) return { alias: a.alias, ok: false, problem: "token mancante" };
      try {
        const prof = await v1(a.alias).profile();
        const mismatch = a.email && prof.primary_email.toLowerCase() !== a.email.toLowerCase();
        return { alias: a.alias, ok: !mismatch, email: prof.primary_email, problem: mismatch ? `token di ${prof.primary_email}` : undefined };
      } catch (e) {
        return { alias: a.alias, ok: false, problem: e instanceof ApiError && e.status === 401 ? "token scaduto o revocato" : (e as Error).message };
      }
    }),
  );
  const cli = readCliToken();
  done({ accounts: results, cli_account: cli ? (findAliasByToken(cli) ?? "unknown") : null, env_override: Boolean(process.env.SUPABASE_ACCESS_TOKEN) }, () => {
    for (const r of results) console.log(`${r.ok ? green("✓") : yellow("!")} ${r.alias.padEnd(20)} ${r.ok ? dim(r.email ?? "") : r.problem}`);
    if (!results.length) console.log("Nessun account registrato.");
    warnEnvOverride();
  });
}
