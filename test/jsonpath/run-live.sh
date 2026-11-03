#!/bin/sh
# The Denmark JSONPATH expressions against the LIVE service (needs network and Java 17+).
set -eu
cd "$(dirname "$0")"
./fetch-jars.sh >/dev/null
JAVAC=${JAVAC:-javac}; JAVA=${JAVA:-java}
mkdir -p out live
UA="openhab-elpriser-tests"
B=https://elpriser.org/api
curl -fsS -A "$UA" "$B/prices?area=DK1&mode=inkl_alt" -o live/prices.json
curl -fsS -A "$UA" "$B/schedule?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=4" -o live/sched.json
curl -fsS -A "$UA" "$B/schedule?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=1" -o live/sched1.json
curl -fsS -A "$UA" "$B/forecast?area=DK1&mode=inkl_alt" -o live/forecast.json
"$JAVAC" -cp "lib/*" -d out OhJsonPath.java
"$JAVA" -cp "lib/*:out" OhJsonPath cases-live.json live
