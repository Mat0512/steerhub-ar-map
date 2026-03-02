# Hackathon AR Building Map — Plan

## Overview

Static web app. QR codes placed at junctions/floors around the building.
Each QR encodes a URL with `?from=location-id`. Scanning with the phone's
native camera opens the app in the browser, shows the live camera feed, and
draws directional arrows on a canvas overlay pointing toward all key
hackathon destinations. No app install, no backend, works on any phone.

---

## How It Works (user flow)

```
Participant sees QR on wall
        ↓
Scans with phone camera (native, no in-app scan needed)
        ↓
Browser opens  →  https://your-domain.com/?from=lobby
        ↓
App asks: camera permission + compass permission (iOS only)
        ↓
Camera feed fills screen
Canvas overlay draws arrows + labels pointing to destinations
Arrows rotate as user physically turns (compass heading)
        ↓
Tap an arrow → shows floor, walking hint, distance estimate
```

---

## Tech Stack

| Concern          | Solution                                     |
|------------------|----------------------------------------------|
| Camera feed      | `getUserMedia({ video: { facingMode: 'environment' } })` |
| AR overlay       | `<canvas>` on top of `<video>` (CSS absolute) |
| Compass heading  | `DeviceOrientationEvent` (alpha channel)     |
| Map data         | Static `map.json` bundled with the page      |
| QR codes         | Pre-generated PNGs (any QR generator)        |
| Hosting          | Vercel / GitHub Pages (free, HTTPS required) |
| Framework        | Vanilla HTML + CSS + JS — zero build step    |

---

## File Structure

```
hackathon-ar-map/
├── index.html        ← single page, all UI lives here
├── style.css         ← fullscreen camera + overlay styling
├── app.js            ← camera, compass, arrow drawing
├── map.js            ← bearing math, route lookup helpers
├── data/
│   └── map.json      ← all locations, destinations, routes
├── qr-codes/         ← generated QR PNG files (one per location)
│   ├── lobby.png
│   ├── floor1-hall.png
│   └── ...
└── README.md         ← deployment + QR placement instructions
```

---

## Building Floor Layout

### Floor 5 — Main Event Floor
| Zone | Location | Notes |
|------|----------|-------|
| Registration | Near elevator & stairs | First stop for all participants |
| Hackathon Hall | Main hall | Primary hacking area |
| Food & Drinks | Main hall | Co-located with hackathon space |

### Floor 4 — Pitching Floor *(location TBD)*
| Zone | Location | Notes |
|------|----------|-------|
| Event Pitching | 1 room/hall | Exact room to be confirmed |

---

## Data Format (`map.json`)

```json
{
  "destinations": [
    { "id": "registration", "name": "Registration",    "floor": 5, "hint": "Floor 5 — near elevator & stairs" },
    { "id": "hackspace",    "name": "Hack Space",       "floor": 5, "hint": "Floor 5 — main hall" },
    { "id": "food",         "name": "Food & Drinks",    "floor": 5, "hint": "Floor 5 — inside main hall" },
    { "id": "pitching",     "name": "Event Pitching",   "floor": 4, "hint": "Floor 4 — room/hall TBC" }
  ],
  "locations": {
    "floor5-elevator": {
      "name": "Floor 5 — Elevator / Stairs",
      "floor": 5,
      "routes": {
        "registration": { "bearing": 0,   "distance": "10m",  "steps": "Straight ahead from elevator/stairs — Registration desk" },
        "hackspace":     { "bearing": 0,   "distance": "30m",  "steps": "Continue past registration → enter main hall" },
        "food":          { "bearing": 0,   "distance": "30m",  "steps": "Continue past registration → food area inside main hall" },
        "pitching":      { "bearing": 180, "distance": "1 fl", "steps": "Take elevator/stairs down to Floor 4" }
      }
    },
    "floor5-hall": {
      "name": "Floor 5 — Main Hall",
      "floor": 5,
      "routes": {
        "registration": { "bearing": 180, "distance": "20m",  "steps": "Head back toward elevator/stairs — Registration near entrance" },
        "food":          { "bearing": 90,  "distance": "15m",  "steps": "Food area within the hall — bearing TBC on-site" },
        "pitching":      { "bearing": 180, "distance": "1 fl", "steps": "Exit hall → elevator/stairs → Floor 4" }
      }
    },
    "floor4-entrance": {
      "name": "Floor 4 — Elevator / Stairs",
      "floor": 4,
      "routes": {
        "pitching":      { "bearing": 0,   "distance": "TBC",  "steps": "Room/hall TBC — bearing to be measured on-site" },
        "registration":  { "bearing": 0,   "distance": "1 fl", "steps": "Take elevator/stairs up to Floor 5" },
        "hackspace":     { "bearing": 0,   "distance": "1 fl", "steps": "Take elevator/stairs up to Floor 5 → main hall" }
      }
    }
  }
}
```

