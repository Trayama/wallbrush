# WallBrush 0.2.1

Install manifest: https://trayama.github.io/wallbrush/manifest.json

## Storage and collision architecture
- A hidden shared LINE item stores each wall's geometry in the scene.
- Each connected WallBrush client derives a local WALL item attached to that source line.
- The local WALL uses Owlbear's FOG layer, double-sided blocking, and disabled VISIBLE/COPY attachment behavior, following the Owlbear Dynamic Fog example.
- Only the GM client creates a local red dashed guide line.
- Legacy v0.2.0 shared WALL items are migrated to hidden shared LINE sources on scene load.

## Tools
- Drag to draw a wall segment.
- Click a wall with the eraser mode to delete it.
- Toggle DM guides and grid snapping.
- Undo/redo use Owlbear scene history.
- Clear all WallBrush walls requires a second click within 5 seconds.

## Movement collision
- The GM client watches CHARACTER and MOUNT image token updates.
- Crossing a wall attempts to restore the token to its previous position.
- This is post-update correction, not a native movement constraint; a brief snap-back may occur.

## Validation
- On release, the extension verifies the hidden shared line was saved.
- It then waits for local wall generation and verifies the local WALL exists.
- Failures are surfaced through an Owlbear notification and console error.

## Live test
1. Install/update from the manifest URL.
2. Draw a short wall and release the mouse.
3. A red dashed DM guide should remain after release.
4. The extension should show '墙壁已保存，碰撞墙已生成。'.
5. Open a player client with WallBrush installed and test fog/vision.
6. Move a character through the wall and test snap-back.