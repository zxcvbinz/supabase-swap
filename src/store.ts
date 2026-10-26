// Account registry (no secrets, JSON file) + secrets (one keychain item per account).
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { kcDelete, kcGet, kcSet } from "./keychain";

export const SERVICE = process.env.SBS_SERVICE ?? "supabase-swap";
export const CONFIG_DIR = process.env.SBS_CONFIG_DIR ?? join(homedir(), ".config", "supabase-swap");
const REGISTRY = join(CONFIG_DIR, "accounts.json");

export type Kind = "mine" | "client";

export interface Account {
  alias: string;
  email?: string;
  label?: string;
  kind: Kind;
  userId?: string; // gotrue_id
  createdAt: string;
  updatedAt: string;
}

export interface Secrets {
  email?: string;
  password?: string;
  token?: string; // personal access token (sbp_...)
  dbPasswords?: Record<string, string>; // project ref -> db password
}

interface Registry {
  version: 1;
  active?: string;
  accounts: Record<string, Account>;
}

export const ALIAS_RE = /^[a-z0-9][a-z0-9._-]{0,47}$/;

export function assertAlias(alias: string | undefined): string {
  if (!alias) throw new UserError("Manca il nome dell'account (alias).", "missing_alias");
  if (!ALIAS_RE.test(alias))
    throw new UserError(
      `Alias non valido: "${alias}". Usa minuscole, numeri, punto, trattino o underscore (es. cliente-rossi).`,
      "invalid_alias",
    );
  return alias;
}

export class UserError extends Error {
  constructor(message: string, public code = "error", public hint?: string) {
    super(message);
  }
}

function load(): Registry {
  if (!existsSync(REGISTRY)) return { version: 1, accounts: {} };
  return JSON.parse(readFileSync(REGISTRY, "utf8"));
}

function save(reg: Registry) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = REGISTRY + ".tmp";
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, REGISTRY);
  chmodSync(REGISTRY, 0o600);
}

export function listAccounts(): Account[] {
  return Object.values(load().accounts).sort((a, b) => a.alias.localeCompare(b.alias));
}

export function getAccount(alias: string): Account | undefined {
  return load().accounts[alias];
}

export function requireAccount(alias: string): Account {
  const acc = getAccount(alias);
  if (!acc)
    throw new UserError(`Account "${alias}" non trovato.`, "unknown_account", "Vedi gli account con: sbs list");
  return acc;
}

export function upsertAccount(alias: string, patch: Partial<Omit<Account, "alias">>): Account {
  const reg = load();
  const now = new Date().toISOString();
  const prev = reg.accounts[alias];
  const next: Account = {
    kind: "client",
    createdAt: now,
    ...prev,
    ...stripUndefined(patch),
    alias,
    updatedAt: now,
  };
  reg.accounts[alias] = next;
  save(reg);
  return next;
}

export function removeAccount(alias: string) {
  const reg = load();
  delete reg.accounts[alias];
  if (reg.active === alias) delete reg.active;
  save(reg);
  kcDelete(SERVICE, alias);
}

export function getActive(): string | undefined {
  return load().active;
}

export function setActive(alias: string | undefined) {
  const reg = load();
  reg.active = alias;
  save(reg);
}

export function getSecrets(alias: string): Secrets {
  const raw = kcGet(SERVICE, alias);
  return raw ? JSON.parse(raw) : {};
}

export function updateSecrets(alias: string, patch: Partial<Secrets>): Secrets {
  const next = { ...getSecrets(alias), ...stripUndefined(patch) };
  kcSet(SERVICE, alias, JSON.stringify(next));
  return next;
}

export function findAliasByToken(token: string): string | undefined {
  return listAccounts().find((a) => getSecrets(a.alias).token === token)?.alias;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function clearSecrets(alias: string, ...keys: (keyof Secrets)[]) {
  const s = getSecrets(alias);
  for (const k of keys) delete s[k];
  kcSet(SERVICE, alias, JSON.stringify(s));
}

export function renameAccount(from: string, to: string) {
  const reg = load();
  const acc = reg.accounts[from];
  if (!acc) throw new UserError(`Account "${from}" non trovato.`, "unknown_account");
  if (reg.accounts[to]) throw new UserError(`Esiste già un account "${to}".`, "exists");
  kcSet(SERVICE, to, JSON.stringify(getSecrets(from)));
  reg.accounts[to] = { ...acc, alias: to, updatedAt: new Date().toISOString() };
  delete reg.accounts[from];
  if (reg.active === from) reg.active = to;
  save(reg);
  kcDelete(SERVICE, from);
}
