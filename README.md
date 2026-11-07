# WallBrush 0.2.1

Install manifest: https://trayama.github.io/wallbrush/manifest.json

## Storage and collision architecture
- A hidden shared LINE item stores each wall's geometry in the scene.
- Each connected WallBrush client derives a local WALL item attached to that source line.
- Local WALL items use Owlbear's FOG layer and disabled VISIBLE/COPY attachment behavior, following the Owlbear Dynamic Fog example.
- Only the GM client creates a local red dashed guide line.
- Legacy v0.2.0 shared WALL items are migrated to hidden shared LINE sources on scene load.

## Tools
- Drag to draw a wall segment; the extension verifies the shared source and local WALL after release.
- Click a wall with the eraser mode to delete it.
- Toggle DM guides and grid snapping.
- Undo/redo use Owlbear scene history.
- Clear all WallBrush walls requires a second click within 5 seconds.

## Movement collision
- The GM client watches CHARACTER and MOUNT image token updates.
- Crossing a wall attempts to restore the token to its previous position.
- This is post-update correction, not a native movement constraint; a brief snap-back may occur.