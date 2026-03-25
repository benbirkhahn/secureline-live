# SEA — Seattle-Tacoma International Airport

## Status: LIVE

## Method
Port of Seattle custom Drupal module (`pos_cwt_widget`) exposes a clean public JSON API.
No authentication required. Auto-refreshes every 5 minutes per the widget JS.

## Endpoint
```
GET https://www.portseattle.org/api/cwt/wait-times
```

## Response Shape
```json
[
  {
    "CheckpointID": 1,
    "Name": "1",
    "Order": 1,
    "IsOpen": true,
    "WaitTimeMinutes": 3,
    "PreCheck": 1,
    "IsDataAvailable": true,
    "MinutesTillInvalid": 8,
    "MinutesSinceLastUpdate": 0,
    "QueueLength": 11,
    "Options": [
      {"Name": "General",    "Availability": "Available"},
      {"Name": "Pre",        "Availability": "Available"},
      {"Name": "Clear",      "Availability": "Available"},
      {"Name": "Spot Saver", "Availability": "Not Available"},
      {"Name": "Premium",    "Availability": "Not Available"},
      {"Name": "Visitor Pass","Availability": "Not Available"}
    ],
    "LastUpdated": "/Date(1774394580987)/"
  }
]
```

- 6 checkpoints total (1–6). `IsOpen` and `IsDataAvailable` indicate active status.
- `WaitTimeMinutes` is a single value per checkpoint (not per lane).
- Lane availability is per `Options[].Availability` — values: "Available", "Only", "Not Available".
- `"Pre"` in Options maps to TSA PreCheck; `"Clear"` maps to CLEAR.
- `QueueLength` = number of people currently in queue.
- `LastUpdated` uses WCF JSON date format: `/Date(<ms-since-epoch>)/`

## Discovery Notes
- Discovered via fromthetraytable.com source URL mapping — they scrape this same endpoint.
- Widget JS found at `/modules/custom/pos_cwt_widget/js/pos_cwt.js` — reveals the endpoint and refresh logic.
- Data confirmed live: different checkpoints show different wait times and open/closed states.

## Auth Mode
`LIVE_PUBLIC`

## Lane Type Strategy
Per checkpoint, we emit one row per distinct canonical lane type found in `Options[]`:
- "Pre" → PRECHECK
- "Clear" → CLEAR
- "General" / "Premium" / "Spot Saver" / "Visitor Pass" → STANDARD (deduplicated)
All rows for a checkpoint share the same `WaitTimeMinutes`.
