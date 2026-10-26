// The few macOS `security` calls needed to take over / migrate old Keychain items.
// sbs itself never keeps anything in the Keychain.
const sec = (args: string[]) => Bun.spawnSync(["security", ...args], { stdout: "pipe", stderr: "pipe" });

/** Presence check WITHOUT -w: it does not read the secret, so macOS does not prompt. */
export const kcExists = (service: string, account: string) =>
  sec(["find-generic-password", "-s", service, "-a", account]).exitCode === 0;

export function kcGet(service: string, account: string): string | null {
  const r = sec(["find-generic-password", "-s", service, "-a", account, "-w"]);
  return r.exitCode === 0 ? r.stdout.toString().replace(/\n$/, "") : null;
}

export const kcDelete = (service: string, account: string) =>
  sec(["delete-generic-password", "-s", service, "-a", account]).exitCode === 0;
