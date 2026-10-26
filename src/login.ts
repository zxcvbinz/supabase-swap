// Token creation through the same browser login the official Supabase CLI uses: the dashboard (signed in
// in the user's default browser) creates the token and hands it back encrypted for our one-time key.
import { createDecipheriv, createECDH, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import * as p from "@clack/prompts";
import { api, apiBase, TOKEN_RE } from "./api";
import { testEnv } from "./env";
import { dim, isTTY } from "./out";
import { UserError } from "./store";
import { DASHBOARD } from "./urls";

/** Open a URL in the default browser (tests swap the opener with SBS_OPEN_CMD). */
export function openUrl(url: string) {
  Bun.spawnSync([testEnv("SBS_OPEN_CMD") ?? "open", url], { stdout: "ignore", stderr: "ignore" });
}

/** AES-256-GCM payload from /platform/cli/login: ciphertext followed by a 16-byte auth tag (all hex). */
export function decryptToken(ecdh: ReturnType<typeof createECDH>, r: { access_token: string; public_key: string; nonce: string }): string {
  const shared = ecdh.computeSecret(Buffer.from(r.public_key, "hex"));
  const cut = r.access_token.length - 32;
  const decipher = createDecipheriv("aes-256-gcm", shared, Buffer.from(r.nonce, "hex"));
  decipher.setAuthTag(Buffer.from(r.access_token.slice(cut), "hex"));
  return decipher.update(Buffer.from(r.access_token.slice(0, cut), "hex")).toString("utf8") + decipher.final("utf8");
}

async function askCode(): Promise<string> {
  const fake = testEnv("SBS_LOGIN_CODE");
  if (fake) return fake;
  if (!isTTY())
    throw new UserError("A browser sign-in needs a terminal.", "needs_login", "Run sbs add in a terminal.");
  const v = await p.text({ message: "Enter the verification code shown in the browser:" });
  if (p.isCancel(v)) throw new UserError("Cancelled.", "cancelled");
  return v.trim();
}

/** Browser login; returns a fresh personal access token for whoever is signed in to Supabase there. */
export async function browserLogin(label: string): Promise<string> {
  if (!isTTY() && !testEnv("SBS_LOGIN_CODE"))
    throw new UserError("A browser sign-in needs a terminal.", "needs_login", "Run sbs add in a terminal.");
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const sessionId = randomUUID();
  const name = `sbs_${label}@${hostname()}_${Math.floor(Date.now() / 1000)}`;
  const url = `${DASHBOARD}/cli/login?session_id=${sessionId}&token_name=${encodeURIComponent(name)}&public_key=${ecdh.getPublicKey("hex", "uncompressed")}`;
  console.error(dim("Opening your browser - make sure you are signed in to Supabase as the account you want to add (sign out/switch there first if needed)."));
  console.error(dim(`If it does not open, visit: ${url}`));
  openUrl(url);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const code = await askCode();
    try {
      const res = await fetch(`${apiBase()}/platform/cli/login/${encodeURIComponent(sessionId)}?device_code=${encodeURIComponent(code)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 200) {
        const token = decryptToken(ecdh, (await res.json()) as any);
        if (!TOKEN_RE.test(token)) throw new UserError("Supabase returned an unexpected token.", "login_failed");
        return token;
      }
      if (attempt === 3) throw new UserError(`Verification failed (${res.status}).`, "login_failed");
      console.error(`Verification failed (${res.status}). Try again.`);
    } catch (e) {
      if (e instanceof UserError) throw e;
      if (attempt === 3) throw new UserError("Could not verify the code.", "login_failed");
      console.error("Could not verify the code. Try again.");
    }
  }
  throw new UserError("Login failed.", "login_failed");
}

/** Browser login that must end up on the given email; otherwise nothing is touched. */
export async function loginAs(label: string, email: string): Promise<string> {
  const token = await browserLogin(label);
  const who = (await api(token).profile()).primary_email;
  if (who.toLowerCase() !== email.toLowerCase())
    throw new UserError(`You signed in as ${who}, not ${email}.`, "email_mismatch", "Switch account in the browser and retry.");
  return token;
}
