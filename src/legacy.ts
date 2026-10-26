// One-time hand-overs from the Keychain: (1) the Supabase CLI's own login, which would shadow the
// token file, and (2) the old sbs format (accounts.json + one Keychain item per alias).
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { api, ApiError, snapshot, TOKEN_RE } from "./api";
import { buildAccount } from "./accounts";
import { kcDelete, kcExists, kcGet } from "./keychain";
import { testEnv } from "./env";
import { dim, info, yellow } from "./out";
import { CONFIG_DIR, CONFIG_FILE, listAccounts, putAccount, uniqueAlias, updateConfig, UserError, type Account } from "./store";

const CLI_SERVICE = testEnv("SBS_CLI_SERVICE") ?? "Supabase CLI";
const CLI_ACCOUNTS = [process.env.SBS_CLI_PROFILE ?? "supabase", "access-token"]; // profile name, then legacy key
const OLD_SERVICE = testEnv("SBS_SERVICE") ?? "supabase-swap";
const OLD_REGISTRY = join(CONFIG_DIR, "accounts.json");

// go-keyring may store values as base64 or hex with a prefix
function decode(v: string): string {
  if (v.startsWith("go-keyring-base64:")) return Buffer.from(v.slice(18), "base64").toString();
  if (v.startsWith("go-keyring-encoded:")) return Buffer.from(v.slice(19), "hex").toString();
  return v;
}

/** Why a Keychain item cannot be removed safely; the item stays where it is. */
const keep = (why: string) =>
  new UserError(
    `Left the Supabase CLI login in the Keychain: ${why}`,
    "keychain_kept",
    "Nothing was deleted. Retry, or run `supabase logout` to remove it yourself.",
  );

/**
 * The CLI prefers Keychain items over ~/.supabase/access-token, so they must go. An item is deleted only once
 * its token is safe in sbs (already stored, or imported now) or is dead (401); anything else aborts untouched.
 * Presence is checked without reading the secret (no prompt).
 */
export async function takeoverCliKeychain() {
  const present = CLI_ACCOUNTS.filter((a) => kcExists(CLI_SERVICE, a));
  if (!present.length) return;
  const imported: string[] = [];
  for (const acct of present) {
    const raw = kcGet(CLI_SERVICE, acct);
    if (raw === null) throw keep("could not read it (access denied or locked).");
    const token = decode(raw).trim();
    if (!TOKEN_RE.test(token)) throw keep("its token has an unexpected format.");
    const alias = await importToken(token);
    if (alias) imported.push(alias);
  }
  const left = present.filter((acct) => !kcDelete(CLI_SERVICE, acct));
  if (left.length)
    throw new UserError(
      "Could not remove the Supabase CLI login from the Keychain, so the CLI would keep using it.",
      "keychain_locked",
      "Run `supabase logout`, then retry.",
    );
  info(
    dim("Moved the Supabase CLI login out of the Keychain (it would hide the token sbs writes).") +
      (imported.length ? dim(` Saved as: ${imported.join(", ")}.`) : ""),
  );
}

/** Make sure a Keychain token is kept in sbs; returns the new alias if one was added. Throws if it cannot be kept or shown dead. */
async function importToken(token: string): Promise<string | undefined> {
  if (listAccounts().some((a) => a.token === token)) return;
  try {
    await api(token).profile();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return; // revoked or expired: nothing to save
    throw keep(`could not check the token with Supabase (${(e as Error).message}).`);
  }
  try {
    const s = await snapshot(token);
    if (listAccounts().some((a) => a.email.toLowerCase() === s.profile.primary_email.toLowerCase())) return; // account already saved
    const alias = uniqueAlias(s.orgs[0]?.name ?? s.profile.primary_email.split("@")[0]!, s.profile.primary_email);
    putAccount(buildAccount({ alias, kind: "mine", email: s.profile.primary_email, userId: s.profile.gotrue_id, token, projects: s.projects }));
    return alias;
  } catch (e) {
    if (e instanceof UserError && e.code === "locked") throw e;
    throw keep(`could not import it (${(e as Error).message}).`);
  }
}

/** Old accounts.json + Keychain "supabase-swap" items -> config.json. Keychain items are left alone. Never fatal. */
export async function migrateOldFormat() {
  try {
    await migrate();
  } catch (e) {
    info(yellow("! ") + `Could not migrate the old sbs data (${(e as Error).message}); continuing without it.`);
  }
}

async function migrate() {
  if (!existsSync(OLD_REGISTRY) || existsSync(CONFIG_FILE)) return;
  const old = JSON.parse(readFileSync(OLD_REGISTRY, "utf8"));
  const skipped: string[] = [];
  const cfg = updateConfig((cfg) => {
    for (const o of Object.values<any>(old.accounts ?? {})) {
      const secrets = JSON.parse(kcGet(OLD_SERVICE, o.alias) ?? "{}");
      if (!secrets.token || !o.email) {
        skipped.push(o.alias); // an account without a token is not kept
        continue;
      }
      const t = new Date().toISOString();
      cfg.accounts[o.alias] = {
        alias: o.alias,
        email: o.email,
        kind: o.kind === "mine" ? "mine" : "client",
        ...(o.label ? { label: o.label } : {}),
        token: secrets.token,
        ...(secrets.password ? { password: secrets.password } : {}),
        ...(secrets.dbPasswords ? { dbPasswords: secrets.dbPasswords } : {}),
        userId: o.userId ?? "",
        projects: [],
        createdAt: o.createdAt ?? t,
        updatedAt: t,
      };
    }
    if (old.active && Object.hasOwn(cfg.accounts, old.active)) cfg.active = old.active;
    return cfg.accounts;
  });
  const fetched: Record<string, Pick<Account, "projects" | "projectsSyncedAt">> = {};
  for (const a of Object.values(cfg)) {
    try {
      fetched[a.alias] = { projects: (await snapshot(a.token)).projects, projectsSyncedAt: new Date().toISOString() };
    } catch {} // stale token or offline: `sbs sync` will sort it out
  }
  updateConfig((c) => {
    for (const [alias, patch] of Object.entries(fetched)) if (Object.hasOwn(c.accounts, alias)) Object.assign(c.accounts[alias]!, patch);
  });
  renameSync(OLD_REGISTRY, OLD_REGISTRY + ".migrated");
  info(
    dim(`Migrated ${Object.keys(cfg).length} account(s) from the old format; the Keychain is no longer used.`) +
      (skipped.length ? dim(` Skipped without a token: ${skipped.join(", ")} (use: sbs add).`) : ""),
  );
}
