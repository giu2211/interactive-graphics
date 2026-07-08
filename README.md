# Where No One Has Gone Before: GGame

An interactive 3D game built with [Three.js](https://threejs.org/) (r128) for the Interactive Graphics course. You drive a rover across a procedurally generated Mars surface, collect emerald crystals, load red boulders onto a rocket's cargo pad and, once both goals are met, watch the ship lift off — leaving "MISSION ACCOMPLISHED" written in the stars as a brand-new constellation.

## Running the game

No build step. Everything runs client-side from three files:

```
index.html      page, styles, HUD and menu markup
GGame.js        the whole game (~1,900 commented lines)
three.min.js    Three.js r128, local copy
soundtrack.mp3  looped music (key M)
```

Open `index.html` in a browser, or serve the folder locally for guaranteed audio behaviour:

```
python -m http.server
# then visit http://localhost:8000
```

## The mission

Pick a difficulty on the start screen, press ▶ and go:

| Goal | EASY | HARD |
|---|---|---|
| Crystals to collect | 10 | 17 |
| Red rocks to load on the pad | 5 | 12 |
| Mission timer | 5 minutes | 5 minutes |

Purple gold-veined boulders can't be moved — blast them with the laser (F); about half hide 1–3 crystals, collected by driving over them. Ordinary red boulders can be grabbed, carried, dropped or thrown; bring them to the glowing red disc at the foot of the rocket's ramp. **The first rock loaded onto the pad arms the 5-minute timer**, so scout crystals first. Complete both goals and the 3·2·1 countdown starts the launch; run out of time and the mission fails.

## Controls

| Key | Action |
|---|---|
| ◀ ▲ ▼ ▶ | Drive the rover |
| 1 / 2 | Tilt the head up / down |
| 9 / 0 | Pan the head left / right |
| P | Grab a red rock |
| O | Drop the carried rock |
| T | Throw the carried rock |
| F | Fire the laser at purple rocks (not while carrying) |
| SPACE | Jump rockets (from the ground, hands free) |
| C | Toggle chase camera / rover's eye view |
| L | Toggle headlights |
| M | Toggle the soundtrack |
| R | Reset the rover pose (mission progress is kept) |
| V | Demo shortcut — skip straight to the countdown, lift-off and victory constellation |

## HUD and navigation

Counters for crystals (green, top-right) and rocket cargo (orange, below it) appear as soon as they become relevant; the mission timer sits top-centre and turns red in the last thirty seconds. **Just below the timer is the rocket compass**: a small arrow over the distance in metres that always points toward the launch pad. It rotates against the rover's heading — "up" always means "straight ahead" — dims once you're within a few metres of the pad, and disappears at lift-off. As a scenic backup, the constellations (Big and Little Dipper, Polaris) are fixed toward north.

## Features at a glance

- Procedural Mars terrain with height-mapped driving — no physics engine, just terrain lookup
- Rover with animated head, arms, chassis bounce, headlights and two camera views
- Two rock types: crossable small rocks (with speed-scaled jolts) and blocking boulders
- Laser shooting with debris, crystals that spin, bob and burst when collected
- Grab / carry / drop / throw mechanics with reach easing
- Retro rocket with cargo pad, status lamps, countdown and a slow, majestic launch arc
- Victory text rendered as a twinkling yellow star constellation in the 3D sky
- Rocket compass HUD — bearing computed with `atan2`, applied as a plain CSS rotation
- EASY / HARD modes, mission timer, Star Trek soundtrack

Full design and implementation details are in `GGame_Technical_Document.docx`.
