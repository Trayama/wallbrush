# WallBrush 0.2.0

Owlbear Rodeo wall editor. Hosted by GitHub Pages.

Install manifest:
https://trayama.github.io/wallbrush/manifest.json

## Toolbar
- Right toolbar: WallBrush main tool (GM only).
- Top-left modes: draw wall by dragging; erase nearest wall by clicking.
- Top-right actions: toggle DM guides, toggle grid snap, undo, redo, clear all plugin walls (double-click within 5 seconds).

## Wall model
- Each segment is stored as a shared Owlbear WALL item in the FOG layer.
- Each WallBrush client derives an attached local WALL item from each shared wall, following the approach used by Owlbear Dynamic Fog.
- Only the GM client creates red guide lines in the local CONTROL layer. Players do not receive those guides.
- Shared WALL geometry remains in the room even if a player has not installed WallBrush. Test fog/lighting behavior in the target room.

## Token movement
- The GM client watches shared scene item changes for IMAGE tokens on CHARACTER and MOUNT layers.
- If the token's swept movement path intersects a WallBrush wall, the GM client restores its previous position.
- This is post-update correction, not a native movement constraint; a brief snap-back may be visible.
- Token size is estimated from Owlbear item bounds. Irregular tokens may need tuning.

## Test
1. Draw a wall across a doorway.
2. Confirm only GM sees the red guide.
3. Confirm the wall does not appear as a normal drawing.
4. Try moving a character through the wall; it should snap back.
5. With Dynamic Fog or another vision system enabled, test light and vision obstruction on the player client.
6. Erase the wall and confirm the local guide/wall copies disappear.

Undo/redo use Owlbear's scene-wide history, so they may also affect another recent scene operation.