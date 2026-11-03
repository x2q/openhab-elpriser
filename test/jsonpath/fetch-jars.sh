#!/bin/sh
# Downloads the Jayway JsonPath jars openHAB's JSONPATH transformation uses (json-path 2.10.0 and its
# dependencies) from Maven Central into ./lib and verifies the SHA-1 published next to each jar.
set -eu
cd "$(dirname "$0")"
mkdir -p lib
M=https://repo1.maven.org/maven2
for a in \
  com/jayway/jsonpath/json-path/2.10.0/json-path-2.10.0.jar \
  net/minidev/json-smart/2.5.1/json-smart-2.5.1.jar \
  net/minidev/accessors-smart/2.5.1/accessors-smart-2.5.1.jar \
  org/ow2/asm/asm/9.6/asm-9.6.jar \
  org/slf4j/slf4j-api/2.0.11/slf4j-api-2.0.11.jar
do
  f=lib/$(basename "$a")
  [ -f "$f" ] || curl -fsSL "$M/$a" -o "$f"
  want=$(curl -fsSL "$M/$a.sha1" | cut -c1-40)
  got=$(shasum -a 1 "$f" | cut -c1-40)
  [ "$want" = "$got" ] || { echo "checksum mismatch for $f" >&2; rm -f "$f"; exit 1; }
done
echo "jars ok"
