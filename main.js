import OBR, { buildLine, buildShape, buildWall } from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

const ID = "com.trpglab.wallbrush";
const TOOL_ID = ID + "/tool-v030";
const DRAW_MODE = ID + "/draw-v030";
const ERASE_MODE = ID + "/erase-v030";

const WALL_SOURCE_KEY = ID + "/wall-source";
const LEGACY_WALL_KEY = ID + "/wall";
const LOCAL_WALL_KEY = ID + "/local-wall";
const GUIDE_KEY = ID + "/guide";
const PREVIEW_KEY = ID + "/preview";

const ICON = "https://trayama.github.io/wallbrush/icons/tool.svg";
const DRAW_ICON = "https://trayama.github.io/wallbrush/icons/draw.svg";
const ERASE_ICON = "https://trayama.github.io/wallbrush/icons/erase.svg";
const EYE_ICON = "https://trayama.github.io/wallbrush/icons/eye.svg";
const SNAP_ICON = "https://trayama.github.io/wallbrush/icons/snap.svg";
const UNDO_ICON = "https://trayama.github.io/wallbrush/icons/undo.svg";
const REDO_ICON = "https://trayama.github.io/wallbrush/icons/redo.svg";
const CLEAR_ICON = "https://trayama.github.io/wallbrush/icons/clear.svg";
const DOOR_ICON = "https://trayama.github.io/wallbrush/icons/door.svg";
const WINDOW_ICON = "https://trayama.github.io/wallbrush/icons/window.svg";
const EDIT_ICON = "https://trayama.github.io/wallbrush/icons/edit.svg";
const DOOR_MODE = ID + "/door-v030";
const WINDOW_MODE = ID + "/window-v030";
const EDIT_MODE = ID + "/edit-v030";
const HANDLE_KEY = ID + "/edit-handle";
let JOIN_SNAP_DISTANCE = 8;
let WALL_END_OVERLAP = 2.5;

const ZERO = { x: 0, y: 0 };
const UNIT = { x: 1, y: 1 };

let role = "PLAYER";
let snapToGrid = true;
let showGuides = true;
let dragStart = null;
let previewId = null;
let previousItems = new Map();
let sceneChangeQueue = Promise.resolve();
let clearArmedUntil = 0;
let gridDpi = 100;
let selectedSourceId = null;
let selectedHandleIds = [];
let editState = null;
let editPreviewId = null;

async function refreshRole() {
  role = await OBR.player.getRole();
  return role;
}

function isGM() {
  return role === "GM";
}

function isWallSource(item) {
  const data = item?.metadata?.[WALL_SOURCE_KEY];
  return item?.type === "LINE" && data && data.version >= 1;
}

function sourceKind(source) {
  const kind = source?.metadata?.[WALL_SOURCE_KEY]?.kind;
  return kind === "door" || kind === "window" ? kind : "wall";
}

function isDoorOpen(source) {
  return sourceKind(source) === "door" &&
    source.metadata?.[WALL_SOURCE_KEY]?.open === true;
}

function blocksVision(source) {
  return sourceKind(source) !== "window" && !isDoorOpen(source);
}

function blocksMovement(source) {
  return !isDoorOpen(source);
}

function isLegacyWall(item) {
  return item?.type === "WALL" &&
    item.metadata?.[LEGACY_WALL_KEY]?.version === 1;
}

function isLocalWall(item) {
  return item?.type === "WALL" &&
    typeof item.metadata?.[LOCAL_WALL_KEY]?.sourceId === "string";
}

function isGuide(item) {
  return item?.type === "LINE" &&
    typeof item.metadata?.[GUIDE_KEY]?.wallId === "string";
}

function isPreview(item) {
  return item?.type === "LINE" && item.metadata?.[PREVIEW_KEY] === true;
}

function isToken(item) {
  return item?.type === "IMAGE" &&
    (item.layer === "CHARACTER" || item.layer === "MOUNT");
}

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function samePoint(a, b) {
  return !!a && !!b &&
    Math.abs(a.x - b.x) < 0.1 &&
    Math.abs(a.y - b.y) < 0.1;
}

function transformPoint(item, point) {
  const scale = item.scale || UNIT;
  const position = item.position || ZERO;
  const radians = (item.rotation || 0) * Math.PI / 180;
  const x = point.x * scale.x;
  const y = point.y * scale.y;
  return {
    x: position.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: position.y + x * Math.sin(radians) + y * Math.cos(radians)
  };
}

function inverseTransformPoint(item, point) {
  const scale = item.scale || UNIT;
  const position = item.position || ZERO;
  const radians = -(item.rotation || 0) * Math.PI / 180;
  const x = point.x - position.x;
  const y = point.y - position.y;
  return {
    x: (x * Math.cos(radians) - y * Math.sin(radians)) / (scale.x || 1),
    y: (x * Math.sin(radians) + y * Math.cos(radians)) / (scale.y || 1)
  };
}

function closestPointOnSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return clonePoint(start);
  const t = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  ));
  return { x: start.x + t * dx, y: start.y + t * dy };
}

function guideStyle(source) {
  const kind = sourceKind(source);
  if (kind === "door") {
    return isDoorOpen(source)
      ? { color: "#42d58b", dash: [4, 4] }
      : { color: "#ffb547", dash: [9, 5] };
  }
  if (kind === "window") {
    return { color: "#54b9ff", dash: [3, 4] };
  }
  return { color: "#ff5364", dash: [9, 5] };
}

function collisionLocalPoints(source, allSources) {
  const [rawStart, rawEnd] = wallSegments(source)[0];
  const dx = rawEnd.x - rawStart.x;
  const dy = rawEnd.y - rawStart.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) {
    return [source.startPosition, source.endPosition];
  }

  const ux = dx / length;
  const uy = dy / length;

  function joinedEndpoint(point) {
    let nearest = null;
    let nearestDistance = JOIN_SNAP_DISTANCE;
    for (const other of allSources) {
      if (other.id === source.id) continue;
      for (const [a, b] of wallSegments(other)) {
        const projected = closestPointOnSegment(point, a, b);
        const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = projected;
        }
      }
    }
    return nearest || point;
  }

  const joinedStart = joinedEndpoint(rawStart);
  const joinedEnd = joinedEndpoint(rawEnd);
  const worldStart = {
    x: joinedStart.x - ux * WALL_END_OVERLAP,
    y: joinedStart.y - uy * WALL_END_OVERLAP
  };
  const worldEnd = {
    x: joinedEnd.x + ux * WALL_END_OVERLAP,
    y: joinedEnd.y + uy * WALL_END_OVERLAP
  };

  return [
    inverseTransformPoint(source, worldStart),
    inverseTransformPoint(source, worldEnd)
  ];
}

function collisionWorldSegments(source, allSources) {
  const points = collisionLocalPoints(source, allSources);
  return [[
    transformPoint(source, points[0]),
    transformPoint(source, points[1])
  ]];
}

/*
 * Shared source geometry is a hidden LINE item.
 * Each client derives its own local WALL from that shared source.
 * This follows Owlbear's Dynamic Fog reconciliation pattern.
 */
function makeWallSource(start, end, kind = "wall") {
  return buildLine()
    .name(kind === "door" ? "WallBrush Door" : kind === "window" ? "WallBrush Window" : "WallBrush Wall")
    .startPosition(start)
    .endPosition(end)
    .position(ZERO)
    .rotation(0)
    .scale(UNIT)
    .visible(false)
    .layer("FOG")
    .locked(true)
    .disableHit(true)
    .metadata({
      [WALL_SOURCE_KEY]: {
        version: 2,
        kind,
        open: false,
        createdBy: "WallBrush"
      }
    })
    .build();
}

function makeSourceFromLegacyWall(wall) {
  if (!wall.points || wall.points.length < 2) return null;
  return buildLine()
    .name("WallBrush Source")
    .startPosition(wall.points[0])
    .endPosition(wall.points[wall.points.length - 1])
    .position(wall.position || ZERO)
    .rotation(wall.rotation || 0)
    .scale(wall.scale || UNIT)
    .visible(false)
    .layer("FOG")
    .locked(true)
    .disableHit(true)
    .metadata({
      [WALL_SOURCE_KEY]: {
        version: 2,
        kind: "wall",
        open: false,
        createdBy: "WallBrush",
        migrated: true
      }
    })
    .build();
}

function makeLocalWall(source, allSources) {
  return buildWall()
    .name("WallBrush Local Wall")
    .points(collisionLocalPoints(source, allSources))
    .attachedTo(source.id)
    .position(source.position || ZERO)
    .rotation(source.rotation || 0)
    .scale(source.scale || UNIT)
    .blocking(true)
    .doubleSided(true)
    .disableAttachmentBehavior(["VISIBLE", "COPY"])
    .metadata({
      [LOCAL_WALL_KEY]: { sourceId: source.id }
    })
    .build();
}

function makeGuide(source) {
  const [start, end] = wallSegments(source)[0];
  const style = guideStyle(source);
  return buildLine()
    .name("WallBrush DM Guide")
    .startPosition(start)
    .endPosition(end)
    .position(ZERO)
    .rotation(0)
    .scale(UNIT)
    .strokeColor(style.color)
    .strokeOpacity(0.95)
    .strokeWidth(4)
    .strokeDash(style.dash)
    .visible(showGuides)
    .layer("CONTROL")
    .locked(true)
    .disableHit(true)
    .metadata({
      [GUIDE_KEY]: { wallId: source.id }
    })
    .build();
}