> **Note:** Bearings marked "TBC" must be measured on-site once the pitching room on Floor 4 is confirmed.

**Bearing** = compass bearing (0–359°, true north) measured from that QR location
toward each destination. Organizers measure this once when placing QR codes
using any compass app.

---

## Key Components

### 1. Camera Setup
```
getUserMedia({ video: { facingMode: 'environment' } })
  → pipe into <video> element (muted, playsInline, autoplay)
  → <canvas> sits on top (position: absolute, same size)
  → canvas redraws at ~30fps via requestAnimationFrame
```

### 2. Compass Integration
```
Android  → DeviceOrientationEvent fires automatically
iOS 13+  → must call DeviceOrientationEvent.requestPermission()
           inside a user gesture (tap-to-start button)

event.alpha = compass heading in degrees (0 = points to North)
```

### 3. Arrow Direction Math
```
rawAngle = destination.bearing - compassHeading
Normalise to [-180, 180] to get shortest rotation

Arrow on canvas is drawn at rawAngle relative to "up" (camera forward).
As user rotates their phone, compassHeading changes → arrow rotates
to always point toward the destination in the real world.
```

### 4. Arrow Drawing (Canvas 2D)
- Large circle at bottom-center of screen per destination
- Arrow inside pointing toward destination
- Destination name above, floor / hint below
- Multiple destinations = multiple circles spread along the bottom
- Tap a circle to expand into a detail card (steps text)

### 5. No-Location Fallback
When URL has no `?from=` param (e.g. someone just visits the domain):
- Show a simple list of all QR locations with their names
- Useful as an index page / backup directory

---

## Phases

### Phase 1 — Static MVP  *(~1 day)*
- [ ] Camera feed fullscreen on mobile
- [ ] Parse `?from=` param, load `map.json`
- [ ] Show destination list (no compass yet — fixed arrow pointing "forward")
- [ ] Tap to see step-by-step text directions
- [ ] Responsive layout tested on iOS Safari + Android Chrome

### Phase 2 — Live Compass Arrows  *(+half day)*
- [ ] `DeviceOrientationEvent` integration
- [ ] iOS permission request button
- [ ] Arrows rotate smoothly as user turns
- [ ] Compass permission denied fallback (show text directions only)

### Phase 3 — Polish & Deploy  *(+half day)*
- [ ] Generate QR PNGs for each location (script or online tool)
- [ ] Print-ready QR sheets with location label below each code
- [ ] Add hackathon branding (logo, event name, colours)
- [ ] PWA manifest + service worker → works offline once loaded
- [ ] Deploy to Vercel or GitHub Pages

---

## QR Code URLs

```
https://your-domain.com/?from=floor5-elevator   ← place at elevator/stairs exit on Floor 5
https://your-domain.com/?from=floor5-hall        ← place inside the main hall on Floor 5
https://your-domain.com/?from=floor4-entrance    ← place at elevator/stairs exit on Floor 4
```

Each QR code printed on A5 paper with the location name below it.
Laminate if possible — placed at eye level at each junction.

**Bearing measurement guide for organizers:**
1. Stand at the QR code location facing the printed arrow (or any reference)
2. Open a compass app
3. Turn to face each destination
4. Record the compass heading → that is the `bearing` value in `map.json`

---

## Platform Notes

| Issue | Detail |
|-------|--------|
| HTTPS required | Both `getUserMedia` and `DeviceOrientationEvent` need a secure origin |
| iOS compass | Requires `DeviceOrientationEvent.requestPermission()` inside a tap handler |
| Android compass | Works automatically — no permission needed |
| Camera permission | Standard browser prompt — user must allow on first visit |
| Offline | Service worker caches `map.json` + assets after first load |
| No QR scanning in-app | Native phone camera handles it — simpler, no jsQR needed |

---

## Estimated Build Time

| Phase | Time |
|-------|------|
| Phase 1 (MVP) | ~6–8 hours |
| Phase 2 (Compass) | ~3–4 hours |
| Phase 3 (Polish + deploy) | ~3–4 hours |
| **Total** | **~1.5–2 days** |

Organizer setup (placing QR codes + measuring bearings): ~1–2 hours on-site.
