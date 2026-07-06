# Soup mascot — handoff to the game agent

## What this is

Soup is a chubby cream cat-adjacent character built from overlapping spheres.
Modeled after an emoji the user shared. He's the mascot for **everything** in
the day3 games — opponent, player, bowling pins, referee, crowd. Retint per
role.

The canonical deliverable is `day3/app/assets/mascot.glb` (also mirrored here
as `soup.glb`).

Preview: `soup_render.png` (matplotlib preview — mesh triangulation is a
renderer artifact, not in the actual model).

Reference art: `refs/soup_reference_sitting.png` (the other emoji refs the
user shared are no longer in the image cache; describe him as "chubby cream
cat, two stacked balls, small ears, taupe face-mask with two dark oval eyes
and a matching-sized dark nose, tiny paws in front").

## Files in this folder

| File | What it is |
|---|---|
| `build_soup.py` | Source of truth. Builds the mascot from spheres and exports GLB + STL. Tunables at the top. |
| `render_soup.py` | Matplotlib preview renderer. Imports `build_soup`, reads `parts`, writes `soup_render.png`. Use for quick visual iteration. |
| `soup.glb` | Current export (same file as `day3/app/assets/mascot.glb`). |
| `soup.stl` | Geometry-only fallback (no colors, no material slots). Useful for 3D printing. |
| `soup.scad` | Early OpenSCAD version, superseded by `build_soup.py`. Kept for reference only. |
| `viewer.html` + `shoot.mjs` | Local three.js viewer + a Node screenshot script. Serve `python3 -m http.server 8765`, open `http://localhost:8765/viewer.html`. `shoot.mjs` needs `playwright` installed (npm was uncooperative in the dev sandbox — matplotlib was the working preview path). |
| `refs/` | Reference art from the user. |
| `HANDOFF.md` | This file. |

## Scene graph (the important part)

`mascot.glb` is a glTF Scene with **six named nodes**, each with its own
`PBRMaterial` (metalness 0, roughness 0.85). Material name matches node name.

```
mascot.glb (Scene, z-up, mm units, feet at z=0)
├── body        baseColor cream       (240, 225, 210)   torso + head sphere
├── ears        baseColor cream_dark  (210, 185, 165)   two ear bumps on top of head
├── face_patch  baseColor taupe       (170, 138, 115)   darker oval mask on face
├── eyes_nose   baseColor brown_dark  ( 95,  62,  50)   two eyes + nose blob
├── paws        baseColor cream_dark  (210, 185, 165)   two little arms on front of body
└── tail        baseColor cream_dark  (210, 185, 165)   nub off back-left of body
```

Node names are safe to use in `scene.getObjectByName(...)`. Material names
match. Body and head are one merged node ("body") — if you need to bob the
head independently, split it out in `build_soup.py` (see "Modifying" below).

## Retinting per instance (Three.js)

```js
const gltf = await loader.loadAsync('assets/mascot.glb');
const soup = gltf.scene;

// materials are shared by default — clone before mutating if you're
// spawning multiple instances that need different tints
soup.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });

soup.getObjectByName('body').material.color.setHex(0xff8888);
soup.getObjectByName('paws').material.color.setHex(0xff8888);
// leave face_patch / eyes_nose alone unless you want a themed variant
```

For dozens of pins, load once and `SkeletonUtils.clone` (or plain
`scene.clone(true)`) per instance — cheap.

## Coordinate system + orientation

- **Units:** millimeters. Height ~122mm. Scale down in Three.js if you want
  meters (`soup.scale.setScalar(0.008)` puts him at ~1m tall).
- **Up axis:** +Z. Three.js is Y-up. On load, rotate the root:
  `soup.rotation.x = -Math.PI / 2;`
- **Facing:** his face points toward **−Y** in model space. After the
  Y-up flip that becomes **+Z** (toward camera in a default Three.js scene).
  You'll probably want to flip him with `soup.rotation.y = Math.PI` if he
  needs to face −Z.
- **Pivot:** at his feet (z=0 in model space, y=0 after the flip). Drop him
  on the floor without offset math.

## Poly count

~7k triangles across all nodes combined. Fine for 10+ instances.

## The animation situation

**No rig. No animation clips. Zero.** He's a static bag of spheres.

The user was told the game agent could use `idle`, `hit_light`, `hit_heavy`,
`ko`, `cheer`, `wave`, `walk`, `bowling_pin_fall`. **None of these exist in
the GLB.** `AnimationMixer` will find no clips.

### Recommended workaround: procedural animation

Since soup is a chubby ball, procedural per-frame transforms read fine —
often better than a bad rig on a limbless character. Suggestions:

- **idle:** `soup.position.y = baseY + Math.sin(t * 2) * 0.02;` (gentle bob)
  Optional: `soup.scale.y = 1 + Math.sin(t * 2) * 0.03;` for a squish-breathe.
- **hit_light:** GSAP or manual tween — shake `soup.position.x` ±0.05 for
  120ms, flash `body.material.color` red for 100ms.
- **hit_heavy:** bigger shake + a quick backwards lean via `rotation.x`.
- **ko:** tween `rotation.z` to ±Math.PI/2 over 400ms, then drop
  `position.y` to floor. Spawn a couple of star sprites.
- **cheer:** two quick vertical hops (position.y sine burst) + small
  `rotation.z` wiggle.
- **wave:** rotate the `paws` node ±0.3 rad around z at ~4Hz for 800ms.
- **bowling_pin_fall:** apply an angular velocity around a horizontal axis
  perpendicular to the impact direction, integrate until pin hits the floor.
  Cannon-es / Rapier physics is easier than hand-rolled for the pin case.

If you want, ask the user to have me add a `mascot-anim.js` helper exporting
`idle(mesh, t)`, `hit(mesh, {heavy})`, `ko(mesh)`, `cheer(mesh)`, etc. — it
would live in `day3/app/` and be a tiny ES module. Wasn't built yet because
the user hadn't asked for it.

## Modifying the mascot

Edit `build_soup.py` and rerun:

```bash
cd soup/
python3 build_soup.py                                    # rebuild GLB + STL
python3 render_soup.py                                   # preview
cp soup.glb ../day3/app/assets/mascot.glb                # ship
```

Tunables at the top of `build_soup.py`: `BODY_R`, `HEAD_R`, `HEAD_DZ`,
`EAR_R`, `ARM_R`, `TAIL_R`, `SUBDIV`, and the palette constants
(`CREAM`, `CREAM_DARK`, `TAUPE`, `BROWN_DARK`).

To split head from body (useful for head-nod animations): move the head
sphere out of `body_parts` into its own `head_parts` group and add a
`scene.add_geometry(group(head_parts, CREAM, 'head'), node_name='head',
geom_name='head')` line. Then the head has its own node in the scene.

## History / decisions worth knowing

- **Two-ball design was a user constraint** — "make him just two balls,
  make the head good at least ... try to be simple to make less fuck ups."
  Adding limbs / a full rig is a scope expansion the user hasn't approved.
- **Uncanny-valley fix:** an earlier version had the face patch buried inside
  the head sphere so only a paper-thin sliver protruded; the eyes appeared to
  float on bare cream and read as creepy. Fix was pushing the patch flush to
  the front of the head (`y = -HEAD_R * 0.88`, `y-scale = 0.40`) so it reads
  as a distinct mask. Don't undo this.
- **Cuteness overshoot:** a followup added tall bat ears, eye sparkles, blush
  cheeks, a smile, and feet. User rejected it ("no undo undo WHAT HAVE YOU
  DONE") and we reverted. Current model is the sober version; don't reintroduce
  those features unless the user asks.
- **Colors came from the emoji, not chosen from taste.** Palette is fixed
  unless the user overrides.
- **Vertex-color → PBR-material switch** happened when the user asked for
  named material slots so the game could retint per role. The older
  vertex-color-only export (visible in git history if there is one) still
  works as a viewer but has no slot names.
