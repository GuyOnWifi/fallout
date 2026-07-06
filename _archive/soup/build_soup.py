"""Build soup as a colored GLB with NAMED nodes + PBR materials.

Scene node names (for Three.js scene.getObjectByName):
    body, ears, face_patch, eyes_nose, paws, tail

Each node has its own PBRMaterial so you can retint per-instance in Three.js:
    scene.getObjectByName('body').material.color.set(0xff8888)
"""

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial


# --- tunables (mm) ---
BODY_R  = 40
HEAD_R  = 28
HEAD_DZ = 52
EAR_R   = 10
ARM_R   = 11
TAIL_R  = 8

SUBDIV = 3

# --- palette (RGBA 0-1 for PBR) sampled from the soup emoji ---
CREAM       = (240/255, 225/255, 210/255, 1.0)
CREAM_DARK  = (210/255, 185/255, 165/255, 1.0)
TAUPE       = (170/255, 138/255, 115/255, 1.0)
BROWN_DARK  = (95/255,  62/255,  50/255,  1.0)


def sphere(center, radius, scale=(1, 1, 1)):
    m = trimesh.creation.icosphere(subdivisions=SUBDIV, radius=radius)
    if scale != (1, 1, 1):
        S = np.diag([scale[0], scale[1], scale[2], 1.0])
        m.apply_transform(S)
    m.apply_translation(center)
    return m


def group(meshes, color, name):
    """Concatenate meshes into one, assign a named PBR material."""
    merged = trimesh.util.concatenate(meshes)
    merged.visual = trimesh.visual.TextureVisuals(
        material=PBRMaterial(
            name=name,
            baseColorFactor=color,
            roughnessFactor=0.85,
            metallicFactor=0.0,
        )
    )
    return merged


# --- build each role's geometry ---

body_parts = [
    sphere((0, 0, 0), BODY_R, scale=(1.05, 1.0, 0.95)),
    sphere((0, 0, HEAD_DZ), HEAD_R),
]

ear_parts = [
    sphere(
        (sx * HEAD_R * 0.58, -HEAD_R * 0.10, HEAD_DZ + HEAD_R * 0.78),
        EAR_R,
    )
    for sx in (-1, 1)
]

face_patch_parts = [
    sphere(
        (0, -HEAD_R * 0.88, HEAD_DZ - 2),
        HEAD_R * 0.58,
        scale=(1.35, 0.40, 0.85),
    )
]

eyes_nose_parts = [
    sphere(
        (sx * HEAD_R * 0.36, -HEAD_R * 1.18, HEAD_DZ - 1),
        HEAD_R * 0.16,
        scale=(1.0, 0.60, 0.90),
    )
    for sx in (-1, 1)
] + [
    sphere(
        (0, -HEAD_R * 1.20, HEAD_DZ - 3),
        HEAD_R * 0.15,
        scale=(1.0, 0.60, 0.90),
    )
]

paw_parts = [
    sphere(
        (sx * BODY_R * 0.48, -BODY_R * 0.92, BODY_R * 0.10),
        ARM_R,
    )
    for sx in (-1, 1)
]

tail_parts = [
    sphere((-BODY_R * 0.85, BODY_R * 0.4, -BODY_R * 0.35), TAIL_R)
]


# --- assemble a Scene with named nodes ---
scene = trimesh.Scene()
scene.add_geometry(group(body_parts,       CREAM,       'body'),       node_name='body',       geom_name='body')
scene.add_geometry(group(ear_parts,        CREAM_DARK,  'ears'),       node_name='ears',       geom_name='ears')
scene.add_geometry(group(face_patch_parts, TAUPE,       'face_patch'), node_name='face_patch', geom_name='face_patch')
scene.add_geometry(group(eyes_nose_parts,  BROWN_DARK,  'eyes_nose'),  node_name='eyes_nose',  geom_name='eyes_nose')
scene.add_geometry(group(paw_parts,        CREAM_DARK,  'paws'),       node_name='paws',       geom_name='paws')
scene.add_geometry(group(tail_parts,       CREAM_DARK,  'tail'),       node_name='tail',       geom_name='tail')

# translate whole scene so lowest z sits at 0 (pivot at feet — matches the
# spec: model facing +Z convention? no, this is z-up mm. Three.js side can
# rotate -PI/2 around x if it wants y-up.)
bounds = scene.bounds
scene.apply_translation((0, 0, -bounds[0][2]))

# GLB with embedded materials
scene.export('soup.glb')
scene.export('soup.stl')  # STL is geometry-only; still useful as a print fallback
print('wrote soup.glb (scene w/ named nodes) + soup.stl')
print('nodes:', list(scene.graph.nodes_geometry))

# --- keep the flat `parts` list around too, so render_soup.py still works ---
# (matplotlib preview reads `build_soup.parts` and expects vertex_colors)
def _with_vertex_color(mesh, rgba01):
    rgba = np.array([int(c * 255) for c in rgba01], dtype=np.uint8)
    m = mesh.copy()
    m.visual = trimesh.visual.ColorVisuals(
        mesh=m,
        vertex_colors=np.tile(rgba, (len(m.vertices), 1)),
    )
    return m

parts = (
    [_with_vertex_color(m, CREAM)      for m in body_parts]
    + [_with_vertex_color(m, CREAM_DARK)  for m in ear_parts]
    + [_with_vertex_color(m, TAUPE)       for m in face_patch_parts]
    + [_with_vertex_color(m, BROWN_DARK)  for m in eyes_nose_parts]
    + [_with_vertex_color(m, CREAM_DARK)  for m in paw_parts]
    + [_with_vertex_color(m, CREAM_DARK)  for m in tail_parts]
)
