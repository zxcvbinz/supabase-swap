// Drives the Supabase dashboard in Chrome (one browser profile per account), for what has no API:
// sign-up and sign-in sit behind hCaptcha, so they run in a visible window where the user can solve it.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { CONFIG_DIR, UserError } from "./store";
import { DASHBOARD } from "./urls";

const API = process.env.SBS_API_URL ?? "https://api.supabase.com";
const SESSION_KEY = "supabase.dashboard.auth.token";
const HUMAN_WAIT = Number(process.env.SBS_BROWSER_WAIT ?? 5 * 60_000); // time left to the user for a captcha challenge

export const profileDir = (alias: string) => join(CONFIG_DIR, "browser", alias);

export async function launch(alias: string): Promise<{ ctx: BrowserContext; page: Page }> {
  mkdirSync(profileDir(alias), { recursive: true, mode: 0o700 });
  let ctx: BrowserContext;
  try {
    ctx = await chromium.launchPersistentContext(profileDir(alias), { channel: "chrome", headless: process.env.SBS_HEADLESS === "1", viewport: null });
  } catch (e) {
    const msg = (e as Error).message;
    if (/ProcessSingleton|already in use|SingletonLock/i.test(msg))
      throw new UserError(`La finestra di Chrome di "${alias}" è già aperta.`, "browser_busy", "Chiudila e riprova.");
    throw new UserError("Non riesco ad aprire Chrome: " + msg.split("\n")[0], "browser_failed");
  }
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { ctx, page };
}

/** Wait for the first of several outcomes; returns its key. */
async function race(outcomes: Record<string, () => Promise<unknown>>, timeout: number): Promise<string> {
  const never = new Promise<string>(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<string>((r) => (timer = setTimeout(() => r("timeout"), timeout)));
  const wrapped = Object.entries(outcomes).map(([k, fn]) =>
    fn()
      .then(() => k)
      .catch(() => never),
  );
  try {
    return await Promise.race([...wrapped, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function toastError(page: Page): Promise<string | undefined> {
  const t = page.locator("[data-sonner-toast][data-type=error]").first();
  return (await t.count()) ? (await t.innerText()).trim() : undefined;
}

export async function signUp(page: Page, email: string, password: string) {
  await page.goto(`${DASHBOARD}/sign-up`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  const r = await race(
    {
      ok: () => page.getByText("Check your email").waitFor({ timeout: HUMAN_WAIT }),
      err: () => page.locator("[data-sonner-toast][data-type=error]").first().waitFor({ timeout: HUMAN_WAIT }),
    },
    HUMAN_WAIT,
  );
  if (r === "ok") return;
  const msg = r === "err" ? await toastError(page) : "nessuna risposta (captcha non risolto?)";
  if (msg && /already registered|already exists/i.test(msg))
    throw new UserError(`Esiste già un account Supabase con ${email}.`, "already_registered", "Se è del cliente, salvane la password e usa: sbs connect <alias>");
  throw new UserError(`Registrazione non riuscita: ${msg}`, "signup_failed");
}

const onAuthPage = (page: Page) => /\/(sign-in|sign-up|forgot-password)/.test(new URL(page.url()).pathname);

/** Logged in = back on the dashboard with a session in localStorage (also after GitHub/SSO round-trips). */
async function waitLoggedIn(page: Page, timeout: number): Promise<boolean> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const u = new URL(page.url());
      if (u.hostname === "supabase.com" && u.pathname.startsWith("/dashboard") && !onAuthPage(page) && (await readSession(page))?.access_token)
        return true;
    } catch {} // page is navigating
    await page.waitForTimeout(1000);
  }
  return false;
}

/**
 * Sign in on the dashboard. With a password the form is filled in; without one the user signs in
 * by hand (GitHub, SSO, ...). Returns the email of the signed-in account.
 */
export async function signIn(page: Page, email?: string, password?: string): Promise<string> {
  await page.goto(`${DASHBOARD}/sign-in`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500); // an existing session redirects away from /sign-in
  if (!onAuthPage(page)) {
    const current = await sessionEmail(page);
    if (current && (!email || current.toLowerCase() === email.toLowerCase())) return current;
    await page.evaluate((k) => localStorage.removeItem(k), SESSION_KEY);
    await page.goto(`${DASHBOARD}/sign-in`);
  }

  if (email && password) {
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    const r = await race(
      {
        ok: () => waitLoggedIn(page, HUMAN_WAIT).then((ok) => (ok ? undefined : Promise.reject())),
        err: () => page.locator("[data-sonner-toast][data-type=error]").first().waitFor({ timeout: HUMAN_WAIT }),
      },
      HUMAN_WAIT,
    );
    if (r === "err") {
      const msg = await toastError(page);
      if (msg && /not confirmed/i.test(msg))
        throw new UserError(`L'email ${email} non è ancora confermata.`, "email_not_confirmed", "Clicca il link nella mail di Supabase e riprova.");
      if (msg && /invalid login credentials/i.test(msg))
        throw new UserError("Email o password sbagliate.", "bad_credentials", "Correggile con: sbs set <alias> --password");
      throw new UserError(`Accesso non riuscito: ${msg}`, "signin_failed");
    }
    if (r === "timeout") throw new UserError("Accesso non completato in tempo (captcha non risolto?).", "signin_timeout");
  } else {
    if (email) await page.locator('input[name="email"]').fill(email).catch(() => {});
    if (!(await waitLoggedIn(page, HUMAN_WAIT)))
      throw new UserError("Accesso non completato in tempo.", "signin_timeout", "Riprova ed entra nella finestra di Chrome che si apre.");
  }

  const got = await sessionEmail(page);
  if (!got) throw new UserError("Nel browser non risulta nessun accesso alla dashboard.", "no_session");
  if (email && got.toLowerCase() !== email.toLowerCase())
    throw new UserError(`Sei entrato come ${got}, non come ${email}.`, "email_mismatch", "Riprova entrando con l'account giusto.");
  return got;
}

async function readSession(page: Page): Promise<{ access_token: string; user?: { email?: string } } | undefined> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), SESSION_KEY);
  if (!raw) return undefined;
  const j = JSON.parse(raw);
  return j.currentSession ?? j;
}

async function sessionEmail(page: Page) {
  return (await readSession(page).catch(() => undefined))?.user?.email;
}

/** Create a personal access token for the account logged in on this page. */
export async function createAccessToken(page: Page, name: string): Promise<string> {
  const s = await readSession(page);
  if (!s?.access_token) throw new UserError("Nel browser non risulta nessun accesso alla dashboard.", "no_session");
  const res = await fetch(`${API}/platform/profile/access-tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.token)
    throw new UserError(`Supabase non ha creato il token (${res.status}${j.message ? ": " + j.message : ""}).`, "token_create_failed");
  return j.token;
}

/** Open a normal, detached Chrome window on this account's profile (stays open after sbs exits). */
export function openDetached(alias: string, url: string) {
  mkdirSync(profileDir(alias), { recursive: true, mode: 0o700 });
  Bun.spawnSync(["open", "-na", "Google Chrome", "--args", `--user-data-dir=${profileDir(alias)}`, "--no-first-run", url]);
}
