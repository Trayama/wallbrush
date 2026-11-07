# WallBrush 0.3.0

Install manifest: https://trayama.github.io/wallbrush/manifest.json

## Barrier types
- Wall: blocks vision and movement.
- Door: blocks vision and movement while closed. Click an existing door in Door mode to toggle it; its state is stored in shared scene metadata.
- Window: allows vision/light through but blocks movement using the GM-side token correction.

## Editing
- Edit mode: click a barrier to show endpoint handles.
- Drag near an endpoint to resize/re-angle the segment.
- Drag the middle of a segment to move the entire barrier.
- Eraser deletes walls, doors, and windows.

## Geometry
- Drawing endpoints snap to nearby existing barrier segments.
- Local collision walls extend slightly past joined endpoints to reduce light leaks at seams.
- Door and window source segments are included in join geometry, so wall ends meet the opening edges instead of extending across the opening.

## Existing scenes
- Existing v0.2.x hidden line sources are treated as ordinary walls.
- Legacy shared WALL items are migrated into WallBrush source lines.
- Existing barriers remain in the scene.

## Technical notes
- Shared hidden LINE sources hold geometry and door state.
- Each client derives local WALL objects only for opaque barriers.
- Window segments do not create local WALL objects; the GM movement guard still treats them as solid.
- Movement blocking is post-update correction rather than a native Owlbear movement constraint.
