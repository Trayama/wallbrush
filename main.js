import OBR, {
  buildLine,
  buildWall,
  buildLight
} from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0?bundle";

const ID = "com.trpglab.wallbrush";
const TOOL_ID = ID + "/tool-v012";
const DRAW_MODE = ID + "/draw-v012";
const ERASE_MODE = ID + "/erase-v012";
const OVERLAY_ACTION = ID + "/toggle-overlay-v012";
const SNAP_ACTION = ID + "/toggle-snap-v012";

const WALL_SOURCE_KEY = ID + "/wall-source";
const LOCAL_WALL_KEY = ID + "/local-wall";
const LOCAL_LIGHT_KEY = ID + "/collision-light";
const LOCAL_OVERLAY_KEY = ID + "/local-overlay";
const LOCAL_PREVIEW_KEY = ID + "/local-preview";

const TOOL_ICON = new URL("./icons/tool.svg", import.meta.url).href;
const DRAW_ICON = new URL("./icons/draw.svg", import.meta.url).href;
const ERASE_ICON = new URL("./icons/erase.svg", import.meta.url).href;
const EYE_ICON = new URL("./icons/eye.svg", import.meta.url).href;
const SNAP_ICON = new URL("./icons/snap.svg", import.meta.url).href;

let currentRole = "PLAYER";
let showOverlay = true;
let dragStart = null;
let previewId = null;
let syncRunning = false;
let syncRequested = false;
let syncErrorShown = false;

const zero = { x: 0, y: 0 };
const unit = { x: 1, y: 1 };

function isGM() {
  return currentRole === "GM";
}

async function refreshRole() {
  currentRole = await OBR.player.getRole();
  return currentRole;
}

function isWallSource(item) {
  return item && item.type === "LINE" &&
    item.metadata && item.metadata[WALL_SOURCE_KEY] &&
    item.metadata[WALL_SOURCE_KEY].kind === "blocking-wall";
}

function isPluginWall(item) {
  return item && item.type === "WALL" &&
    item.metadata && item.metadata[LOCAL_WALL_KEY] &&
    typeof item.metadata[LOCAL_WALL_KEY].sourceId === "string";
}

function isPluginLight(item) {
  return item && item.type === "LIGHT" &&
    item.metadata && item.metadata[LOCAL_LIGHT_KEY] &&
    typeof item.metadata[LOCAL_LIGHT_KEY].sourceId === "string";
}

function isPluginOverlay(item) {
  return item && item.type === "LINE" &&
    item.metadata && item.metadata[LOCAL_OVERLAY_KEY] &&
    typeof item.metadata[LOCAL_OVERLAY_KEY].sourceId === "string";
}

function isPluginPreview(item) {
  return item && item.type === "LINE" &&
    item.metadata && item.metadata[LOCAL_PREVIEW_KEY] &&
    item.metadata[LOCAL_PREVIEW_KEY].kind === "wall-preview";
}

function isCharacterToken(item) {
  return item && item.type === "IMAGE" &&
    (item.layer === "CHARACTER" || item.layer === "MOUNT");
}

function samePoint(a, b) {
  return !!a && !!b &&
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01;
}

function sameTransform(a, b) {
  return samePoint(a.position, b.position) &&
    samePoint(a.scale || unit, b.scale || unit) &&
    Math.abs((a.rotation || 0) - (b.rotation || 0)) < 0.01;
}

function sameWallGeometry(localWall, sourceLine) {
  return sameTransform(localWall, sourceLine) &&
    samePoint(localWall.points && localWall.points[0], sourceLine.startPosition) &&
    samePoint(localWall.points && localWall.points[1], sourceLine.endPosition) &&
    localWall.blocking === true &&
    localWall.doubleSided === true;
}

function sameOverlayGeometry(localLine, sourceLine) {
  return sameTransform(localLine, sourceLine) &&
    samePoint(localLine.startPosition, sourceLine.startPosition) &&
    samePoint(localLine.endPosition, sourceLine.endPosition);
}

