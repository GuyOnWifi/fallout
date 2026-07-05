"""Build a 3D model of soup — a chubby lil guy — as a colored GLB (+ plain STL).

Two-ball design: body sphere + head sphere, with ears, eyes, nose, arms, tail.
Colors approximate the soup emoji palette.
"""

import numpy as np
import trimesh

# --- tunables (mm) ---
BODY_R  = 40
HEAD_R  = 28
HEAD_DZ = 52    # head center z, above body center
EAR_R   = 10
ARM_R   = 11
TAIL_R  = 8

SUBDIV = 3

# --- palette (RGBA 0-255), sampled from the soup emoji ---
CREAM       = (240, 225, 210, 255)   # body + head
CREAM_DARK  = (215, 193, 175, 255)   # ear tips, paws, tail
TAUPE       = (184, 156, 134, 255)   # face patch (the darker mask area)
BROWN_DARK  = (107,  74,  62, 255)   # eyes + nose


def sphere_at(center, radius, scale=(1, 1, 1), color=CREAM):
    m = trimesh.creation.icosphere(subdivisions=SUBDIV, radius=radius)
    if scale != (1, 1, 1):
        S = np.diag([scale[0], scale[1], scale[2], 1.0])
        m.apply_transform(S)
    m.apply_translation(center)
    # set vertex_colors directly (skips scipy-dependent face→vertex path)
    m.visual.vertex_colors = np.tile(np.array(color, dtype=np.uint8),
                                     (len(m.vertices), 1))
    return m


parts = []

# body — slightly squished so he sits flat and looks chonky
parts.append(sphere_at((0, 0, 0), BODY_R, scale=(1.05, 1.0, 0.95), color=CREAM))

# head
parts.append(sphere_at((0, 0, HEAD_DZ), HEAD_R, color=CREAM))

# ears — darker cream tips
for sx in (-1, 1):
    parts.append(sphere_at(
        (sx * HEAD_R * 0.58, -HEAD_R * 0.10, HEAD_DZ + HEAD_R * 0.78),
        EAR_R,
        color=CREAM_DARK,
    ))

# face patch — flat oval mask on the front of the head (taupe)
# wider + a touch taller than before to match the emoji's rounded mask
parts.append(sphere_at(
    (0, -HEAD_R * 0.80, HEAD_DZ - 1),
    HEAD_R * 0.62,
    scale=(1.35, 0.28, 0.95),
    color=TAUPE,
))

# eyes — bigger flatter ovals, spaced wider apart (cuter, emoji-style)
for sx in (-1, 1):
    parts.append(sphere_at(
        (sx * HEAD_R * 0.42, -HEAD_R * 0.98, HEAD_DZ - 1),
        HEAD_R * 0.16,
        scale=(1.0, 0.5, 0.75),   # wide + flat = cute droopy eye
        color=BROWN_DARK,
    ))

# nose — rounder + bigger, centered between eyes
parts.append(sphere_at(
    (0, -HEAD_R * 1.02, HEAD_DZ - 3),
    HEAD_R * 0.18,
    scale=(1.0, 0.55, 0.85),
    color=BROWN_DARK,
))

# arms — little paws on the front of the body
for sx in (-1, 1):
    parts.append(sphere_at(
        (sx * BODY_R * 0.55, -BODY_R * 0.55, BODY_R * 0.05),
        ARM_R,
        color=CREAM_DARK,
    ))

# tail — nub off the back-left
parts.append(sphere_at(
    (-BODY_R * 0.85, BODY_R * 0.4, -BODY_R * 0.35),
    TAIL_R,
    color=CREAM_DARK,
))

soup_mesh = trimesh.util.concatenate(parts)

# sit lowest point at z=0 (printer-friendly)
zmin = soup_mesh.bounds[0][2]
soup_mesh.apply_translation((0, 0, -zmin))

# GLB carries colors; STL is geometry-only fallback
soup_mesh.export("soup.glb")
soup_mesh.export("soup.stl")
print(f"wrote soup.glb + soup.stl: "
      f"{len(soup_mesh.vertices)} verts, {len(soup_mesh.faces)} faces")
print(f"bounds (mm): {soup_mesh.bounds.tolist()}")
