#!/usr/bin/env bash
# Build darwin arm64 + x64 binaries, ad-hoc sign, package and checksum into dist/release/.
# Usage: scripts/build-release.sh [version]   (default: version.txt / manifest)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-}"
if [ -z "$VERSION" ] && [ -f version.txt ]; then
  VERSION="$(tr -d '[:space:]' < version.txt)"
fi
if [ -z "$VERSION" ]; then
  VERSION="$(sed -n 's/.*"\.": *"\([^"]*\)".*/\1/p' .release-please-manifest.json | head -n1)"
fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]]; then
  echo "invalid version: '$VERSION'" >&2
  exit 1
fi

OUT="$ROOT/dist/release"
rm -rf "$OUT"
mkdir -p "$OUT"

for arch in arm64 x64; do
  stage="$OUT/stage-$arch"
  mkdir -p "$stage"
  bun build "${SBS_ENTRY:-src/index.ts}" --compile \
    --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
    --target="bun-darwin-$arch" \
    --external chromium-bidi --external electron \
    --define "SBS_VERSION=\"$VERSION\"" \
    --outfile "$stage/sbs"
  if command -v codesign >/dev/null 2>&1; then
    codesign --sign - --force "$stage/sbs"
  fi
  chmod 755 "$stage/sbs"
  tar -czf "$OUT/sbs-$VERSION-darwin-$arch.tar.gz" -C "$stage" sbs
done

(
  cd "$OUT"
  shasum -a 256 "sbs-$VERSION-darwin-arm64.tar.gz" "sbs-$VERSION-darwin-x64.tar.gz" > checksums.txt
)
rm -rf "$OUT/stage-arm64" "$OUT/stage-x64"

ls -lh "$OUT"
cat "$OUT/checksums.txt"
