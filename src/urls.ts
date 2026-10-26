export const DASHBOARD = "https://supabase.com/dashboard";

export const urls = {
  dashboard: DASHBOARD,
  tokens: `${DASHBOARD}/account/tokens`,
  team: (slug: string) => `${DASHBOARD}/org/${slug}/team`,
  org: (slug: string) => `${DASHBOARD}/org/${slug}`,
  project: (ref: string) => `${DASHBOARD}/project/${ref}`,
};