function makePreview(start) {
  return buildLine()
    .name("WallBrush Preview")
    .startPosition(start)
    .endPosition(start)
    .position(ZERO)
    .strokeColor("#ff5364")
    .strokeOpacity(0.9)
    .strokeWidth(4)
    .strokeDash([8, 5])
    .layer("CONTROL")
    .locked(true)
    .disableHit(true)
    .metadata({ [PREVIEW_KEY]: true })
    .build();
}

async function snapToNearbyGeometry(point, excludeId) {
  let viewportScale = 1;
  try {
    viewportScale = Math.max(await OBR.viewport.getScale(), 0.1);
  } catch (error) {}
  const tolerance = Math.max(4, 10 / viewportScale);
  const sources = await OBR.scene.items.getItems(isWallSource);
  let nearest = null;
  let nearestDistance = tolerance;

  for (const source of sources) {
    if (source.id === excludeId) continue;
    for (const [start, end] of wallSegments(source)) {
      const projected = closestPointOnSegment(point, start, end);
      const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = projected;
      }
    }
  }
  return nearest || point;
}

async function drawPoint(point, excludeId) {
  let result = point;
  if (snapToGrid) {
    try {
      result = await OBR.scene.grid.snapPosition(point, 1, true, false);
    } catch (error) {
      console.warn("[WallBrush] Grid snap failed; using free point.", error);
    }
  }
  return await snapToNearbyGeometry(result, excludeId);
}

async function removePreview() {
  if (!previewId) return;
  const id = previewId;
  previewId = null;
  try {
    await OBR.scene.local.deleteItems([id]);
  } catch (error) {
    console.warn("[WallBrush] Preview cleanup failed.", error);
  }
}

async function migrateLegacyWalls(items) {
  const legacyWalls = items.filter(isLegacyWall);
  if (!legacyWalls.length) return items;

  const sources = legacyWalls
    .map(makeSourceFromLegacyWall)
    .filter(Boolean);

  if (sources.length) {
    await OBR.scene.items.addItems(sources);
  }
  await OBR.scene.items.deleteItems(legacyWalls.map(wall => wall.id));

  console.info("[WallBrush] Migrated legacy WALL items:", legacyWalls.length);
  return await OBR.scene.items.getItems();
}

function sameLocalWall(localWall, source, allSources) {
  const points = localWall.points || [];
  const expected = collisionLocalPoints(source, allSources);
  return localWall.attachedTo === source.id &&
    points.length === 2 &&
    samePoint(points[0], expected[0]) &&
    samePoint(points[1], expected[1]) &&
    samePoint(localWall.position, source.position) &&
    samePoint(localWall.scale, source.scale) &&
    Math.abs((localWall.rotation || 0) - (source.rotation || 0)) < 0.1 &&
    localWall.blocking === true &&
    localWall.doubleSided === true;
}

