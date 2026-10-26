#!/usr/bin/env bash
# Installer for sbs (supabase-swap): curl --proto '=https' --tlsv1.2 -fsSL <raw url>/scripts/install.sh | bash
# Everything runs inside main(), called on the last line, so a truncated download executes nothing.
# Env: SBS_VERSION (e.g. 0.1.0, default latest), SBS_INSTALL_DIR (default ~/.local/bin)
set -euo pipefail

REPO="zxcvbinz/supabase-swap"
INSTALL_DIR="${SBS_INSTALL_DIR:-$HOME/.local/bin}"

die() { echo "error: $*" >&2; exit 1; }

main() {
  [ "$(uname -s)" = "Darwin" ] || die "sbs currently supports macOS only (detected: $(uname -s))."

  case "$(uname -m)" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64) ARCH="x64" ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac

  command -v curl >/dev/null 2>&1 || die "curl is required"
  command -v shasum >/dev/null 2>&1 || die "shasum is required"

  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  VERSION="${SBS_VERSION:-}"
  if [ -z "$VERSION" ]; then
    LOCATION="$(curl --proto '=https' --tlsv1.2 -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")" \
      || die "could not resolve latest release"
    VERSION="${LOCATION##*/v}"
  fi
  VERSION="${VERSION#v}"
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]] || die "invalid version: $VERSION"

  ARCHIVE="sbs-$VERSION-darwin-$ARCH.tar.gz"
  BASE="https://github.com/$REPO/releases/download/v$VERSION"

  echo "Downloading sbs $VERSION ($ARCH)..."
  curl --proto '=https' --tlsv1.2 -fsSL -o "$TMP/$ARCHIVE" "$BASE/$ARCHIVE" || die "download failed: $BASE/$ARCHIVE"
  curl --proto '=https' --tlsv1.2 -fsSL -o "$TMP/checksums.txt" "$BASE/checksums.txt" || die "download failed: checksums.txt"

  EXPECTED="$(awk -v f="$ARCHIVE" '$2 == f { print $1 }' "$TMP/checksums.txt")"
  [ -n "$EXPECTED" ] || die "no checksum listed for $ARCHIVE"
  ACTUAL="$(shasum -a 256 "$TMP/$ARCHIVE" | awk '{ print $1 }')"
  [ "$EXPECTED" = "$ACTUAL" ] || die "checksum mismatch for $ARCHIVE (expected $EXPECTED, got $ACTUAL)"
  echo "Checksum OK."

  mkdir "$TMP/x"
  tar -xzf "$TMP/$ARCHIVE" -C "$TMP/x"
  [ -f "$TMP/x/sbs" ] || die "archive does not contain sbs"

  mkdir -p "$INSTALL_DIR"
  # rm then cp: macOS kills a signed binary overwritten in place.
  rm -f "$INSTALL_DIR/sbs"
  cp "$TMP/x/sbs" "$INSTALL_DIR/sbs"
  chmod 755 "$INSTALL_DIR/sbs"

  echo "Installed $INSTALL_DIR/sbs"
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *) echo "Note: add $INSTALL_DIR to your PATH." ;;
  esac
  echo "Requires Google Chrome; the Supabase CLI is recommended (brew install supabase/tap/supabase)."
}

main "$@"