function makeLocalWall(sourceLine) {
  return buildWall()
    .points([sourceLine.startPosition, sourceLine.endPosition])
    .attachedTo(sourceLine.id)
    .position(sourceLine.position || zero)
    .rotation(sourceLine.rotation || 0)
    .scale(sourceLine.scale || unit)
    .blocking(true)
    .doubleSided(true)
    .disableAttachmentBehavior(["VISIBLE", "COPY"])
    .metadata({
      [LOCAL_WALL_KEY]: { sourceId: sourceLine.id }
    })
    .build();
}

function makeLocalOverlay(sourceLine) {
  return buildLine()
    .startPosition(sourceLine.startPosition)
    .endPosition(sourceLine.endPosition)
    .position(sourceLine.position || zero)
    .rotation(sourceLine.rotation || 0)
    .scale(sourceLine.scale || unit)
    .strokeColor("#ff5364")
    .strokeOpacity(0.95)
    .strokeWidth(4)
    .strokeDash([10, 5])
    .visible(showOverlay)
    .layer("DRAWING")
    .locked(true)
    .metadata({
      [LOCAL_OVERLAY_KEY]: { sourceId: sourceLine.id }
    })
    .build();
}

async function makeCollisionLight(token) {
  const dpi = await OBR.scene.grid.getDpi();
  const radius = Math.max(2, (Number(dpi) || 50) * 0.42);

  return buildLight()
    .attachedTo(token.id)
    .position(token.position)
    .attenuationRadius(radius)
    .sourceRadius(radius)
    .falloff(1)
    .lightType("SECONDARY")
    .layer("CHARACTER")
    .metadata({
      [LOCAL_LIGHT_KEY]: { sourceId: token.id }
    })
    .build();
}

