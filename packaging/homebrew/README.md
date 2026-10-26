# Homebrew distribution

`sbs.rb` is a template. The release workflow replaces `@VERSION@`, `@SHA256_ARM64@`
and `@SHA256_X64@` and pushes the result to `Formula/sbs.rb` in the tap repo.

## One-time setup

1. Create the public repo `zxcvbinz/homebrew-tap` (the `homebrew-` prefix is required)
   with a `Formula/` directory (add a README so the default branch exists).
2. Create an SSH deploy key that can write to the tap only:

       ssh-keygen -t ed25519 -N "" -C "supabase-swap release" -f tap_key
       gh repo deploy-key add tap_key.pub --repo zxcvbinz/homebrew-tap --allow-write --title "supabase-swap release"
       gh secret set HOMEBREW_TAP_DEPLOY_KEY --repo zxcvbinz/supabase-swap < tap_key
       rm tap_key tap_key.pub

   The key can push to `zxcvbinz/homebrew-tap` and nothing else.
3. The release assets must be downloadable without authentication, so the
   main repo has to be public before users can `brew install`.

## Releasing

Merge conventional commits to `main`; release-please opens a release PR. Merging it
tags `vX.Y.Z`, builds the macOS binaries, uploads them with `checksums.txt`, and
updates the tap.

**First release only:** `release-please-config.json` pins `"release-as": "0.2.0"`. Remove that
line right after the first release is published, or every later release will be forced to 0.2.0.

## Installing (users)

    brew install zxcvbinz/tap/sbs

Without Homebrew:

    curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/zxcvbinz/supabase-swap/vX.Y.Z/scripts/install.sh | bash

Replace `vX.Y.Z` with a release tag (pinning beats `main`).