async function reconcileLocalItems(sharedItems) {
  if (!(await OBR.scene.isReady())) return;

  const sources = sharedItems.filter(isWallSource);
  if (selectedSourceId && !sources.some(source => source.id === selectedSourceId)) {
    selectedSourceId = null;
    await clearSelectionHandles();
  }
  const localItems = await OBR.scene.local.getItems();
  const localWalls = localItems.filter(isLocalWall);
  const guides = localItems.filter(isGuide);
  const previews = localItems.filter(isPreview);

  if (previews.length) {
    await OBR.scene.local.deleteItems(previews.map(item => item.id));
  }

  const sourceById = new Map(sources.map(source => [source.id, source]));
  const visionSources = sources.filter(blocksVision);
  const visionSourceIds = new Set(visionSources.map(source => source.id));
  const localBySource = new Map(
    localWalls.map(wall => [wall.metadata[LOCAL_WALL_KEY].sourceId, wall])
  );
  const guideBySource = new Map(
    guides.map(guide => [guide.metadata[GUIDE_KEY].wallId, guide])
  );

  const wallsToAdd = [];
  const wallsToDelete = [];
  const wallsToUpdate = [];
  const guidesToAdd = [];
  const guidesToDelete = [];
  const guidesToUpdate = [];

  for (const source of visionSources) {
    const localWall = localBySource.get(source.id);
    if (!localWall) {
      wallsToAdd.push(makeLocalWall(source, sources));
    } else if (!sameLocalWall(localWall, source, sources)) {
      wallsToUpdate.push({ localWall, source });
    }
  }

  for (const source of sources) {
    if (isGM()) {
      const guide = guideBySource.get(source.id);
      if (!guide) {
        guidesToAdd.push(makeGuide(source));
      } else {
        const [start, end] = wallSegments(source)[0];
        guidesToUpdate.push({ guide, start, end, style: guideStyle(source) });
      }
    }
  }

  for (const wall of localWalls) {
    const sourceId = wall.metadata[LOCAL_WALL_KEY].sourceId;
    if (!visionSourceIds.has(sourceId)) wallsToDelete.push(wall.id);
  }

  for (const guide of guides) {
    const sourceId = guide.metadata[GUIDE_KEY].wallId;
    if (!isGM() || !sourceById.has(sourceId)) {
      guidesToDelete.push(guide.id);
    }
  }

  if (wallsToDelete.length) {
    await OBR.scene.local.deleteItems(wallsToDelete);
  }

  if (wallsToUpdate.length) {
    const byId = new Map(wallsToUpdate.map(entry => [entry.localWall.id, entry.source]));
    await OBR.scene.local.updateItems(
      wallsToUpdate.map(entry => entry.localWall),
      items => {
        for (const item of items) {
          const source = byId.get(item.id);
          if (!source) continue;
          item.points = collisionLocalPoints(source, sources);
          item.position = source.position;
          item.rotation = source.rotation;
          item.scale = source.scale;
          item.blocking = true;
          item.doubleSided = true;
        }
      }
    );
  }

  if (wallsToAdd.length) {
    await OBR.scene.local.addItems(wallsToAdd);
  }

  if (guidesToDelete.length) {
    await OBR.scene.local.deleteItems(guidesToDelete);
  }

  if (guidesToUpdate.length) {
    const byId = new Map(guidesToUpdate.map(entry => [entry.guide.id, entry]));
    await OBR.scene.local.updateItems(
      guidesToUpdate.map(entry => entry.guide),
      items => {
        for (const item of items) {
          const entry = byId.get(item.id);
          if (!entry) continue;
          item.startPosition = entry.start;
          item.endPosition = entry.end;
          item.style.strokeColor = entry.style.color;
          item.style.strokeDash = entry.style.dash;
          item.visible = showGuides;
        }
      }
    );
  }

  if (guidesToAdd.length) {
    await OBR.scene.local.addItems(guidesToAdd);
  }
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  ));
  const nearest = {
    x: start.x + t * dx,
    y: start.y + t * dy
  };
  return Math.hypot(point.x - nearest.x, point.y - nearest.y);
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, point) {
  return point.x >= Math.min(a.x, b.x) - 0.001 &&
    point.x <= Math.max(a.x, b.x) + 0.001 &&
    point.y >= Math.min(a.y, b.y) - 0.001 &&
    point.y <= Math.max(a.y, b.y) + 0.001;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
      ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;

  if (Math.abs(o1) < 0.001 && onSegment(a, b, c)) return true;
  if (Math.abs(o2) < 0.001 && onSegment(a, b, d)) return true;
  if (Math.abs(o3) < 0.001 && onSegment(c, d, a)) return true;
  if (Math.abs(o4) < 0.001 && onSegment(c, d, b)) return true;
  return false;
}

function segmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b)
  );
}

function movementHitsWalls(start, end, radius, sources) {
  for (const source of sources) {
    if (!blocksMovement(source)) continue;
    for (const [a, b] of collisionWorldSegments(source, sources)) {
      const startDistance = pointToSegmentDistance(start, a, b);
      const endDistance = pointToSegmentDistance(end, a, b);
      const sweptDistance = segmentDistance(start, end, a, b);

      if (segmentsIntersect(start, end, a, b) && startDistance > 1) return true;
      if (startDistance >= radius * 0.85 && sweptDistance < radius) return true;
      if (startDistance < radius * 0.85 && endDistance < startDistance - 2) return true;
    }
  }
  return false;
}

async function enforceMovement(items, sources) {
  if (!isGM() || previousItems.size === 0 || sources.length === 0) {
    return new Map();
  }

  const rejected = [];
  for (const item of items) {
    if (!isToken(item)) continue;
    const previous = previousItems.get(item.id);
    if (!previous?.position || samePoint(previous.position, item.position)) continue;

    let bounds = null;
    try {
      bounds = await OBR.scene.items.getItemBounds([item.id]);
    } catch (error) {
      console.warn("[WallBrush] Token bounds unavailable; using fallback radius.", error);
    }

    const delta = {
      x: item.position.x - previous.position.x,
      y: item.position.y - previous.position.y
    };
    const newCenter = bounds?.center || item.position;
    const oldCenter = {
      x: newCenter.x - delta.x,
      y: newCenter.y - delta.y
    };

    let radius = bounds
      ? Math.min(bounds.width, bounds.height) * 0.4
      : 18;
    if (!Number.isFinite(radius) || radius < 2) radius = 18;

    if (movementHitsWalls(oldCenter, newCenter, radius, sources)) {
      rejected.push({
        item,
        oldPosition: clonePoint(previous.position)
      });
    }
  }

  if (!rejected.length) return new Map();

  try {
    await OBR.scene.items.updateItems(
      rejected.map(entry => entry.item),
      drafts => {
        for (const draft of drafts) {
          const entry = rejected.find(candidate => candidate.item.id === draft.id);
          if (entry) draft.position = clonePoint(entry.oldPosition);
        }
      }
    );

    return new Map(rejected.map(entry => [entry.item.id, entry.oldPosition]));
  } catch (error) {
    console.error("[WallBrush] Token collision correction failed.", error);
    await OBR.notification.show(
      "检测到穿墙移动，但无法自动复位：" + (error?.message || "权限或同步错误"),
      "WARNING"
    );
    return new Map();
  }
}