function transformLinePoint(line, point) {
  const scale = line.scale || unit;
  const rotation = (line.rotation || 0) * Math.PI / 180;
  const x = point.x * scale.x;
  const y = point.y * scale.y;

  return {
    x: (line.position ? line.position.x : 0) + x * Math.cos(rotation) - y * Math.sin(rotation),
    y: (line.position ? line.position.y : 0) + x * Math.sin(rotation) + y * Math.cos(rotation)
  };
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

async function reconcileScene() {
  if (!(await OBR.scene.isReady())) return;

  const sharedItems = await OBR.scene.items.getItems();
  const sourceLines = sharedItems.filter(isWallSource);
  const tokens = sharedItems.filter(isCharacterToken);

  // Hide legacy v0.1.0 source lines. The DM gets a local-only visual overlay instead.
  const visibleSources = sourceLines.filter(line => line.visible !== false);
  if (visibleSources.length) {
    await OBR.scene.items.updateItems(visibleSources, lines => {
      for (const line of lines) line.visible = false;
    });
  }

  const localItems = await OBR.scene.local.getItems();
  const localWalls = localItems.filter(isPluginWall);
  const localLights = localItems.filter(isPluginLight);
  const localOverlays = localItems.filter(isPluginOverlay);
  const localPreviews = localItems.filter(isPluginPreview);

  if (localPreviews.length) {
    await OBR.scene.local.deleteItems(localPreviews.map(item => item.id));
  }

  const sourceById = new Map(sourceLines.map(line => [line.id, line]));
  const tokenById = new Map(tokens.map(token => [token.id, token]));
  const localWallBySource = new Map(
    localWalls.map(wall => [wall.metadata[LOCAL_WALL_KEY].sourceId, wall])
  );
  const localOverlayBySource = new Map(
    localOverlays.map(line => [line.metadata[LOCAL_OVERLAY_KEY].sourceId, line])
  );

  const wallsToAdd = [];
  const wallsToDelete = [];
  const wallsToUpdate = [];
  const overlaysToAdd = [];
  const overlaysToDelete = [];
  const overlaysToUpdate = [];

  for (const sourceLine of sourceLines) {
    const existingWall = localWallBySource.get(sourceLine.id);
    if (!existingWall) {
      wallsToAdd.push(makeLocalWall(sourceLine));
    } else if (!sameWallGeometry(existingWall, sourceLine)) {
      wallsToUpdate.push({ local: existingWall, source: sourceLine });
    }

    if (isGM()) {
      const existingOverlay = localOverlayBySource.get(sourceLine.id);
      if (!existingOverlay) {
        overlaysToAdd.push(makeLocalOverlay(sourceLine));
      } else if (
        !sameOverlayGeometry(existingOverlay, sourceLine) ||
        existingOverlay.visible !== showOverlay
      ) {
        overlaysToUpdate.push({ local: existingOverlay, source: sourceLine });
      }
    }
  }

  for (const wall of localWalls) {
    const sourceId = wall.metadata[LOCAL_WALL_KEY].sourceId;
    if (!sourceById.has(sourceId)) wallsToDelete.push(wall.id);
  }

  for (const overlay of localOverlays) {
    const sourceId = overlay.metadata[LOCAL_OVERLAY_KEY].sourceId;
    if (!isGM() || !sourceById.has(sourceId)) overlaysToDelete.push(overlay.id);
  }

  if (wallsToDelete.length) {
    await OBR.scene.local.deleteItems(wallsToDelete);
  }

  if (wallsToUpdate.length) {
    const updateById = new Map(
      wallsToUpdate.map(entry => [entry.local.id, entry.source])
    );
    await OBR.scene.local.updateItems(
      wallsToUpdate.map(entry => entry.local),
      walls => {
        for (const wall of walls) {
          const source = updateById.get(wall.id);
          if (!source) continue;
          wall.points = [source.startPosition, source.endPosition];
          wall.position = source.position || zero;
          wall.rotation = source.rotation || 0;
          wall.scale = source.scale || unit;
          wall.blocking = true;
          wall.doubleSided = true;
        }
      }
    );
  }

  if (wallsToAdd.length) {
    await OBR.scene.local.addItems(wallsToAdd);
  }

  if (overlaysToDelete.length) {
    await OBR.scene.local.deleteItems(overlaysToDelete);
  }

  if (overlaysToUpdate.length) {
    const updateById = new Map(
      overlaysToUpdate.map(entry => [entry.local.id, entry.source])
    );
    await OBR.scene.local.updateItems(
      overlaysToUpdate.map(entry => entry.local),
      lines => {
        for (const line of lines) {
          const source = updateById.get(line.id);
          if (!source) continue;
          line.startPosition = source.startPosition;
          line.endPosition = source.endPosition;
          line.position = source.position || zero;
          line.rotation = source.rotation || 0;
          line.scale = source.scale || unit;
          line.visible = showOverlay;
        }
      }
    );
  }

  if (overlaysToAdd.length) {
    await OBR.scene.local.addItems(overlaysToAdd);
  }

  // Existing attached lights already provide collision. Others get a SECONDARY
  // collision anchor, which cannot independently reveal unexplored fog.
  const externallyLitTokens = new Set(
    localItems
      .filter(item =>
        item.type === "LIGHT" &&
        typeof item.attachedTo === "string" &&
        !isPluginLight(item)
      )
      .map(item => item.attachedTo)
  );

  const validLocalLightByToken = new Map(
    localLights
      .filter(light => light.lightType === "SECONDARY")
      .map(light => [light.metadata[LOCAL_LIGHT_KEY].sourceId, light])
  );

  const lightsToDelete = [];
  const lightsToAdd = [];

  for (const light of localLights) {
    const tokenId = light.metadata[LOCAL_LIGHT_KEY].sourceId;
    if (
      sourceLines.length === 0 ||
      !tokenById.has(tokenId) ||
      externallyLitTokens.has(tokenId) ||
      light.lightType !== "SECONDARY"
    ) {
      lightsToDelete.push(light.id);
    }
  }

  if (sourceLines.length > 0) {
    for (const token of tokens) {
      if (externallyLitTokens.has(token.id)) continue;
      if (!validLocalLightByToken.has(token.id)) {
        lightsToAdd.push(await makeCollisionLight(token));
      }
    }
  }

  if (lightsToDelete.length) {
    await OBR.scene.local.deleteItems(lightsToDelete);
  }
  if (lightsToAdd.length) {
    await OBR.scene.local.addItems(lightsToAdd);
  }
}

async function requestSync() {
  if (syncRunning) {
    syncRequested = true;
    return;
  }

  syncRunning = true;
  try {
    do {
      syncRequested = false;
      await reconcileScene();
    } while (syncRequested);
  } catch (error) {
    console.error("[WallBrush] Scene sync failed:", error);
    if (!syncErrorShown) {
      syncErrorShown = true;
      await OBR.notification.show(
        "墙壁同步失败：" + (error && error.message ? error.message : "未知错误"),
        "ERROR"
      );
    }
  } finally {
    syncRunning = false;
  }
}

async function getDrawPoint(pointerPosition, metadata) {
  if (metadata && metadata.snapToGrid === false) return pointerPosition;
  return OBR.scene.grid.snapPosition(pointerPosition, 1, true, false);
}

function buildHiddenSourceLine(start, end) {
  return buildLine()
    .startPosition(start)
    .endPosition(end)
    .position(zero)
    .visible(false)
    .layer("DRAWING")
    .locked(true)
    .metadata({
      [WALL_SOURCE_KEY]: {
        kind: "blocking-wall",
        version: 2
      }
    })
    .build();
}

function buildPreviewLine(start) {
  return buildLine()
    .startPosition(start)
    .endPosition(start)
    .strokeColor("#ff5364")
    .strokeOpacity(0.95)
    .strokeWidth(4)
    .strokeDash([10, 5])
    .layer("DRAWING")
    .metadata({
      [LOCAL_PREVIEW_KEY]: { kind: "wall-preview" }
    })
    .build();
}

async function removePreview() {
  if (!previewId) return;
  const id = previewId;
  previewId = null;
  try {
    await OBR.scene.local.deleteItems([id]);
  } catch (error) {
    console.warn("[WallBrush] Preview cleanup failed:", error);
  }
}

async function canEditWalls() {
  const role = await refreshRole();
  if (role === "GM") return true;
  await OBR.notification.show("只有房主（GM）可以编辑墙壁。", "WARNING");
  return false;
}

async function createTools() {
  // Tool icon is shown only to GMs. Modes/actions are shown only while this tool is active.
  await OBR.tool.create({
    id: TOOL_ID,
    icons: [{
      icon: TOOL_ICON,
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
      label: "绘制墙壁：按住拖动",
      filter: { activeTools: [TOOL_ID], roles: ["GM"] }
    }],
    cursors: [{ cursor: "crosshair" }],

    async onToolDragStart(context, event) {
      if (!(await canEditWalls())) return;
      dragStart = await getDrawPoint(event.pointerPosition, context.metadata);
      const preview = buildPreviewLine(dragStart);
      await OBR.scene.local.addItems([preview]);
      previewId = preview.id;
    },

    async onToolDragMove(context, event) {
      if (!previewId || !dragStart) return;
      const end = await getDrawPoint(event.pointerPosition, context.metadata);
      await OBR.scene.local.updateItems([previewId], lines => {
        for (const line of lines) line.endPosition = end;
      });
    },

    async onToolDragEnd(context, event) {
      if (!previewId || !dragStart) return;

      const start = dragStart;
      const end = await getDrawPoint(event.pointerPosition, context.metadata);
      dragStart = null;
      await removePreview();

      if (Math.hypot(end.x - start.x, end.y - start.y) < 3) return;

      const sourceLine = buildHiddenSourceLine(start, end);
      await OBR.scene.items.addItems([sourceLine]);
      await requestSync();
    },

    async onToolDragCancel() {
      dragStart = null;
      await removePreview();
    }
  });

  await OBR.tool.createMode({
    id: ERASE_MODE,
    icons: [{
      icon: ERASE_ICON,
      label: "橡皮擦：点击墙线删除",
      filter: { activeTools: [TOOL_ID], roles: ["GM"] }
    }],
    cursors: [{ cursor: "crosshair" }],

    async onToolClick(_, event) {
      if (!(await canEditWalls())) return false;

      const lines = await OBR.scene.items.getItems(isWallSource);
      if (!lines.length) return false;

      const scale = Math.max(await OBR.viewport.getScale(), 0.1);
      const tolerance = 18 / scale;

      let nearest = null;
      let nearestDistance = Infinity;

      for (const line of lines) {
        const start = transformLinePoint(line, line.startPosition);
        const end = transformLinePoint(line, line.endPosition);
        const distance = pointToSegmentDistance(event.pointerPosition, start, end);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = line;
        }
      }

      if (nearest && nearestDistance <= tolerance) {
        await OBR.scene.items.deleteItems([nearest.id]);
        await requestSync();
      }

      return false;
    }
  });

  await OBR.tool.createAction({
    id: OVERLAY_ACTION,
    icons: [{
      icon: EYE_ICON,
      label: "显示/隐藏 DM 墙线辅助",
      filter: { activeTools: [TOOL_ID], roles: ["GM"] }
    }],
    async onClick() {
      if (!(await canEditWalls())) return;
      showOverlay = !showOverlay;
      const overlays = await OBR.scene.local.getItems(isPluginOverlay);
      if (overlays.length) {
        await OBR.scene.local.updateItems(overlays, lines => {
          for (const line of lines) line.visible = showOverlay;
        });
      }
      await OBR.notification.show(
        showOverlay
          ? "DM 墙线辅助已显示。"
          : "DM 墙线辅助已隐藏；碰撞与视野阻挡仍然生效。",
        "SUCCESS"
      );
    }
  });

  await OBR.tool.createAction({
    id: SNAP_ACTION,
    icons: [{
      icon: SNAP_ICON,
      label: "切换网格吸附",
      filter: { activeTools: [TOOL_ID], roles: ["GM"] }
    }],
    async onClick() {
      if (!(await canEditWalls())) return;
      const metadata = await OBR.tool.getMetadata(TOOL_ID);
      const next = metadata.snapToGrid === false;
      await OBR.tool.setMetadata(TOOL_ID, { snapToGrid: next });
      await OBR.notification.show(
        next ? "墙壁绘制：网格吸附已开启。" : "墙壁绘制：网格吸附已关闭。",
        "INFO"
      );
    }
  });
}

