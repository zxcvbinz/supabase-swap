// All state lives in one file: $SBS_CONFIG_DIR/config.json (0600, written atomically under a lock file).
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic";

export const CONFIG_DIR = process.env.SBS_CONFIG_DIR ?? join(homedir(), ".config", "supabase-swap");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export type Kind = "mine" | "client";

export interface ProjectInfo {
  ref: string;
  name: string;
  org_slug: string;
  org_name: string;
  region: string;
  status: string;
}

export interface Account {
  alias: string;
  email: string;
  kind: Kind;
  label?: string;
  token: string;
  password?: string; // only for accounts created with `sbs new`
  dbPasswords?: Record<string, string>;
  userId: string;
  projects: ProjectInfo[];
  projectsSyncedAt?: string;
  tokenCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface Config {
  version: 1;
  active?: string;
  accounts: Record<string, Account>;
}

export class UserError extends Error {
  constructor(message: string, public code = "error", public hint?: string) {
    super(message);
  }
}

export const ALIAS_RE = /^[a-z0-9][a-z0-9._-]{0,47}$/;

export function assertAlias(alias: string | undefined): string {
  if (!alias) throw new UserError("Missing account alias.", "missing_alias");
  if (!ALIAS_RE.test(alias))
    throw new UserError(`Invalid alias "${alias}".`, "invalid_alias", "Use lowercase letters, digits, . _ - (e.g. acme).");
  return alias;
}

export function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return { version: 1, accounts: {} };
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
}

export function saveConfig(cfg: Config) {
  ensureDir(CONFIG_DIR);
  writeFileAtomic(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
}

// ---- lock: two sbs processes must not lose each other's writes ----
const LOCK_FILE = `${CONFIG_FILE}.lock`;
const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 30_000; // a crashed sbs leaves its lock behind
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Load, change, save under the lock; the config is re-read inside it so nothing is overwritten. */
function update<T>(fn: (cfg: Config) => T): T {
  ensureDir(CONFIG_DIR);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (let backoff = 10; ; backoff = Math.min(backoff * 2, 200)) {
    try {
      closeSync(openSync(LOCK_FILE, "wx", 0o600)); // exclusive create = acquire
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) unlinkSync(LOCK_FILE);
      } catch {} // released or broken by someone else meanwhile
      if (Date.now() > deadline)
        throw new UserError("The sbs config is locked by another sbs.", "locked", `Retry; if no sbs is running, delete ${LOCK_FILE}`);
      sleep(backoff);
    }
  }
  try {
    const cfg = loadConfig();
    const out = fn(cfg);
    saveConfig(cfg);
    return out;
  } finally {
    try {
      unlinkSync(LOCK_FILE);
    } catch {}
  }
}

/** Aliases are user-chosen: own keys only, so "constructor" or "toString" are never accounts. */
const has = (accounts: Record<string, Account>, alias: string) => Object.hasOwn(accounts, alias);

export const listAccounts = () => Object.values(loadConfig().accounts).sort((a, b) => a.alias.localeCompare(b.alias));
export const getAccount = (alias: string): Account | undefined => {
  const accounts = loadConfig().accounts;
  return has(accounts, alias) ? accounts[alias] : undefined;
};
export const getActive = () => loadConfig().active;

export function requireAccount(alias: string): Account {
  const acc = getAccount(alias);
  if (!acc) throw new UserError(`No account "${alias}".`, "not_found", "List accounts with: sbs ls");
  return acc;
}

export function putAccount(acc: Account) {
  update((cfg) => {
    cfg.accounts[acc.alias] = { ...acc, updatedAt: new Date().toISOString() };
  });
}

export function patchAccount(alias: string, patch: Partial<Account>): Account {
  return update((cfg) => {
    if (!has(cfg.accounts, alias)) throw new UserError(`No account "${alias}".`, "not_found", "List accounts with: sbs ls");
    const acc = { ...cfg.accounts[alias]!, ...patch, updatedAt: new Date().toISOString() };
    cfg.accounts[alias] = acc;
    return acc;
  });
}

export function removeAccount(alias: string) {
  update((cfg) => {
    delete cfg.accounts[alias];
    if (cfg.active === alias) delete cfg.active;
  });
}

export function setActive(alias: string) {
  update((cfg) => {
    cfg.active = alias;
  });
}

export function renameAccount(from: string, to: string) {
  update((cfg) => {
    if (!has(cfg.accounts, from)) throw new UserError(`No account "${from}".`, "not_found");
    if (has(cfg.accounts, to)) throw new UserError(`Account "${to}" already exists.`, "exists");
    const acc = cfg.accounts[from]!;
    delete cfg.accounts[from];
    cfg.accounts[to] = { ...acc, alias: to, updatedAt: new Date().toISOString() };
    if (cfg.active === from) cfg.active = to;
  });
}

/** Run an arbitrary change to the whole config under the lock (migration). */
export const updateConfig = update;

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/**
 * First free alias from a suggestion. When several accounts share an org name, the email tells
 * them apart (acme, acme-info, acme-mario); a number is the last resort (acme-2).
 */
export function uniqueAlias(base: string, email?: string): string {
  const taken = loadConfig().accounts;
  const b = slug(base) || "account";
  const who = email ? slug(email.split("@")[0]!) : "";
  for (const c of [b, who && who !== b ? `${b}-${who}`.slice(0, 48) : ""]) if (c && !has(taken, c)) return c;
  let alias = b;
  for (let i = 2; has(taken, alias); i++) alias = `${b}-${i}`;
  return alias;
}
