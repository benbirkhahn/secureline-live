# Detroit Metropolitan Airport (DTW)

**Status:** Live

**Data Source:**
- Endpoint: `https://proxy.metroairport.com/SkyFiiTSAProxy.ashx`
- Auth: None (Public API)
- Response Structure: Simple JSON array of objects, e.g., `[{"Name": "Evans", "WaitTime": 3}, {"Name": "McNamara", "WaitTime": 0}]`

**Notes:**
- A very simple implementation. It just requires the `origin` and `referer` headers to not get blocked.
