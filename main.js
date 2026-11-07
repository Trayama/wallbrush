import OBR, {
  buildLine,
  buildWall,
  buildLight
} from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0?bundle";

const ID = "com.trpglab.wallbrush";
const TOOL_ID = `${ID}/tool`;
const DRAW_MODE = `${ID}/draw`;
const ERASE_MODE = `${ID}/erase`;
const VISIBILITY_ACTION = `${ID}/toggle-visibility`;
const SNAP_ACTION = `${ID}/toggle-snap`;

const WALL_SOURCE_KEY = `${ID}/wall-source`;
const LOCAL_WALL_KEY = `${ID}/local-wall`;
const LOCAL_LIGHT_KEY = `${ID}/collision-light`;

const TOOL_ICON = new URL("./icons/tool.svg", import.meta.url).href;
const DRAW_ICON = new URL("./icons/draw.svg", import.meta.url).href;
const ERASE_ICON = new URL("./icons/erase.svg", import.meta.url).href;
const EYE_ICON = new URL("./icons/eye.svg", import.meta.url).href;
const SNAP_ICON = new URL("./icons/snap.svg", import.meta.url).href;

let activeInteraction = null;
let dragStart = null;
let syncRunning = false;
let syncRequested = false;

function isWallSource(item) {
  return item?.type === "LINE" &&
    item?.metadata?.[WALL_SOURCE_KEY]?.kind === "blocking-wall";
}

function isPluginWall(item) {
  return item?.type === "WALL" &&
    typeof item?.metadata?.[LOCAL_WALL_KEY]?.sourceId === "string";
}

function isPluginLight(item) {
  return item?.type === "LIGHT" &&
    typeof item?.metadata?.[LOCAL_LIGHT_KEY]?.sourceId === "string";
}

function isCharacterToken(item) {
  return item?.type === "IMAGE" &&
    (item.layer === "CHARACTER" || item.layer === "MOUNT");
}

function samePoint(a, b) {
  return !!a && !!b &&
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01;
}

function sameWallGeometry(localWall, sourceLine) {
  return samePoint(localWall.position, sourceLine.position) &&
    samePoint(localWall.scale, sourceLine.scale) &&
    Math.abs((localWall.rotation ?? 0) - (sourceLine.rotation ?? 0)) < 0.01 &&
    samePoint(localWall.points?.[0], sourceLine.startPosition) &&
    samePoint(localWall.points?.[1], sourceLine.endPosition);
}

function makeLocalWall(sourceLine) {
  return buildWall()
    .points([sourceLine.startPosition, sourceLine.endPosition])
    .attachedTo(sourceLine.id)
    .position(sourceLine.position)
    .rotation(sourceLine.rotation ?? 0)
    .scale(sourceLine.scale ?? { x: 1, y: 1 })
    .blocking(true)
    .doubleSided(false)
    .disableAttachmentBehavior(["VISIBLE", "COPY"])
    .layer("FOG")
    .metadata({
      [LOCAL_WALL_KEY]: { sourceId: sourceLine.id }
    })
    .build();
}

function makeCollisionLight(token) {
  // Wall collision applies to lights and objects attached to lights.
  // This tiny auxiliary light gives ordinary character tokens a collision anchor.
  // If another extension already attached a light to this token, we leave that light alone.
  return buildLight()
    .attachedTo(token.id)
    .position(token.position)
    .attenuationRadius(24)
    .sourceRadius(8)
    .falloff(1)
    .lightType("AUXILIARY")
    .layer("CHARACTER")
    .disableAttachmentBehavior(["SCALE", "COPY"])
    .metadata({
      [LOCAL_LIGHT_KEY]: { sourceId: token.id }
    })
    .build();
}