async function processSceneItems(items) {
  const currentItems = await migrateLegacyWalls(items);
  const sources = currentItems.filter(isWallSource);
  const blocked = await enforceMovement(currentItems, sources);

  const nextSnapshot = new Map();
  for (const item of currentItems) {
    const position = blocked.get(item.id) ||
      (item.position ? clonePoint(item.position) : undefined);
    nextSnapshot.set(item.id, {
      id: item.id,
      type: item.type,
      layer: item.layer,
      position
    });
  }
  previousItems = nextSnapshot;

  await reconcileLocalItems(currentItems);
}

function queueSceneReconcile() {
  sceneChangeQueue = sceneChangeQueue.then(async () => {
    if (!(await OBR.scene.isReady())) return;
    const latestItems = await OBR.scene.items.getItems();
    await processSceneItems(latestItems);
  }).catch(async error => {
    console.error("[WallBrush] Scene reconciliation failed.", error);
    await OBR.notification.show(
      "墙壁同步失败：" + (error?.message || "未知错误"),
      "ERROR"
    );
  });
  return sceneChangeQueue;
}

async function initializeScene() {
  if (!(await OBR.scene.isReady())) return;
  try {
    gridDpi = await OBR.scene.grid.getDpi();
    JOIN_SNAP_DISTANCE = Math.max(6, gridDpi * 0.07);
    WALL_END_OVERLAP = Math.max(2, gridDpi * 0.02);
  } catch (error) {}
  let items = await OBR.scene.items.getItems();
  items = await migrateLegacyWalls(items);

  previousItems = new Map();
  for (const item of items) {
    previousItems.set(item.id, {
      id: item.id,
      type: item.type,
      layer: item.layer,
      position: item.position ? clonePoint(item.position) : undefined
    });
  }

  await reconcileLocalItems(items);
}

async function nearestWall(point) {
  const sources = await OBR.scene.items.getItems(isWallSource);
  const viewportScale = Math.max(await OBR.viewport.getScale(), 0.1);
  const tolerance = 18 / viewportScale;
  let nearest = null;
  let nearestDistance = Infinity;

  for (const source of sources) {
    for (const [start, end] of wallSegments(source)) {
      const distance = pointToSegmentDistance(point, start, end);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = source;
      }
    }
  }
  return nearest && nearestDistance <= tolerance ? nearest : null;
}

async function canEdit() {
  await refreshRole();
  if (isGM()) return true;
  await OBR.notification.show("只有房主（GM）可以编辑墙壁。", "WARNING");
  return false;
}

async function toggleGuides() {
  if (!(await canEdit())) return;
  showGuides = !showGuides;
  const guides = await OBR.scene.local.getItems(isGuide);
  if (guides.length) {
    await OBR.scene.local.updateItems(guides, items => {
      for (const item of items) item.visible = showGuides;
    });
  }
}

async function toggleSnap() {
  if (!(await canEdit())) return;
  snapToGrid = !snapToGrid;
  const metadata = await OBR.tool.getMetadata(TOOL_ID);
  await OBR.tool.setMetadata(TOOL_ID, {
    ...(metadata || {}),
    snapToGrid
  });
}

async function clearWalls() {
  if (!(await canEdit())) return;
  const now = Date.now();
  if (now > clearArmedUntil) {
    clearArmedUntil = now + 5000;
    await OBR.notification.show("请在 5 秒内再次点击清空按钮确认。", "WARNING");
    return;
  }

  clearArmedUntil = 0;
  const sources = await OBR.scene.items.getItems(isWallSource);
  if (!sources.length) return;

  await OBR.scene.items.deleteItems(sources.map(source => source.id));
  await queueSceneReconcile();
  await OBR.notification.show("已清空 " + sources.length + " 段墙壁。", "SUCCESS");
}

async function commitWall(start, end, kind = "wall") {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length < 4) return;

  const source = makeWallSource(start, end, kind);
  console.info("[WallBrush] Committing source line:", source.id, start, end);

  await OBR.scene.items.addItems([source]);

  const saved = await OBR.scene.items.getItems([source.id]);
  if (!saved.length) {
    throw new Error("场景没有返回刚写入的墙壁数据。");
  }

  await queueSceneReconcile();

  const localItems = await OBR.scene.local.getItems();
  const localWallExists = localItems.some(item =>
    isLocalWall(item) &&
    item.metadata[LOCAL_WALL_KEY].sourceId === source.id
  );
  const guideExists = localItems.some(item =>
    isGuide(item) &&
    item.metadata[GUIDE_KEY].wallId === source.id
  );

  console.info("[WallBrush] Commit verified:", {
    sourceId: source.id,
    sharedSourceSaved: true,
    localWallExists,
    guideExists
  });

  if (!localWallExists) {
    throw new Error("共享墙线已写入，但本地碰撞墙没有生成。");
  }
  if (isGM() && !guideExists) {
    throw new Error("碰撞墙已生成，但 DM 辅助线没有生成。");
  }

}

