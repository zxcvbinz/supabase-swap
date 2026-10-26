// The place where the official Supabase CLI keeps its token.
// Lookup order of the CLI (v2.x): SUPABASE_ACCESS_TOKEN env, keychain "Supabase CLI"/<profile>
// (default profile "supabase"), keychain "Supabase CLI"/"access-token", file ~/.supabase/access-token.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { kcGet, kcSet } from "./keychain";
import { SERVICE } from "./store";

const CLI_SERVICE = process.env.SBS_CLI_SERVICE ?? "Supabase CLI";
const CLI_PROFILE = process.env.SBS_CLI_PROFILE ?? "supabase";
const LEGACY_KEY = "access-token";
const TOKEN_FILE = process.env.SBS_CLI_TOKEN_FILE ?? join(homedir(), ".supabase", "access-token");
const KEYRING_PREFIX = "go-keyring-base64:";
const KEYRING_HEX_PREFIX = "go-keyring-encoded:";
const BACKUP_KEY = "__cli-backup";

function decode(v: string | null): string | null {
  if (!v) return null;
  if (v.startsWith(KEYRING_PREFIX)) return Buffer.from(v.slice(KEYRING_PREFIX.length), "base64").toString();
  if (v.startsWith(KEYRING_HEX_PREFIX)) return Buffer.from(v.slice(KEYRING_HEX_PREFIX.length), "hex").toString();
  return v;
}

/** Token the Supabase CLI would use right now (ignoring the env var). */
export function readCliToken(): string | null {
  return (
    decode(kcGet(CLI_SERVICE, CLI_PROFILE)) ??
    decode(kcGet(CLI_SERVICE, LEGACY_KEY)) ??
    (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8").trim() || null : null)
  );
}

/** Same encoding go-keyring uses, so the CLI reads it back unchanged. */
export function writeCliToken(token: string) {
  kcSet(CLI_SERVICE, CLI_PROFILE, KEYRING_PREFIX + Buffer.from(token).toString("base64"));
  if (existsSync(TOKEN_FILE)) writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
}

/** Keep a copy of a token that does not belong to any known account before overwriting it. */
export function backupCliToken(token: string) {
  const all = readCliBackups();
  if (all.some((b) => b.token === token)) return;
  all.push({ token, savedAt: new Date().toISOString() });
  kcSet(SERVICE, BACKUP_KEY, JSON.stringify(all));
}

export function readCliBackups(): { token: string; savedAt: string }[] {
  const raw = kcGet(SERVICE, BACKUP_KEY);
  return raw ? JSON.parse(raw) : [];
}