async function reconcileScene() {
  if (!(await OBR.scene.isReady())) return;

  const sharedItems = await OBR.scene.items.getItems();
  const sourceLines = sharedItems.filter(isWallSource);
  const tokens = sharedItems.filter(isCharacterToken);

  const localItems = await OBR.scene.local.getItems();
  const localWalls = localItems.filter(isPluginWall);
  const localLights = localItems.filter(isPluginLight);

  const sourceById = new Map(sourceLines.map(line => [line.id, line]));
  const tokenById = new Map(tokens.map(token => [token.id, token]));

  const localWallBySource = new Map(
    localWalls.map(wall => [wall.metadata[LOCAL_WALL_KEY].sourceId, wall])
  );

  const wallsToAdd = [];
  const wallsToDelete = [];
  const wallsToUpdate = [];

  for (const line of sourceLines) {
    const existing = localWallBySource.get(line.id);
    if (!existing) {
      wallsToAdd.push(makeLocalWall(line));
    } else if (!sameWallGeometry(existing, line)) {
      wallsToUpdate.push({ local: existing, source: line });
    }
  }

  for (const wall of localWalls) {
    const sourceId = wall.metadata[LOCAL_WALL_KEY].sourceId;
    if (!sourceById.has(sourceId)) wallsToDelete.push(wall.id);
  }

  if (wallsToDelete.length) {
    await OBR.scene.local.deleteItems(wallsToDelete);
  }

  if (wallsToUpdate.length) {
    const updateById = new Map(wallsToUpdate.map(entry => [entry.local.id, entry.source]));
    await OBR.scene.local.updateItems(
      wallsToUpdate.map(entry => entry.local),
      draftWalls => {
        for (const wall of draftWalls) {
          const source = updateById.get(wall.id);
          if (!source) continue;
          wall.points = [source.startPosition, source.endPosition];
          wall.position = source.position;
          wall.rotation = source.rotation ?? 0;
          wall.scale = source.scale ?? { x: 1, y: 1 };
          wall.blocking = true;
          wall.doubleSided = false;
        }
      }
    );
  }

  if (wallsToAdd.length) {
    await OBR.scene.local.addItems(wallsToAdd);
  }

  // Do not create collision anchors unless this scene actually has blocking walls.
  const externalAttachedLightTokens = new Set(
    localItems
      .filter(item =>
        item.type === "LIGHT" &&
        typeof item.attachedTo === "string" &&
        !isPluginLight(item)
      )
      .map(item => item.attachedTo)
  );

  const localLightByToken = new Map(
    localLights.map(light => [light.metadata[LOCAL_LIGHT_KEY].sourceId, light])
  );

  const lightsToDelete = [];
  const lightsToAdd = [];

  for (const light of localLights) {
    const tokenId = light.metadata[LOCAL_LIGHT_KEY].sourceId;
    if (
      sourceLines.length === 0 ||
      !tokenById.has(tokenId) ||
      externalAttachedLightTokens.has(tokenId)
    ) {
      lightsToDelete.push(light.id);
    }
  }

  if (sourceLines.length > 0) {
    for (const token of tokens) {
      if (externalAttachedLightTokens.has(token.id)) continue;
      if (!localLightByToken.has(token.id)) {
        lightsToAdd.push(makeCollisionLight(token));
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
    console.error("[WallBrush] 同步墙壁失败：", error);
    await OBR.notification.show(
      "墙壁同步失败，请打开浏览器控制台查看错误。",
      "ERROR"
    );
  } finally {
    syncRunning = false;
  }
}

async function getDrawPoint(pointerPosition, metadata) {
  if (metadata?.snapToGrid === false) return pointerPosition;
  return OBR.scene.grid.snapPosition(pointerPosition, 1, true, false);
}

function buildSourceLine(start, end) {
  const delta = {
    x: end.x - start.x,
    y: end.y - start.y
  };

  return buildLine()
    .startPosition({ x: 0, y: 0 })
    .endPosition(delta)
    .position(start)
    .strokeColor("#ff4d5e")
    .strokeOpacity(0.9)
    .strokeWidth(4)
    .strokeDash([10, 5])
    .layer("DRAWING")
    .locked(true)
    .metadata({
      [WALL_SOURCE_KEY]: {
        kind: "blocking-wall",
        version: 1
      }
    })
    .build();
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
    )
  );

  const nearest = {
    x: start.x + t * dx,
    y: start.y + t * dy
  };

  return Math.hypot(point.x - nearest.x, point.y - nearest.y);
}

