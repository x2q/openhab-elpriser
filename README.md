# elpriser.org for openHAB

[![Tests](https://github.com/x2q/openhab-elpriser/actions/workflows/tests.yml/badge.svg)](https://github.com/x2q/openhab-elpriser/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Hourly electricity prices from [elpriser.org](https://elpriser.org) in [openHAB](https://www.openhab.org), **without
Java and without a custom binding**: a configuration package for the stock **HTTP binding** with the
**JSONPATH** and **JavaScript (`JS`)** transformations. Things, items, a rule and sitemaps are included.

* **Price now, next hour, today's lowest / highest / average, the cheapest hour, a "cheap hour now" switch,
  the cheapest run of N hours in a row, tomorrow, and the price forecast.**
* **40 price zones**: Denmark (DK1/DK2, optionally with the price you actually pay), the other Nordic zones, the
  Netherlands, most of continental Europe, Great Britain and Ireland.
* **Free, no account, no API key, no telemetry.** One request per hour per Thing (part 2).
* Files go in `conf/`; they also show up in **Main UI** (read-only there, as for every file-based item), and
  Main UI can be used for everything else: see [Main UI](#main-ui).

> **Status: not tested on a running openHAB.** No openHAB runtime was available where this was written.
> What *is* verified, against recordings of the live service and in CI: the JavaScript (all 40 zones,
> daylight saving), every JSONPATH expression with **Jayway JsonPath 2.10.0, the library openHAB's JSONPATH
> transformation uses**, evaluated through a copy of the transformation service's own result handling, and the
> consistency of the files (every item, channel and rule field exists). What is *not*: the `.things` / `.items` /
> `.rules` / `.sitemap` syntax in a live instance and the `JS` transformation in openHAB's GraalJS.
> Written against the openhab-addons documentation of 2026-11-03. Please open an issue if something does not load.

Two ways, pick one (or both):

| | Part 1: plain JSONPATH | Part 2: JS transformation |
| --- | --- | --- |
| Zones | Denmark (DK1, DK2) | all 40 |
| Add-ons | HTTP Binding, JSONPath Transformation | + JavaScript Scripting |
| Rules | none | one small rule |
| Price now | `/api/prices` `current_price`, polled every 5 minutes | worked out from the hourly list at every full hour |
| Next hour, cheapest run, forecast list, units, all zones | no | yes |

## Part 1: Denmark with plain JSONPATH

Copy [`conf/things/elpriser-dk-jsonpath.things`](conf/things/elpriser-dk-jsonpath.things),
[`conf/items/elpriser-dk-jsonpath.items`](conf/items/elpriser-dk-jsonpath.items) and
[`conf/sitemaps/elpriser-dk.sitemap`](conf/sitemaps/elpriser-dk.sitemap). Prices are **DKK/kWh**. Change `DK1` to `DK2`
for Eastern Denmark in every `baseURL`. The price type is `mode=` in the URL:

| `mode` | Price |
| --- | --- |
| `inkl_alt` | spot + Energinet system and transmission tariff + electricity duty + 25 % VAT: "Din pris" without your grid company's tariff |
| `net_inkl_alt` + `&gln=<13 digits>` | **the full price you pay**, with your grid company's tariff (GLN list: <https://elpriser.org/tariffer>, Radius is `5790000705689`) |
| `spot_inkl` / `spot_ex` | the raw spot price with / without VAT |
| `inkl_alt_elvarme`, `net_inkl_alt_elvarme` | with the reduced duty for electrically heated homes |

Channels (items in the `.items` file):

| Item | From | JSONPATH |
| --- | --- | --- |
| `Elpriser_DK_Price_Now` | `/api/prices` | `$.current_price` |
| `Elpriser_DK_Hour` | `/api/prices` | `$.current_hour` (the Danish hour, from the service's clock) |
| `Elpriser_DK_Today_Min` / `_Max` / `_Avg` | `/api/prices` | `$..price.min()` / `.max()` / `.avg()` |
| `Elpriser_DK_Today_Prices` | `/api/prices` | `$.prices[*].price` (24 numbers) |
| `Elpriser_DK_Cheap_Now` (Switch) | `/api/schedule?strategy=cheapest_n&hours=4` | `$.on_now` |
| `Elpriser_DK_Cheap_Hours` | same | `$.schedule[?(@.on == true)].hour` |
| `Elpriser_DK_Cheapest_Hour` | `/api/schedule?...&hours=1` | same expression |
| `Elpriser_DK_Tomorrow_Type` / `_Prices` | `/api/forecast` | `$.days[1].type` / `$.days[1].prices[*].price` |

The switch can use any strategy of the service (`cheapest_n&hours=N`, `cheapest_pct&pct=25`,
`avoid_expensive_n`, `avoid_peak`, `night_cheap`, `smart&max_off=3`, see <https://elpriser.org/automation>).

Limits of part 1: there is no next-hour price (JSONPATH cannot add one to the hour), and `$.days[1]` is tomorrow
only while the cached answer is from today; in the first half hour after midnight it can still be the day before.
Part 2 has neither limit. `$..price.min()` is used because `$.prices[*].price.min()` raises an error in
JsonPath (found while testing).

## Part 2: all zones with the JS transformation

Needs the add-ons **HTTP Binding**, **JSONPath Transformation** and **JavaScript Scripting**.

1. Copy [`conf/transform/elpriser.js`](conf/transform/elpriser.js) to `$OPENHAB_CONF/transform/`.
2. Copy [`conf/things/elpriser.things`](conf/things/elpriser.things), [`conf/items/elpriser.items`](conf/items/elpriser.items),
   [`conf/rules/elpriser.rules`](conf/rules/elpriser.rules), [`conf/sitemaps/elpriser.sitemap`](conf/sitemaps/elpriser.sitemap).
3. In `elpriser.things` set the `baseURL` of your zone (the file lists them), in the items change `DKK` in the labels to
   your zone's currency. Keep `Elpriser_Slots` out of persistence (it holds the price list).

How it works: the Thing fetches **one answer per hour** (today, tomorrow once it is published, the forecast days)
and the channel's `JS(elpriser.js?fn=slots)` turns it into a compact list of one-hour slots with **absolute UTC
times** (the service speaks in local hours, so the script applies each zone's winter offset and the EU
daylight-saving rule; no time zone database is needed). The rule runs at every full hour and when the list
changes: `JS(elpriser.js?fn=summary&cheap=4&horizon=24&run=3&forecast=0)` computes everything for "now", and the
rule spreads the fields to the items with `JSONPATH($.field)`.

| Item | Meaning |
| --- | --- |
| `Elpriser_Price_Now`, `Elpriser_Price_Next` | price per kWh of this / the next hour in the zone's currency (`UNDEF` if unknown) |
| `Elpriser_Level` | `cheap`, `normal`, `expensive`: where the price lies in today's range (lowest third / middle / highest third) |
| `Elpriser_Price_Type` | `actual` (published price) or `forecast` (model) |
| `Elpriser_Today_Min/Max/Avg`, `Elpriser_Cheapest_Hour`, `Elpriser_Priciest_Hour` | today = the zone's calendar day |
| `Elpriser_Cheap_Now` | ON while this hour is one of the **N cheapest of the next H hours** (default 4 of 24) |
| `Elpriser_Cheap_Next_Start`, `Elpriser_Cheap_Forecast` | next cheap hour; ON if a chosen hour is a model forecast |
| `Elpriser_Run_Start/End/Avg/Now` | the cheapest **run of R hours in a row** (default 3), e.g. for a washing machine |
| `Elpriser_Tomorrow_Published` | ON once tomorrow's day-ahead prices are out (about 13:00 CET) |
| `Elpriser_Forecast_JSON` | `[{"start","price","type"}]` for the next 48 hours, for scripts and charts |
| `Elpriser_Unit`, `Elpriser_Stale` | e.g. `DKK/kWh`; ON if the last complete hour is shown (Great Britain) |

Arguments of the script (edit them in `elpriser.rules`): `cheap`, `horizon` (or `scope=today`: the zone's calendar
day, as in "one of today's 4 cheapest hours", this equals the service's own `/api/schedule`), `run`, `forecast=0|1`,
`maxprice`, `cur=eur` (on `fn=slots`: EUR instead of the zone's currency), `hours`/`from=now|today` (on `fn=list`),
`at=<ISO 8601>` (pretend it is that moment). Unknown or missing values become `UNDEF`, hours without a price are skipped.

**Forecast.** `forecast=0` (default) only lets *published* prices decide, so "cheap hour now" is reliable.
`forecast=1` adds elpriser.org's statistical model for the hours that are not published yet. **That is not an
official forecast**: it ranks the cheapest hours better than it hits the price level, the error grows with the
horizon, and each hour is replaced by the settled price when it is published (about 13:00 CET for the next day).
Model and accuracy: <https://elpriser.org/prognose>. There is no model for `gb` and `xk`.

### Prices

Outside Denmark the price is the **wholesale (day-ahead) price without VAT, taxes and grid fees**, converted to the
zone's currency with the ECB reference rate (or EUR with `cur=eur`). Denmark can be the full consumer price, see
part 1. Great Britain is the within-day Market Index Price in GBP, not a day-ahead price: an hour is only priced once
it is over, so `Elpriser_Price_Now` shows the last complete hour (up to three hours old, `Elpriser_Stale` ON) and
`Elpriser_Price_Next` is `UNDEF`. Portugal and Ireland lack the price of the last hour of a published day.

## Main UI

Everything can also be created in the UI: **Settings > Things > + > HTTP Binding > HTTP URL**, set the *Base URL*
and refresh, add a channel of the item type you need, and enter the `stateTransformation` from the `.things`
file (for example `JS(elpriser.js?fn=slots)` or `JSONPATH($.current_price)`) and set the channel's *mode* to read-only.
Create the items from the channels ("Add Equipment to Model" or the channel's *Add Link to Item*). The rule can be
pasted as a *Rule DSL* file, or used as a template for a Main UI script rule. `.things` and `.items` files in `conf/`
appear in Main UI too, but cannot be edited there.

## API etiquette

elpriser.org is a free service, edge-cached for 30-60 minutes. Part 2 polls once an hour (`refresh=3600`) with a
`User-Agent` of `openhab-elpriser/<version>`; `/api/now`, `/api/prices` and `/api/schedule` of part 1 are cached up to the
next full hour, so `refresh=300` costs the origin nothing. Please do not poll faster. Nothing is sent but the zone
(and for Denmark price type and GLN).

## Data sources and licences

Prices come from Energi Data Service (Energinet), ENTSO-E, Energy-Charts, SEMOpx and Elexon via elpriser.org. Zones taken
from Bundesnetzagentur | SMARD.de via Energy-Charts.info are CC BY 4.0 (hourly means of the 15-minute prices, changed);
`gb` is *Contains BMRS data © Elexon Limited copyright and database right <year>*. See <https://elpriser.org>.

## Why not a Java binding?

Not worth it. A native binding would have to live in openhab-addons (Java 17, Maven, thing handlers, i18n, config
descriptions, a review process of months) to do what one HTTP Thing and one script file of about 200 lines already do, and it
would need an openHAB runtime for every change. The HTTP route works on every installation without an add-on from
this project and is easy to read and change. A binding only makes sense if the service later offers something the
HTTP binding cannot do (push updates, discovery of the grid company from the address).

## Development

```bash
npm test                    # the JS transformation (all zones, DST, summary, list) and consistency of the conf files
sh test/jsonpath/run.sh     # every JSONPATH expression with Jayway JsonPath 2.10.0 (Java 17+; downloads the jars, SHA-1 checked)
npm run test:live           # against the live service: JSONPATH and the script for all 40 zones
npm run fixtures            # regenerate test/fixtures/summary-*.json after changing the script
```

`test/fixtures` are recorded live answers (2026-11-03). MIT licensed. Issues: <https://github.com/x2q/openhab-elpriser/issues>.
Not affiliated with openHAB.

---

*Kort på dansk:* Elpriser.org i openHAB uden Java: HTTP-bindingen med JSONPATH (del 1, kun Danmark, ingen regler) eller
med JS-transformationen (del 2, alle 40 prisområder: pris nu og næste time, billigste timer, billigste sammenhængende
vindue, prognose). Kopiér filerne fra `conf/` til openHAB. Prognosetimerne er en statistisk model, ikke en officiel
prognose. Pakken er testet mod den levende API og mod Jayway JsonPath (samme bibliotek som openHAB), men **ikke på en
kørende openHAB**.
