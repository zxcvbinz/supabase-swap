// Supabase Management API (/v1) plus the one dashboard endpoint that creates access tokens.
import { testEnv } from "./env";
import { UserError, type ProjectInfo } from "./store";

const API_TIMEOUT_MS = 15_000;
let cachedBase: string | undefined;

/** api.supabase.com, or (tests only) SBS_API_URL, which must be https or a loopback host. */
export function apiBase(): string {
  if (cachedBase) return cachedBase;
  const custom = testEnv("SBS_API_URL");
  if (custom) {
    let u: URL | undefined;
    try {
      u = new URL(custom);
    } catch {}
    const loopback = u && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (!u || (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)))
      throw new UserError("SBS_API_URL must be an https URL or a loopback address.", "bad_api_url");
  }
  return (cachedBase = (custom ?? "https://api.supabase.com").replace(/\/+$/, ""));
}

// API strings end up in tables, errors and MCP replies: drop control characters (terminal escapes) and cap the length.
const clean = (v: unknown, max = 120) => String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, max);

export const TOKEN_RE = /^sbp_(oauth_|v0_)?[a-f0-9]{40}$/; // same check as the Supabase CLI

export interface Profile {
  gotrue_id: string;
  primary_email: string;
  username: string;
}
export interface Org {
  id?: string;
  slug: string;
  name: string;
}
interface RawProject {
  id: string;
  ref?: string;
  name: string;
  organization_slug?: string;
  organization_id?: string;
  region: string;
  status: string;
}

const cleanOrg = (o: Org): Org => ({ ...(o.id !== undefined ? { id: clean(o.id) } : {}), slug: clean(o.slug), name: clean(o.name) });

export class ApiError extends UserError {
  constructor(public status: number, message: string, code = `http_${status}`) {
    super(message, code);
  }
}

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const base = apiBase(); // outside the try: a bad SBS_API_URL is not a network error
  let res: Response;
  try {
    res = await fetch(base + path, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "supabase-swap" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new UserError("Cannot reach the Supabase API.", "network", "Check your connection.");
  }
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {}
  if (!res.ok) {
    const msg = data?.message ?? data?.error ?? (typeof data === "string" ? data : "");
    throw new ApiError(res.status, `${method} ${path} -> ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  return data as T;
}

export const api = (token: string) => ({
  profile: async (): Promise<Profile> => {
    const r = await call<Profile>(token, "GET", "/v1/profile");
    return { gotrue_id: clean(r.gotrue_id), primary_email: clean(r.primary_email), username: clean(r.username) };
  },
  orgs: async () => (await call<Org[]>(token, "GET", "/v1/organizations")).map(cleanOrg),
  createOrg: async (name: string) => cleanOrg(await call<Org>(token, "POST", "/v1/organizations", { name })),
  projects: () => call<RawProject[]>(token, "GET", "/v1/projects"),
});

/** Everything we cache about an account, fetched in one go. */
export async function snapshot(token: string) {
  const a = api(token);
  const [profile, orgs, raw] = await Promise.all([a.profile(), a.orgs(), a.projects()]);
  return { profile, orgs, projects: mapProjects(orgs, raw) };
}

export async function fetchProjects(token: string): Promise<ProjectInfo[]> {
  const a = api(token);
  const [orgs, raw] = await Promise.all([a.orgs(), a.projects()]);
  return mapProjects(orgs, raw);
}

// organization_slug may be missing; organization_id then matches the org id (or slug).
function mapProjects(orgs: Org[], raw: RawProject[]): ProjectInfo[] {
  return raw.map((p) => {
    const slug = clean(p.organization_slug);
    const orgId = clean(p.organization_id);
    const org = orgs.find((o) => o.slug === slug || o.id === orgId || o.slug === orgId);
    return {
      ref: clean(p.ref ?? p.id),
      name: clean(p.name),
      org_slug: org?.slug ?? (slug || orgId),
      org_name: org?.name ?? "",
      region: clean(p.region),
      status: clean(p.status),
    };
  });
}