async function createTools() {
  await OBR.tool.create({
    id: TOOL_ID,
    icons: [{
      icon: TOOL_ICON,
      label: "墙壁编辑器",
      filter: { roles: ["GM"] }
    }],
    defaultMode: DRAW_MODE,
    defaultMetadata: {
      snapToGrid: true
    }
  });

  await OBR.tool.createMode({
    id: DRAW_MODE,
    icons: [{
      icon: DRAW_ICON,
      label: "绘制墙壁：按住拖动一段墙",
      filter: {
        activeTools: [TOOL_ID],
        roles: ["GM"]
      }
    }],
    cursors: [{ cursor: "crosshair" }],

    async onToolDragStart(context, event) {
      dragStart = await getDrawPoint(event.pointerPosition, context.metadata);
      const preview = buildSourceLine(dragStart, dragStart);
      activeInteraction = await OBR.interaction.startItemInteraction(preview);
    },

    async onToolDragMove(context, event) {
      if (!activeInteraction || !dragStart) return;
      const end = await getDrawPoint(event.pointerPosition, context.metadata);
      const [update] = activeInteraction;
      update(line => {
        line.position = dragStart;
        line.startPosition = { x: 0, y: 0 };
        line.endPosition = {
          x: end.x - dragStart.x,
          y: end.y - dragStart.y
        };
      });
    },

    async onToolDragEnd(context, event) {
      if (!activeInteraction || !dragStart) return;

      const end = await getDrawPoint(event.pointerPosition, context.metadata);
      const [update, stop] = activeInteraction;

      const line = update(item => {
        item.position = dragStart;
        item.startPosition = { x: 0, y: 0 };
        item.endPosition = {
          x: end.x - dragStart.x,
          y: end.y - dragStart.y
        };
      });

      stop();
      activeInteraction = null;
      dragStart = null;

      if (Math.hypot(end.x - line.position.x, end.y - line.position.y) < 3) {
        return;
      }

      await OBR.scene.items.addItems([line]);
      await requestSync();
    },

    onToolDragCancel() {
      if (activeInteraction) {
        const [, stop] = activeInteraction;
        stop();
      }
      activeInteraction = null;
      dragStart = null;
    }
  });

  await OBR.tool.createMode({
    id: ERASE_MODE,
    icons: [{
      icon: ERASE_ICON,
      label: "橡皮擦：点击墙线删除",
      filter: {
        activeTools: [TOOL_ID],
        roles: ["GM"]
      }
    }],
    cursors: [{ cursor: "crosshair" }],

    async onToolClick(_, event) {
      const lines = await OBR.scene.items.getItems(isWallSource);
      if (!lines.length) return false;

      const scale = Math.max(await OBR.viewport.getScale(), 0.1);
      const tolerance = 18 / scale;

      let nearest = null;
      let nearestDistance = Infinity;

      for (const line of lines) {
        const start = {
          x: line.position.x + line.startPosition.x,
          y: line.position.y + line.startPosition.y
        };
        const end = {
          x: line.position.x + line.endPosition.x,
          y: line.position.y + line.endPosition.y
        };
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
    id: VISIBILITY_ACTION,
    icons: [{
      icon: EYE_ICON,
      label: "显示/隐藏墙线",
      filter: { activeTools: [TOOL_ID], roles: ["GM"] }
    }],
    async onClick() {
      const lines = await OBR.scene.items.getItems(isWallSource);
      if (!lines.length) {
        await OBR.notification.show("当前场景还没有墙壁。", "INFO");
        return;
      }

      const shouldShow = lines.some(line => line.visible === false);
      await OBR.scene.items.updateItems(lines, draftLines => {
        for (const line of draftLines) line.visible = shouldShow;
      });

      await OBR.notification.show(
        shouldShow ? "墙线辅助显示已开启。" : "墙线辅助显示已隐藏，碰撞仍然有效。",
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

OBR.onReady(async () => {
  // The background page runs for every participant. Only the GM receives editing tools.
  OBR.scene.items.onChange(() => requestSync());
  OBR.scene.onReadyChange(ready => {
    if (ready) requestSync();
  });

  const ready = await OBR.scene.isReady();
  if (ready) requestSync();

  const role = await OBR.player.getRole();
  if (role === "GM") {
    await createTools();
  }

  console.info("[WallBrush] 已启动。当前角色：", role);
});
