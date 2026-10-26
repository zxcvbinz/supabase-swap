// Output: human text on a terminal, a single JSON object with --json (for agents and scripts).
import { UserError } from "./store";

export const flags = { json: false, yes: false };

export const isTTY = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);
export const interactive = () => isTTY() && !flags.json;

const c = (code: number) => (s: string) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
export const dim = c(2);
export const bold = c(1);
export const green = c(32);
export const yellow = c(33);
export const red = c(31);

/** Print the result of a command: JSON as-is, or the human renderer. */
export function done(data: object, human?: () => void) {
  if (flags.json) process.stdout.write(JSON.stringify({ ok: true, ...data }, null, 2) + "\n");
  else human?.();
}

/** Progress and notes. With --json they go to stderr so stdout stays a single JSON object. */
export function info(msg: string) {
  if (flags.json) process.stderr.write(msg.replace(/\x1b\[[0-9;]*m/g, "") + "\n");
  else console.log(msg);
}

export function fail(e: unknown): never {
  const err = e instanceof UserError ? e : new UserError(e instanceof Error ? e.message : String(e), "internal");
  if (flags.json)
    process.stdout.write(JSON.stringify({ ok: false, error: err.message, code: err.code, hint: err.hint }, null, 2) + "\n");
  else {
    console.error(red("x ") + err.message);
    if (err.hint) console.error(dim("  " + err.hint));
  }
  process.exit(err.code === "cancelled" ? 130 : 1);
}

export function table(rows: Record<string, unknown>[], cols: string[]) {
  if (!rows.length) return;
  const w = cols.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length)));
  console.log(dim(cols.map((k, i) => k.toUpperCase().padEnd(w[i]!)).join("  ")));
  for (const r of rows) console.log(cols.map((k, i) => String(r[k] ?? "").padEnd(w[i]!)).join("  "));
}
