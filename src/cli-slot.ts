// The Supabase CLI reads ~/.supabase/access-token when nothing else (env var, Keychain) answers first.
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic";
import { testEnv } from "./env";

export const TOKEN_FILE = testEnv("SBS_CLI_TOKEN_FILE") ?? join(homedir(), ".supabase", "access-token");

export function writeCliToken(token: string) {
  mkdirSync(dirname(TOKEN_FILE), { recursive: true, mode: 0o700 }); // 0700 only if we create it
  writeFileAtomic(TOKEN_FILE, token);
}

/** Remove the token file if it still holds this token; returns whether it did. */
export function clearCliToken(token: string): boolean {
  if (!existsSync(TOKEN_FILE) || readFileSync(TOKEN_FILE, "utf8").trim() !== token) return false;
  unlinkSync(TOKEN_FILE);
  return true;
}