async function toggleDoorAt(point) {
  const source = await nearestWall(point);
  if (!source || sourceKind(source) !== "door") return false;

  await OBR.scene.items.updateItems([source], items => {
    const item = items[0];
    if (!item) return;
    const data = item.metadata[WALL_SOURCE_KEY] || {};
    item.metadata[WALL_SOURCE_KEY] = {
      ...data,
      version: 2,
      kind: "door",
      open: data.open !== true
    };
  });
  await queueSceneReconcile();
  return true;
}

async function createSegmentMode(modeId, icon, label, kind, clickHandler) {
  await OBR.tool.createMode({
    id: modeId,
    icons: [{
      icon,
      label,
      filter: { activeTools: [TOOL_ID], roles: ["GM"] }
    }],
    disabled: { roles: ["PLAYER"] },
    cursors: [{ cursor: "crosshair" }],
    ...(clickHandler ? {
      async onToolClick(_, event) {
        await clickHandler(event);
        return false;
      }
    } : {}),
    async onToolDragStart(context, event) {
      try {
        if (!(await canEdit())) return;
        snapToGrid = context.metadata?.snapToGrid !== false;
        dragStart = await drawPoint(event.pointerPosition);
        const preview = makePreview(dragStart);
        await OBR.scene.local.addItems([preview]);
        previewId = preview.id;
      } catch (error) {
        dragStart = null;
        await removePreview();
        console.error("[WallBrush] Drag start failed.", error);
        await OBR.notification.show(
          "无法开始绘制：" + (error?.message || "未知错误"),
          "ERROR"
        );
      }
    },
    async onToolDragMove(_, event) {
      try {
        if (!previewId || !dragStart) return;
        const end = await drawPoint(event.pointerPosition);
        await OBR.scene.local.updateItems([previewId], items => {
          for (const item of items) item.endPosition = end;
        });
      } catch (error) {
        console.error("[WallBrush] Preview update failed.", error);
      }
    },
    async onToolDragEnd(_, event) {
      const start = dragStart;
      dragStart = null;
      try {
        if (!start || !previewId) return;
        const end = await drawPoint(event.pointerPosition);
        await removePreview();
        await commitWall(start, end, kind);
      } catch (error) {
        await removePreview();
        console.error("[WallBrush] Barrier commit failed.", error);
        await OBR.notification.show(
          "障碍物保存失败：" + (error?.message || "未知错误"),
          "ERROR"
        );
      }
    },
    async onToolDragCancel() {
      dragStart = null;
      await removePreview();
    },
    async onDeactivate() {
      dragStart = null;
      await removePreview();
    }
  });
}

function makeEditHandle(position, label) {
  return buildShape()
    .name("WallBrush Edit Handle")
    .position(position)
    .width(18)
    .height(18)
    .shapeType("CIRCLE")
    .fillColor(label === "start" ? "#55d6ff" : "#ffffff")
    .fillOpacity(1)
    .strokeColor("#176c91")
    .strokeWidth(2)
    .layer("CONTROL")
    .locked(true)
    .disableHit(true)
    .metadata({ [HANDLE_KEY]: label })
    .build();
}

async function clearSelectionHandles() {
  if (selectedHandleIds.length) {
    const ids = selectedHandleIds;
    selectedHandleIds = [];
    try { await OBR.scene.local.deleteItems(ids); } catch (error) {}
  }
}

async function showSelection(source) {
  await clearSelectionHandles();
  selectedSourceId = source?.id || null;
  if (!source || !isGM()) return;
  const [start, end] = wallSegments(source)[0];
  const handles = [
    makeEditHandle(start, "start"),
    makeEditHandle(end, "end")
  ];
  selectedHandleIds = handles.map(item => item.id);
  await OBR.scene.local.addItems(handles);
}

function makeEditPreview(start, end) {
  return buildLine()
    .name("WallBrush Edit Preview")
    .startPosition(start)
    .endPosition(end)
    .position(ZERO)
    .rotation(0)
    .scale(UNIT)
    .strokeColor("#48c8ff")
    .strokeOpacity(1)
    .strokeWidth(6)
    .strokeDash([5, 3])
    .layer("CONTROL")
    .locked(true)
    .disableHit(true)
    .metadata({ [PREVIEW_KEY]: true })
    .build();
}