let toolsCreated = false;

async function removeLegacyToolbarEntries() {
  const oldIds = {
    tool: ID + "/tool",
    draw: ID + "/draw",
    erase: ID + "/erase",
    overlay: ID + "/toggle-overlay",
    snap: ID + "/toggle-snap"
  };

  const removals = [
    () => OBR.tool.remove(oldIds.tool),
    () => OBR.tool.removeMode(oldIds.draw),
    () => OBR.tool.removeMode(oldIds.erase),
    () => OBR.tool.removeAction(oldIds.overlay),
    () => OBR.tool.removeAction(oldIds.snap)
  ];

  for (const remove of removals) {
    try {
      await remove();
    } catch (error) {
      console.debug("[WallBrush] Legacy toolbar cleanup skipped:", error);
    }
  }
}

async function ensureToolsCreated() {
  if (toolsCreated) return;
  if (!(await OBR.scene.isReady())) return;

  await refreshRole();
  await removeLegacyToolbarEntries();
  await createTools();
  toolsCreated = true;

  await OBR.notification.show(
    isGM()
      ? "墙壁编辑器已注册：请看右侧竖向工具栏底部的红色墙线图标。点击后，顶部左侧是绘制/擦除，顶部右侧是显示辅助线/网格吸附。"
      : "墙壁编辑器已连接。编辑工具仅对房主（GM）显示。",
    "SUCCESS"
  );
  console.info("[WallBrush] toolbar registered; role =", currentRole);
}

OBR.onReady(async () => {
  try {
    await refreshRole();
    console.info("[WallBrush] background loaded; role =", currentRole);

    OBR.scene.items.onChange(() => requestSync());

    OBR.scene.onReadyChange(async ready => {
      if (!ready) return;
      try {
        await ensureToolsCreated();
        await requestSync();
      } catch (error) {
        console.error("[WallBrush] scene-ready setup failed:", error);
        await OBR.notification.show(
          "墙壁编辑器注册失败：" + (error && error.message ? error.message : "未知错误"),
          "ERROR"
        );
      }
    });

    OBR.player.onChange(async () => {
      await refreshRole();
      await requestSync();
    });

    if (await OBR.scene.isReady()) {
      await ensureToolsCreated();
      await requestSync();
    } else {
      await OBR.notification.show(
        "墙壁编辑器后台已启动。打开战斗场景后，工具会加入右侧竖向工具栏。",
        "INFO"
      );
    }
  } catch (error) {
    console.error("[WallBrush] startup failed:", error);
    await OBR.notification.show(
      "墙壁编辑器启动失败：" + (error && error.message ? error.message : "未知错误"),
      "ERROR"
    );
  }
});
