import { testEnv } from "./env";

// SBS_DASHBOARD_URL (honored only under SBS_TEST=1) lets tests point at a local stub.
export const DASHBOARD = testEnv("SBS_DASHBOARD_URL") ?? "https://supabase.com/dashboard";

export const urls = {
  team: (slug: string) => `${DASHBOARD}/org/${encodeURIComponent(slug)}/team`,
  project: (ref: string) => `${DASHBOARD}/project/${encodeURIComponent(ref)}`,
};