async function createEditMode() {
  await OBR.tool.createMode({
    id: EDIT_MODE,
    icons: [{
      icon: EDIT_ICON,
      label: "选择/调整墙体（拖端点调整，拖中段移动）",
      filter: { activeTools: [TOOL_ID], roles: ["GM"] }
    }],
    disabled: { roles: ["PLAYER"] },
    cursors: [{ cursor: "crosshair" }],
    async onToolClick(_, event) {
      const source = await nearestWall(event.pointerPosition);
      await showSelection(source);
      return false;
    },
    async onToolDragStart(_, event) {
      const source = await nearestWall(event.pointerPosition);
      if (!source) {
        await showSelection(null);
        return;
      }
      await showSelection(source);

      const [start, end] = wallSegments(source)[0];
      const scale = Math.max(await OBR.viewport.getScale(), 0.1);
      const endpointTolerance = 22 / scale;
      const startDistance = Math.hypot(event.pointerPosition.x - start.x, event.pointerPosition.y - start.y);
      const endDistance = Math.hypot(event.pointerPosition.x - end.x, event.pointerPosition.y - end.y);
      const mode = startDistance <= endpointTolerance
        ? "start"
        : endDistance <= endpointTolerance
          ? "end"
          : "move";

      editState = {
        sourceId: source.id,
        mode,
        pointerStart: clonePoint(event.pointerPosition),
        originalStart: clonePoint(start),
        originalEnd: clonePoint(end),
        currentStart: clonePoint(start),
        currentEnd: clonePoint(end)
      };

      const preview = makeEditPreview(start, end);
      await OBR.scene.local.addItems([preview]);
      editPreviewId = preview.id;
    },
    async onToolDragMove(_, event) {
      if (!editState || !editPreviewId) return;
      const pointer = await drawPoint(event.pointerPosition, editState.sourceId);
      if (editState.mode === "start") {
        editState.currentStart = pointer;
      } else if (editState.mode === "end") {
        editState.currentEnd = pointer;
      } else {
        const dx = pointer.x - editState.pointerStart.x;
        const dy = pointer.y - editState.pointerStart.y;
        editState.currentStart = {
          x: editState.originalStart.x + dx,
          y: editState.originalStart.y + dy
        };
        editState.currentEnd = {
          x: editState.originalEnd.x + dx,
          y: editState.originalEnd.y + dy
        };
      }

      await OBR.scene.local.updateItems([editPreviewId], items => {
        for (const item of items) {
          item.startPosition = editState.currentStart;
          item.endPosition = editState.currentEnd;
        }
      });
    },
    async onToolDragEnd() {
      if (!editState) return;
      const state = editState;
      editState = null;
      try {
        const source = (await OBR.scene.items.getItems([state.sourceId]))[0];
        if (source) {
          const start = inverseTransformPoint(source, state.currentStart);
          const end = inverseTransformPoint(source, state.currentEnd);
          await OBR.scene.items.updateItems([source], items => {
            const item = items[0];
            if (!item) return;
            item.startPosition = start;
            item.endPosition = end;
          });
          await queueSceneReconcile();
          const updated = (await OBR.scene.items.getItems([state.sourceId]))[0];
          await showSelection(updated || null);
        }
      } catch (error) {
        console.error("[WallBrush] Edit failed.", error);
        await OBR.notification.show(
          "墙体调整失败：" + (error?.message || "未知错误"),
          "ERROR"
        );
      } finally {
        if (editPreviewId) {
          try { await OBR.scene.local.deleteItems([editPreviewId]); } catch (error) {}
          editPreviewId = null;
        }
      }
    },
    async onToolDragCancel() {
      editState = null;
      if (editPreviewId) {
        try { await OBR.scene.local.deleteItems([editPreviewId]); } catch (error) {}
        editPreviewId = null;
      }
    },
    async onDeactivate() {
      editState = null;
      selectedSourceId = null;
      await clearSelectionHandles();
      if (editPreviewId) {
        try { await OBR.scene.local.deleteItems([editPreviewId]); } catch (error) {}
        editPreviewId = null;
      }
    }
  });
}

