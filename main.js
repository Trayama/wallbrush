import OBR, { buildLine, buildWall } from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

const ID = "com.trpglab.wallbrush";
const TOOL_ID = ID + "/tool-v020";
const DRAW_MODE = ID + "/draw-v020";
const ERASE_MODE = ID + "/erase-v020";
const WALL_KEY = ID + "/wall";
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
let lastBlockNotice = 0;

const isGM = () => role === "GM";

async function refreshRole() {
  role = await OBR.player.getRole();
  return role;
}

function isWall(item) {
  return item?.type === "WALL" &&
    item.metadata?.[WALL_KEY]?.version === 1;
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
  return item?.type === "LINE" &&
    item.metadata?.[PREVIEW_KEY] === true;
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

function wallSegments(wall) {
  const points = wall.points || [];
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push([
      transformPoint(wall, points[i]),
      transformPoint(wall, points[i + 1])
    ]);
  }
  return segments;
}

function makeSharedWall(start, end) {
  return buildWall()
    .name("WallBrush Wall")
    .points([start, end])
    .position(ZERO)
    .rotation(0)
    .scale(UNIT)
    .blocking(true)
    .doubleSided(true)
    .layer("FOG")
    .locked(true)
    .disableHit(true)
    .metadata({
      [WALL_KEY]: { version: 1, createdBy: "WallBrush" }
    })
    .build();
}

function makeLocalWall(wall) {
  return buildWall()
    .name("WallBrush Local Wall")
    .points(wall.points)
    .attachedTo(wall.id)
    .position(wall.position || ZERO)
    .rotation(wall.rotation || 0)
    .scale(wall.scale || UNIT)
    .blocking(true)
    .doubleSided(true)
    .layer("FOG")
    .disableHit(true)
    .disableAttachmentBehavior(["VISIBLE", "COPY"])
    .metadata({
      [LOCAL_WALL_KEY]: { sourceId: wall.id }
    })
    .build();
}

