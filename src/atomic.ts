// Write a secret file so readers never see it half-written or world-readable: 0600 tmp in the same dir, fsync, rename.
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";

export function writeFileAtomic(path: string, data: string) {
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    unlinkSync(tmp);
    throw e;
  }
  closeSync(fd);
  renameSync(tmp, path);
}
