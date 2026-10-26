// Test-only hooks (API/dashboard URLs, browser opener, Keychain service names...) are ignored unless
// SBS_TEST=1, so a stray or planted environment variable cannot redirect tokens somewhere else.
export const testEnv = (name: string): string | undefined => (process.env.SBS_TEST === "1" ? process.env[name] : undefined);

declare const SBS_VERSION: string; // injected at build time (package.json, scripts/build-release.sh)
export const VERSION = typeof SBS_VERSION !== "undefined" ? SBS_VERSION : "0.0.0-dev";
