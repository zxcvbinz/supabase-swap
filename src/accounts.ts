// Core logic shared by commands, the menu and the MCP server: token upkeep, project cache, lookups.
import { api, ApiError, fetchProjects } from "./api";
import { loginAs } from "./login";
import { info, interactive } from "./out";
import { listAccounts, patchAccount, requireAccount, UserError, type Account, type ProjectInfo } from "./store";

const TOKEN_TTL = 60 * 60_000; // re-check a token at most once an hour
const PROJECTS_TTL = 24 * 60 * 60_000;

const age = (iso?: string) => (iso ? Date.now() - Date.parse(iso) : Infinity);
const now = () => new Date().toISOString();

/** Make sure the account has a working token; renews it through the browser when Supabase says 401. */
export async function ensureToken(alias: string, force = false): Promise<Account> {
  const acc = requireAccount(alias);
  if (!force && age(acc.tokenCheckedAt) < TOKEN_TTL) return acc;
  try {
    await api(acc.token).profile();
    return patchAccount(alias, { tokenCheckedAt: now() });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      if (!interactive()) throw new UserError(`The token of "${alias}" was revoked or expired.`, "needs_login", "Run: sbs add");
      info(`The token of "${alias}" was revoked or expired: signing in again.`);
      const token = await loginAs(alias, acc.email);
      return patchAccount(alias, { token, tokenCheckedAt: now() });
    }
    if (e instanceof UserError && e.code === "network" && !force) return acc; // offline: keep going with what we have
    throw e;
  }
}

export function buildAccount(a: Pick<Account, "alias" | "kind" | "email" | "userId" | "token" | "projects"> & Partial<Account>): Account {
  const t = now();
  return { projectsSyncedAt: t, tokenCheckedAt: t, createdAt: t, updatedAt: t, ...a };
}

export async function refreshProjects(alias: string): Promise<Account> {
  const acc = await ensureToken(alias);
  const projects = await fetchProjects(acc.token);
  return patchAccount(alias, { projects, projectsSyncedAt: now() });
}

export interface SyncResult {
  alias: string;
  ok: boolean;
  projects?: number;
  error?: string;
  code?: string;
}

/** Refresh several accounts one by one; a failing account does not stop the others. */
export async function syncAccounts(aliases: string[], force: boolean): Promise<SyncResult[]> {
  const out: SyncResult[] = [];
  for (const alias of aliases) {
    try {
      if (force) await ensureToken(alias, true);
      const acc = await refreshProjects(alias);
      out.push({ alias, ok: true, projects: acc.projects.length });
    } catch (e) {
      out.push({ alias, ok: false, error: (e as Error).message, code: e instanceof UserError ? e.code : "internal" });
    }
  }
  return out;
}

/** Refresh the accounts whose cache is older than a day (or all of them). */
export const refreshStale = (all: boolean) =>
  syncAccounts(
    listAccounts()
      .filter((a) => all || age(a.projectsSyncedAt) > PROJECTS_TTL)
      .map((a) => a.alias),
    false,
  );

export interface ProjectHit extends ProjectInfo {
  account: string;
  email: string;
}

export const allProjects = (): ProjectHit[] =>
  listAccounts().flatMap((a) => a.projects.map((p) => ({ ...p, account: a.alias, email: a.email })));

export function searchProjects(query: string): ProjectHit[] {
  const q = query.toLowerCase();
  return allProjects().filter((p) => [p.name, p.ref, p.org_name, p.org_slug].some((v) => v.toLowerCase().includes(q)));
}

export interface Target {
  account: Account;
  project?: ProjectHit;
  loose?: boolean; // matched by substring only
}

/** alias exact > project ref exact > project name (exact, then unique substring). */
export function resolveTarget(query: string): Target {
  const accounts = listAccounts();
  const byAlias = accounts.find((a) => a.alias === query);
  if (byAlias) return { account: byAlias };

  const projects = allProjects();
  const q = query.toLowerCase();
  const pick = (hits: ProjectHit[], loose = false): Target | undefined => {
    if (hits.length === 1) return { account: requireAccount(hits[0]!.account), project: hits[0], ...(loose ? { loose } : {}) };
    if (hits.length > 1) throw ambiguous(query, hits);
  };
  const found =
    pick(projects.filter((p) => p.ref === query)) ??
    pick(projects.filter((p) => p.name.toLowerCase() === q)) ??
    pick(projects.filter((p) => p.name.toLowerCase().includes(q)), true);
  if (found) return found;
  throw new UserError(`No account or project matches "${query}".`, "not_found", "Try: sbs find <text>   (or sbs projects --refresh)");
}

const ambiguous = (query: string, hits: ProjectHit[]) =>
  new UserError(
    `"${query}" matches several projects: ${hits.map((h) => `${h.name} (${h.account}/${h.ref})`).join(", ")}`,
    "ambiguous",
    "Use the project ref or the account alias.",
  );
