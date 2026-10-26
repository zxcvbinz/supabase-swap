// Minimal wrapper around the macOS `security` tool (login keychain).

export function kcGet(service: string, account: string): string | null {
  const r = Bun.spawnSync(["security", "find-generic-password", "-s", service, "-a", account, "-w"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) return null;
  return r.stdout.toString().replace(/\n$/, "");
}

export function kcSet(service: string, account: string, value: string): void {
  const r = Bun.spawnSync(
    ["security", "add-generic-password", "-U", "-s", service, "-a", account, "-w", value],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (r.exitCode !== 0) throw new Error(`Portachiavi: scrittura fallita (${r.stderr.toString().trim()})`);
}

export function kcDelete(service: string, account: string): boolean {
  const r = Bun.spawnSync(["security", "delete-generic-password", "-s", service, "-a", account], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return r.exitCode === 0;
}
