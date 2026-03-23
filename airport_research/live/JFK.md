# JFK — John F. Kennedy International Airport

## Status: LIVE

## Method
GraphQL API operated by PANYNJ (Port Authority of New York & New Jersey).
No authentication required. Returns live wait times for all active terminals.

## Endpoint
```
POST https://api.jfkairport.com/graphql
Content-Type: application/json
```

## Query
```graphql
{ securityWaitTimes(airportCode: "JFK") { checkPoint waitTime terminal } }
```

## Response Shape
```json
{
  "data": {
    "securityWaitTimes": [
      {"checkPoint": "Main ChekPoint", "waitTime": 8, "terminal": "1"},
      {"checkPoint": "Main ChekPoint", "waitTime": 4, "terminal": "1"},
      ...
    ]
  }
}
```

- `waitTime` is **already in minutes** (integer).
- `terminal` is the terminal number as a string ("1", "4", "5", "7", "8").
- `checkPoint` contains a typo in upstream data ("ChekPoint") — preserved as-is.
- ~9 rows across Terminals 1, 4, 5, 7, 8.

## Discovery Notes
- JFK site is Next.js; `api.jfkairport.com/graphql` found in page source.
- GraphQL introspection is disabled (returns FORBIDDEN).
- Field names recovered from validation error messages:
  - `securityWaitTimes` requires `airportCode: String!`
  - Type is `SecurityWaitTimePoint` with fields `checkPoint`, `waitTime`, `terminal`
- Same PANYNJ backend likely serves EWR — worth probing `airportCode: "EWR"`.

## Auth Mode
`LIVE_PUBLIC`