async function createTools() {
  const oldTools = [
    ID + "/diagnostic-v014",
    ID + "/diagnostic-v015",
    ID + "/diagnostic-v016",
    ID + "/tool",
    ID + "/tool-v012",
    ID + "/tool-v013",
    ID + "/tool-v020",
    ID + "/tool-v021",
    ID + "/tool-v030"
  ];
  for (const id of oldTools) {
    try { await OBR.tool.remove(id); } catch (error) {}
  }

  const oldModes = [
    ID + "/draw",
    ID + "/erase",
    ID + "/draw-v012",
    ID + "/erase-v012",
    ID + "/draw-v013",
    ID + "/erase-v013",
    ID + "/draw-v020",
    ID + "/erase-v020",
    ID + "/draw-v021",
    ID + "/erase-v021",
    ID + "/draw-v030",
    ID + "/erase-v030",
    ID + "/door-v030",
    ID + "/window-v030",
    ID + "/edit-v030"
  ];
  for (const id of oldModes) {
    try { await OBR.tool.removeMode(id); } catch (error) {}
  }

  const oldActions = [
    ID + "/toggle-overlay",
    ID + "/toggle-snap",
    ID + "/toggle-overlay-v012",
    ID + "/toggle-snap-v012",
    ID + "/toggle-overlay-v013",
    ID + "/toggle-snap-v013",
    ID + "/guides-v020",
    ID + "/snap-v020",
    ID + "/undo-v020",
    ID + "/redo-v020",
    ID + "/clear-v020",
    ID + "/guides-v021",
    ID + "/snap-v021",
    ID + "/undo-v021",
    ID + "/redo-v021",
    ID + "/clear-v021",
    ID + "/guides-v030",
    ID + "/snap-v030",
    ID + "/undo-v030",
    ID + "/redo-v030",
    ID + "/clear-v030"
  ];
  for (const id of oldActions) {
    try { await OBR.tool.removeAction(id); } catch (error) {}
  }

  await OBR.tool.create({
    id: TOOL_ID,
    icons: [{
      icon: ICON,
      label: "墙壁编辑器",
      filter: { roles: ["GM"] }
    }],
    defaultMode: DRAW_MODE,
    defaultMetadata: { snapToGrid: true }
  });

  await createSegmentMode(DRAW_MODE, DRAW_ICON, "绘制墙壁（拖动）", "wall");
  await createSegmentMode(DOOR_MODE, DOOR_ICON, "绘制门；点击已有门切换开关", "door", async event => {
    await toggleDoorAt(event.pointerPosition);
  });
  await createSegmentMode(WINDOW_MODE, WINDOW_ICON, "绘制窗户（透光、阻挡移动）", "window");

  await OBR.tool.createMode({
    id: ERASE_MODE,
    icons: [{
      icon: ERASE_ICON,
      label: "橡皮擦（点击墙、门或窗）",
      filter: { activeTools: [TOOL_ID], roles: ["GM"] }
    }],
    disabled: { roles: ["PLAYER"] },
    cursors: [{ cursor: "crosshair" }],
    async onToolClick(_, event) {
      if (!(await canEdit())) return false;
      const source = await nearestWall(event.pointerPosition);
      if (source) {
        await OBR.scene.items.deleteItems([source.id]);
        await queueSceneReconcile();
        if (selectedSourceId === source.id) await showSelection(null);
      }
      return false;
    }
  });

  await createEditMode();



  const filter = { activeTools: [TOOL_ID], roles: ["GM"] };

  await OBR.tool.createAction({
    id: ID + "/guides-v030",
    icons: [{ icon: EYE_ICON, label: "显示/隐藏 DM 墙线", filter }],
    async onClick() { await toggleGuides(); }
  });

  await OBR.tool.createAction({
    id: ID + "/snap-v030",
    icons: [{ icon: SNAP_ICON, label: "切换网格吸附", filter }],
    async onClick() { await toggleSnap(); }
  });

  await OBR.tool.createAction({
    id: ID + "/undo-v030",
    icons: [{ icon: UNDO_ICON, label: "撤销上一步场景操作", filter }],
    async onClick() {
      if (await canEdit()) await OBR.scene.history.undo();
    }
  });

  await OBR.tool.createAction({
    id: ID + "/redo-v030",
    icons: [{ icon: REDO_ICON, label: "重做场景操作", filter }],
    async onClick() {
      if (await canEdit()) await OBR.scene.history.redo();
    }
  });

  await OBR.tool.createAction({
    id: ID + "/clear-v030",
    icons: [{ icon: CLEAR_ICON, label: "清空全部 WallBrush 墙壁（需二次点击）", filter }],
    async onClick() { await clearWalls(); }
  });
}

OBR.onReady(async () => {
  try {
    await refreshRole();
    await createTools();

    OBR.scene.items.onChange(() => {
      void queueSceneReconcile();
    });

    OBR.scene.onReadyChange(async ready => {
      if (ready) {
        await initializeScene();
      } else {
        previousItems.clear();
        await removePreview();
      }
    });

    OBR.player.onChange(async () => {
      await refreshRole();
      if (await OBR.scene.isReady()) await initializeScene();
    });

    if (await OBR.scene.isReady()) {
      await initializeScene();
    }

    console.info("[WallBrush] 0.3.0 ready; role =", role);
  } catch (error) {
    console.error("[WallBrush] Startup failed.", error);
    await OBR.notification.show(
      "WallBrush 启动失败：" + (error?.message || "未知错误"),
      "ERROR"
    );
  }
});
