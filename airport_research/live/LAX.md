# LAX — Los Angeles International Airport

## Status: LIVE

## Method
HTML table scrape — server-rendered Drupal page, no authentication required.

## Endpoint
```
GET https://www.flylax.com/wait-times
```
No API key, no special headers. Standard browser User-Agent works.

## Data Structure
HTML table with columns: **Terminal | Boarding Type | Wait Time**

Example rows:
| Terminal | Boarding Type   | Wait Time  |
|----------|-----------------|------------|
| TBIT     | General Boarding| 7 minutes  |
| TBIT     | TSA PreCheck    | 1 minutes  |

Wait time parsed from "X minutes" string with regex `(\d+(?:\.\d+)?)`.

## Notes
- Only TBIT (Tom Bradley International Terminal) data is currently published.
- Other terminals (1–8) do not appear in the table at time of integration.
- Page includes a "Data Last Updated" timestamp — data is refreshed by LAX staff.
- No JavaScript rendering required; table is in static HTML response.

## Auth Mode
`LIVE_PUBLIC`
