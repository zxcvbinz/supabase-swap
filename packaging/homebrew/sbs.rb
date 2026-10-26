class Sbs < Formula
  desc "Swap Supabase CLI accounts and projects from the terminal"
  homepage "https://github.com/zxcvbinz/supabase-swap"
  version "@VERSION@"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/zxcvbinz/supabase-swap/releases/download/v@VERSION@/sbs-@VERSION@-darwin-arm64.tar.gz"
      sha256 "@SHA256_ARM64@"
    end
    on_intel do
      url "https://github.com/zxcvbinz/supabase-swap/releases/download/v@VERSION@/sbs-@VERSION@-darwin-x64.tar.gz"
      sha256 "@SHA256_X64@"
    end
  end

  def install
    bin.install "sbs"
  end

  def caveats
    <<~EOS
      sbs drives Google Chrome at runtime: Google Chrome must be installed.
      The Supabase CLI is recommended:
        brew install supabase/tap/supabase
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/sbs --version")
  end
end
