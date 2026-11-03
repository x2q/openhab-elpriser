#!/bin/sh
# Compiles and runs the Jayway JsonPath checks (Java 17 or newer). Downloads the jars on first use.
set -eu
cd "$(dirname "$0")"
./fetch-jars.sh >/dev/null
JAVAC=${JAVAC:-javac}; JAVA=${JAVA:-java}
mkdir -p out
"$JAVAC" -cp "lib/*" -d out OhJsonPath.java
"$JAVA" -cp "lib/*:out" OhJsonPath cases.json
