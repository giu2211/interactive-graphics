# GGame: Where No One Has Gone Before 🚀

*A Mars rover adventure built from scratch in Three.js*

Author: **Giulia Grossi** · July 2026

## ▶ Play it now

**Live demo (GitHub Pages): **

No installation, no build step: the game runs entirely in the browser.
To run it locally, just open `index.html` (any modern browser; a local
server such as `python3 -m http.server` is recommended so the audio
file loads without restrictions).

## The game

You drive a small tracked rover across an endless procedural Mars:
dunes, craters, boulders, and a night sky with a couple of real constellations. 
The mission:

1. **Collect crystals** — hidden inside rare purple, gold-veined
   boulders (about half of them hide 1–3 crystals). These can't be
   moved: blast them with the laser (`F`) and drive over the freed
   crystals.
2. **Load red rocks** — grab ordinary red boulders (`P`), carry them
   to the glowing pad at the foot of the rocket and drop them (`O`)
   or throw them (`T`) onto it.

The first loaded rock arms a **5-minute timer**. 
Complete both goals before it runs out and the rocket lifts
off — *Mission Accomplished*, written in the stars as a brand-new
constellation. Run out of time and it's **TIME'S UP!** — the game
returns to the menu.

| Mode | Crystals | Red rocks | Timer |
| ---- | -------- | --------- | ----- |
| EASY | 10 | 5 | 5 min |
| HARD | 17 | 12 | 5 min |

## Controls

| Key | Action |
| --- | ------ |
| ◀ ▲ ▼ ▶ | Drive |
| 1 / 2 | Tilt the head up / down |
| 9 / 0 | Pan the head left / right |
| P | Grab the red boulder in front of the rover |
| O | Drop the carried boulder (on the pad: load it into the rocket) |
| T | Throw the carried boulder on a ballistic arc |
| F | Fire the laser at the purple boulders (hands must be free) |
| SPACE | Jump rockets: a ballistic hop under Mars gravity  |
| C | Toggle chase camera / first-person eye camera |
| L | Toggle the headlights |
| M | Toggle the soundtrack |
| R | Reset the rover pose (mission progress is kept) |
| V | Demo shortcut: skip straight to the countdown, lift-off and victory constellation |

## HUD and navigation

Counters for crystals (green, top-right) and rocket cargo (orange,
below it) appear as soon as they become relevant; the mission timer
sits top-centre and turns red in the last thirty seconds. Just below
the timer is the **rocket compass**: an arrow over the distance in
metres that always points toward the launch pad. It rotates against
the rover's heading "up" always means "straight ahead" dims once
you're within a few metres of the pad, and disappears at lift-off.
As a scenic backup, the constellations (Big and Little Dipper,
Polaris) are fixed toward north.

## Features at a glance

- Procedural Mars terrain with height-mapped driving, no physics
  engine, just terrain lookup
- Rover with animated head, arms, chassis bounce, headlights and
  two camera views
- Two rock types: crossable small rocks (with speed-scaled jolts)
  and blocking boulders
- Laser shooting with debris; crystals that spin, bob and burst
  when collected
- Grab / carry / drop / throw mechanics with reach easing
- Retro rocket with cargo pad, status lamps, countdown and a slow,
  majestic launch arc
- Victory text rendered as a twinkling yellow star constellation
  in the 3D sky
- Rocket compass HUD:— bearing computed with `atan2`, applied as
  a plain CSS rotation
- EASY / HARD modes, mission timer, Star Trek soundtrack

## Course requirements → where they live

- **Hierarchical models** — the rover is a deep hierarchy of
  `THREE.Group` joints (treads, chassis, arms with shoulder–arm–hand
  chains, neck, head, eye pods, first-person camera). All its
  animations exploit the structure: aiming the head moves both eyes
  and the eye camera; scaling a shoulder stretches the whole arm;
  a carried rock is re-parented into the chassis with `attach()`.
- **Lights** - a directional "sun", an ambient fill, and two
  toggleable headlight `SpotLight`s parented to the chassis.
- **Textures of different kinds** — six procedural maps of four
  kinds, all generated on canvases at load time: color and normal
  maps for the terrain (the normal map is *computed* from a height
  canvas by finite differences), a bump map for the rocks, and
  color + metalness maps for the purple boulders.
- **User interaction** — thirteen keys and four menu buttons,
  including the brief's own examples: lights on/off (`L`),
  viewpoint change (`C`, head aiming), difficulty selection
  (EASY / HARD on the start screen).
- **Animations** — everything is hand-written JavaScript: the
  hierarchy animations above, plus ballistic throws and jumps under
  Mars gravity (3.71 m/s²), rocks rolling downhill with Coulomb
  friction, debris bursts, the launch state machine. **No models,
  animations or physics engines were imported.**

## Repository layout

```
index.html                      page, HUD and menu (HTML/CSS)
GGame.js                        the whole game (~1,900 commented lines)
three.min.js                    Three.js r128 — local copy 
soundtrack.mp3                  background music (looped, toggle with M)
GGame_Technical_Document.docx   technical presentation + user manual
GGame_Presentation.pptx         slide deck for the project presentation
README.md                       this file
```

## Not developed by the author

- **Three.js r128** (rendering library) included as a local minified copy.
- **soundtrack.mp3** (background music track).

Everything else as geometry, textures, animations, physics and gameplay 
is original code. No 3D models were downloaded or made in external
modelers: every object is assembled from Three.js primitives.

## Documentation

The full **technical presentation and user manual** is in
[`GGame_Technical_Document.pdf`](GGame_Technical_Document.pdf):
environment and libraries, user manual, architecture, procedural
terrain and textures, the rover hierarchy, hand-written physics,
the launch state machine, performance considerations and design
choices. The slide deck used for the presentation is
[`GGame_Presentation.pdf`](GGame_Presentation.pdf).
