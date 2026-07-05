"""Render soup.glb (or the parts built by build_soup) as a PNG preview.

Uses matplotlib's 3D poly renderer — good enough to eyeball colors + proportions.
Saves soup_render.png in the same dir.
"""

import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

import build_soup  # re-uses the same parts list


parts = build_soup.parts  # each is a trimesh with vertex_colors set

fig = plt.figure(figsize=(6, 7), facecolor="#fdf6e3")
ax = fig.add_subplot(111, projection="3d")
ax.set_facecolor("#fdf6e3")

# soft "front" view — camera looking at his face
ax.view_init(elev=10, azim=-90)

for m in parts:
    verts = m.vertices
    faces = m.faces
    # average vertex color per face for shading
    vc = np.asarray(m.visual.vertex_colors, dtype=float) / 255.0
    face_rgba = vc[faces].mean(axis=1)

    tris = verts[faces]  # (F, 3, 3)
    pc = Poly3DCollection(tris, facecolors=face_rgba, edgecolors="none",
                          linewidths=0, antialiased=True)
    # cheap directional shading: dim by face-normal.y (front faces stay bright)
    v0, v1, v2 = tris[:, 0], tris[:, 1], tris[:, 2]
    n = np.cross(v1 - v0, v2 - v0)
    n /= (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)
    light = np.array([0.2, -0.9, 0.3])
    light /= np.linalg.norm(light)
    shade = np.clip((n @ light) * 0.5 + 0.55, 0.35, 1.0)
    face_rgba[:, :3] *= shade[:, None]
    pc.set_facecolor(face_rgba)
    ax.add_collection3d(pc)

# axes: soup was Z-up, matplotlib default too
all_v = np.vstack([m.vertices for m in parts])
mins = all_v.min(axis=0); maxs = all_v.max(axis=0)
center = (mins + maxs) / 2
span = (maxs - mins).max() / 2 * 1.05
ax.set_xlim(center[0] - span, center[0] + span)
ax.set_ylim(center[1] - span, center[1] + span)
ax.set_zlim(center[2] - span, center[2] + span)
ax.set_box_aspect((1, 1, 1))
ax.set_axis_off()

plt.tight_layout(pad=0)
plt.savefig("soup_render.png", dpi=140, facecolor="#fdf6e3")
print("wrote soup_render.png")