function makeGuide(wall) {
  const segments = wallSegments(wall);
  if (!segments.length) return null;
  return buildLine()
    .name("WallBrush DM Guide")
    .startPosition(segments[0][0])
    .endPosition(segments[segments.length - 1][1])
    .position(ZERO)
    .strokeColor("#ff5364")
    .strokeOpacity(0.95)
    .strokeWidth(4)
    .strokeDash([9, 5])
    .visible(showGuides)
    .layer("CONTROL")
    .locked(true)
    .disableHit(true)
    .metadata({ [GUIDE_KEY]: { wallId: wall.id } })
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

async function drawPoint(point) {
  if (!snapToGrid) return point;
  try {
    return await OBR.scene.grid.snapPosition(point, 1, true, false);
  } catch (error) {
    console.warn("[WallBrush] Grid snap unavailable; using free point.", error);
    return point;
  }
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

function sameWallGeometry(localWall, sharedWall) {
  if (localWall.blocking !== sharedWall.blocking ||
      localWall.doubleSided !== sharedWall.doubleSided ||
      !samePoint(localWall.position, sharedWall.position) ||
      !samePoint(localWall.scale, sharedWall.scale) ||
      Math.abs((localWall.rotation || 0) - (sharedWall.rotation || 0)) > 0.1) {
    return false;
  }
  const a = localWall.points || [];
  const b = sharedWall.points || [];
  return a.length === b.length && a.every((point, index) => samePoint(point, b[index]));
}

async function reconcileLocalItems(sharedItems) {
  if (!(await OBR.scene.isReady())) return;

  const walls = sharedItems.filter(isWall);
  const localItems = await OBR.scene.local.getItems();
  const localWalls = localItems.filter(isLocalWall);
  const guides = localItems.filter(isGuide);
  const previews = localItems.filter(isPreview);

  if (previews.length) {
    await OBR.scene.local.deleteItems(previews.map(item => item.id));
  }

  const wallById = new Map(walls.map(wall => [wall.id, wall]));
  const localBySource = new Map(
    localWalls.map(wall => [wall.metadata[LOCAL_WALL_KEY].sourceId, wall])
  );
  const guideByWall = new Map(
    guides.map(guide => [guide.metadata[GUIDE_KEY].wallId, guide])
  );

  const wallAdds = [];
  const wallDeletes = [];
  const wallUpdates = [];
  const guideAdds = [];
  const guideDeletes = [];
  const guideUpdates = [];

  for (const wall of walls) {
    const localWall = localBySource.get(wall.id);
    if (!localWall) {
      wallAdds.push(makeLocalWall(wall));
    } else if (!sameWallGeometry(localWall, wall)) {
      wallUpdates.push({ localWall, wall });
    }

    if (isGM()) {
      const guide = guideByWall.get(wall.id);
      const segments = wallSegments(wall);
      if (!guide) {
        const newGuide = makeGuide(wall);
        if (newGuide) guideAdds.push(newGuide);
      } else if (segments.length) {
        guideUpdates.push({
          guide,
          start: segments[0][0],
          end: segments[segments.length - 1][1]
        });
      }
    }
  }

  for (const localWall of localWalls) {
    const sourceId = localWall.metadata[LOCAL_WALL_KEY].sourceId;
    if (!wallById.has(sourceId)) wallDeletes.push(localWall.id);
  }

  for (const guide of guides) {
    const wallId = guide.metadata[GUIDE_KEY].wallId;
    if (!isGM() || !wallById.has(wallId)) guideDeletes.push(guide.id);
  }

  if (wallDeletes.length) await OBR.scene.local.deleteItems(wallDeletes);
  if (wallUpdates.length) {
    const byId = new Map(wallUpdates.map(entry => [entry.localWall.id, entry.wall]));
    await OBR.scene.local.updateItems(
      wallUpdates.map(entry => entry.localWall),
      items => {
        for (const item of items) {
          const wall = byId.get(item.id);
          if (!wall) continue;
          item.points = wall.points;
          item.position = wall.position;
          item.rotation = wall.rotation;
          item.scale = wall.scale;
          item.blocking = true;
          item.doubleSided = true;
        }
      }
    );
  }
  if (wallAdds.length) await OBR.scene.local.addItems(wallAdds);

  if (guideDeletes.length) await OBR.scene.local.deleteItems(guideDeletes);
  if (guideUpdates.length) {
    const byId = new Map(guideUpdates.map(entry => [entry.guide.id, entry]));
    await OBR.scene.local.updateItems(
      guideUpdates.map(entry => entry.guide),
      items => {
        for (const item of items) {
          const entry = byId.get(item.id);
          if (!entry) continue;
          item.startPosition = entry.start;
          item.endPosition = entry.end;
          item.visible = showGuides;
        }
      }
    );
  }
  if (guideAdds.length) await OBR.scene.local.addItems(guideAdds);
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  ));
  const nearest = { x: start.x + t * dx, y: start.y + t * dy };
  return Math.hypot(point.x - nearest.x, point.y - nearest.y);
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, p) {
  return p.x >= Math.min(a.x, b.x) - 0.001 &&
    p.x <= Math.max(a.x, b.x) + 0.001 &&
    p.y >= Math.min(a.y, b.y) - 0.001 &&
    p.y <= Math.max(a.y, b.y) + 0.001;
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

function movementHitsWalls(start, end, radius, walls) {
  for (const wall of walls) {
    for (const [a, b] of wallSegments(wall)) {
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

async function enforceMovement(items, walls) {
  if (!isGM() || previousItems.size === 0 || walls.length === 0) return new Map();

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

    if (movementHitsWalls(oldCenter, newCenter, radius, walls)) {
      rejected.push({ item, oldPosition: clonePoint(previous.position) });
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

    const now = Date.now();
    if (now - lastBlockNotice > 1400) {
      lastBlockNotice = now;
      await OBR.notification.show("墙壁阻挡了棋子的移动。", "INFO");
    }

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
  const walls = items.filter(isWall);
  const blocked = await enforceMovement(items, walls);

  const nextSnapshot = new Map();
  for (const item of items) {
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

  await reconcileLocalItems(items);
}

async function initializeScene() {
  if (!(await OBR.scene.isReady())) return;
  const items = await OBR.scene.items.getItems();
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
  const walls = await OBR.scene.items.getItems(isWall);
  const scale = Math.max(await OBR.viewport.getScale(), 0.1);
  const tolerance = 18 / scale;
  let nearest = null;
  let nearestDistance = Infinity;

  for (const wall of walls) {
    for (const [start, end] of wallSegments(wall)) {
      const distance = pointToSegmentDistance(point, start, end);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = wall;
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
  await OBR.notification.show(showGuides ? "DM 墙线已显示。" : "DM 墙线已隐藏。", "SUCCESS");
}

async function toggleSnap() {
  if (!(await canEdit())) return;
  snapToGrid = !snapToGrid;
  const metadata = await OBR.tool.getMetadata(TOOL_ID);
  await OBR.tool.setMetadata(TOOL_ID, { ...(metadata || {}), snapToGrid });
  await OBR.notification.show(snapToGrid ? "网格吸附已开启。" : "网格吸附已关闭。", "SUCCESS");
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
  const walls = await OBR.scene.items.getItems(isWall);
  if (!walls.length) {
    await OBR.notification.show("当前场景没有 WallBrush 墙壁。", "INFO");
    return;
  }
  await OBR.scene.items.deleteItems(walls.map(wall => wall.id));
  await OBR.notification.show("已清空 " + walls.length + " 段墙壁。", "SUCCESS");
}

async function createTools() {
  const oldTools = [
    ID + "/diagnostic-v014", ID + "/diagnostic-v015", ID + "/diagnostic-v016",
    ID + "/tool", ID + "/tool-v012", ID + "/tool-v013"
  ];
  for (const id of oldTools) {
    try { await OBR.tool.remove(id); } catch (error) {}
  }

  const oldModes = [
    ID + "/draw", ID + "/erase",
    ID + "/draw-v012", ID + "/erase-v012",
    ID + "/draw-v013", ID + "/erase-v013"
  ];
  for (const id of oldModes) {
    try { await OBR.tool.removeMode(id); } catch (error) {}
  }

  const oldActions = [
    ID + "/toggle-overlay", ID + "/toggle-snap",
    ID + "/toggle-overlay-v012", ID + "/toggle-snap-v012",
    ID + "/toggle-overlay-v013", ID + "/toggle-snap-v013"
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

  await OBR.tool.createMode({
    id: DRAW_MODE,
    icons: [{
      icon: DRAW_ICON,
      label: "绘制墙壁（拖动）",
      filter: { activeTools: [TOOL_ID], roles: ["GM"] }
    }],
    disabled: { roles: ["PLAYER"] },
    cursors: [{ cursor: "crosshair" }],
    async onToolDragStart(context, event) {
      if (!(await canEdit())) return;
      snapToGrid = context.metadata?.snapToGrid !== false;
      dragStart = await drawPoint(event.pointerPosition);
      const preview = makePreview(dragStart);
      await OBR.scene.local.addItems([preview]);
      previewId = preview.id;
    },
    async onToolDragMove(_, event) {
      if (!previewId || !dragStart) return;
      const end = await drawPoint(event.pointerPosition);
      await OBR.scene.local.updateItems([previewId], items => {
        for (const item of items) item.endPosition = end;
      });
    },
    async onToolDragEnd(_, event) {
      if (!previewId || !dragStart) return;
      const start = dragStart;
      const end = await drawPoint(event.pointerPosition);
      dragStart = null;
      await removePreview();
      if (Math.hypot(end.x - start.x, end.y - start.y) < 4) return;

      await OBR.scene.items.addItems([makeSharedWall(start, end)]);
      await OBR.notification.show("已绘制墙壁。", "SUCCESS");
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

  await OBR.tool.createMode({
    id: ERASE_MODE,
    icons: [{
      icon: ERASE_ICON,
      label: "橡皮擦（点击墙线）",
      filter: { activeTools: [TOOL_ID], roles: ["GM"] }
    }],
    disabled: { roles: ["PLAYER"] },
    cursors: [{ cursor: "crosshair" }],
    async onToolClick(_, event) {
      if (!(await canEdit())) return false;
      const wall = await nearestWall(event.pointerPosition);
      if (wall) {
        await OBR.scene.items.deleteItems([wall.id]);
        await OBR.notification.show("已删除一段墙壁。", "SUCCESS");
      }
      return false;
    }
  });

  const filter = { activeTools: [TOOL_ID], roles: ["GM"] };

  await OBR.tool.createAction({
    id: ID + "/guides-v020",
    icons: [{ icon: EYE_ICON, label: "显示/隐藏 DM 墙线", filter }],
    async onClick() { await toggleGuides(); }
  });
  await OBR.tool.createAction({
    id: ID + "/snap-v020",
    icons: [{ icon: SNAP_ICON, label: "切换网格吸附", filter }],
    async onClick() { await toggleSnap(); }
  });
  await OBR.tool.createAction({
    id: ID + "/undo-v020",
    icons: [{ icon: UNDO_ICON, label: "撤销上一步场景操作", filter }],
    async onClick() {
      if (await canEdit()) await OBR.scene.history.undo();
    }
  });
  await OBR.tool.createAction({
    id: ID + "/redo-v020",
    icons: [{ icon: REDO_ICON, label: "重做场景操作", filter }],
    async onClick() {
      if (await canEdit()) await OBR.scene.history.redo();
    }
  });
  await OBR.tool.createAction({
    id: ID + "/clear-v020",
    icons: [{ icon: CLEAR_ICON, label: "清空全部 WallBrush 墙壁（需二次点击）", filter }],
    async onClick() { await clearWalls(); }
  });
}

OBR.onReady(async () => {
  try {
    await refreshRole();
    await createTools();

    OBR.scene.items.onChange(items => {
      sceneChangeQueue = sceneChangeQueue
        .then(() => processSceneItems(items))
        .catch(async error => {
          console.error("[WallBrush] Scene update failed.", error);
          await OBR.notification.show(
            "WallBrush 同步失败：" + (error?.message || "未知错误"),
            "ERROR"
          );
        });
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

    if (await OBR.scene.isReady()) await initializeScene();

    await OBR.notification.show(
      isGM()
        ? "WallBrush 0.2.0 已加载。右侧工具栏选择墙壁编辑器开始绘制。"
        : "WallBrush 已连接；编辑工具仅对房主显示。",
      "SUCCESS"
    );
    console.info("[WallBrush] 0.2.0 ready; role =", role);
  } catch (error) {
    console.error("[WallBrush] Startup failed.", error);
    await OBR.notification.show(
      "WallBrush 启动失败：" + (error?.message || "未知错误"),
      "ERROR"
    );
  }
});
