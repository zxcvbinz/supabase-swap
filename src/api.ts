// Supabase Management API (/v1).
import { getSecrets, UserError } from "./store";

const BASE = process.env.SBS_API_URL ?? "https://api.supabase.com";

export interface Profile {
  gotrue_id: string;
  primary_email: string;
  username: string;
}
export interface Org {
  slug: string;
  name: string;
}
export interface Member {
  user_id: string;
  user_name: string;
  email: string;
  role_name: string;
  mfa_enabled: boolean;
}
export interface Project {
  id: string;
  ref?: string;
  name: string;
  organization_slug?: string;
  organization_id?: string;
  region: string;
  status: string;
  created_at: string;
}

export class ApiError extends UserError {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message, `http_${status}`);
  }
}

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "supabase-swap",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {}
  if (!res.ok) {
    const msg = (data as any)?.message ?? (data as any)?.error ?? (typeof data === "string" ? data : "");
    throw new ApiError(res.status, `${method} ${path} → ${res.status}${msg ? `: ${msg}` : ""}`, data);
  }
  return data as T;
}

export function tokenOf(alias: string): string {
  const t = getSecrets(alias).token;
  if (!t)
    throw new UserError(
      `L'account "${alias}" non ha ancora un token.`,
      "missing_token",
      `Collega il token con: sbs login ${alias}  (oppure sbs set ${alias} --token-stdin)`,
    );
  return t;
}

export const v1 = (alias: string) => {
  const t = tokenOf(alias);
  return {
    profile: () => call<Profile>(t, "GET", "/v1/profile"),
    orgs: () => call<Org[]>(t, "GET", "/v1/organizations"),
    createOrg: (name: string) => call<Org>(t, "POST", "/v1/organizations", { name }),
    members: (slug: string) => call<Member[]>(t, "GET", `/v1/organizations/${slug}/members`),
    projects: () => call<Project[]>(t, "GET", "/v1/projects"),
    createProject: (b: { name: string; organization_slug: string; db_pass: string; region: string }) =>
      call<Project>(t, "POST", "/v1/projects", {
        name: b.name,
        organization_slug: b.organization_slug,
        db_pass: b.db_pass,
        region_selection: { type: "specific", code: b.region },
      }),
  };
};
