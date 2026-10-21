#!/bin/sh
# Downloads the two programs the rule proofs need, into tools/prover (not committed), and checks their fingerprints:
#  - Cedar's command-line tool, experimental build with the "symcc" proof commands (cedar-policy-cli v4.14.0)
#  - the cvc5 solver those commands call (v1.4.2)
# Linux x86_64 only (WSL and the GitHub runners are both that).
set -eu
DIR="${PROVER_DIR:-tools/prover}"
CEDAR_SHA=b4088036da7f783fbbca394a2018ccba4ea155a4b03f7487dd4d3897ec5b0194
CVC5_SHA=7eb18f8c814c36a46c5a7d003983e9cfbc4b0a9828d6dd596239291bd4cc61d8
mkdir -p "$DIR"
check() { echo "$2  $1" | sha256sum -c - >/dev/null || { echo "fingerprint mismatch for $1" >&2; rm -f "$1"; exit 1; }; }
if [ ! -x "$DIR/cedar" ]; then
  curl -fsSL -o "$DIR/cedar.tar.xz" https://github.com/cedar-policy/cedar/releases/download/cedar-policy-cli-v4.14.0/cedar-policy-cli-experimental-x86_64-unknown-linux-gnu.tar.xz
  check "$DIR/cedar.tar.xz" "$CEDAR_SHA"
  tar -xf "$DIR/cedar.tar.xz" -C "$DIR" --strip-components=1 && rm "$DIR/cedar.tar.xz"
fi
if [ ! -x "$DIR/cvc5" ]; then
  curl -fsSL -o "$DIR/cvc5.zip" https://github.com/cvc5/cvc5/releases/download/cvc5-1.4.2/cvc5-Linux-x86_64-static.zip
  check "$DIR/cvc5.zip" "$CVC5_SHA"
  python3 -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extract('cvc5-Linux-x86_64-static/bin/cvc5', sys.argv[2])" "$DIR/cvc5.zip" "$DIR/x"
  mv "$DIR/x/cvc5-Linux-x86_64-static/bin/cvc5" "$DIR/cvc5" && chmod +x "$DIR/cvc5" && rm -rf "$DIR/x" "$DIR/cvc5.zip"
fi
"$DIR/cvc5" --version | head -1
"$DIR/cedar" language-version
