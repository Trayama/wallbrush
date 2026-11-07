import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

const TOOL_ID = "com.trpglab.wallbrush/diagnostic-v015";
const TOOL_ICON = "https://cdn.jsdelivr.net/gh/Trayama/wallbrush@main/icons/tool.svg?v=0.1.5";

async function notify(message, type = "INFO") {
  try {
    await OBR.notification.show("[WallBrush 0.1.5] " + message, type);
  } catch (error) {
    console.error("[WallBrush 0.1.5] notification failed:", error);
  }
}

console.info("[WallBrush 0.1.5] script evaluated", {
  isReady: OBR.isReady,
  isAvailable: OBR.isAvailable
});

OBR.onReady(async () => {
  console.info("[WallBrush 0.1.5] OBR.onReady fired");
  await notify("后台页面与 SDK 均已启动。", "SUCCESS");

  try {
    await OBR.tool.create({
      id: TOOL_ID,
      icons: [{
        icon: TOOL_ICON,
        label: "墙壁编辑器诊断"
      }]
    });
    console.info("[WallBrush 0.1.5] OBR.tool.create resolved");
    await notify("测试工具已提交注册，请查看右侧工具栏。", "SUCCESS");
  } catch (error) {
    console.error("[WallBrush 0.1.5] tool registration failed:", error);
    await notify("工具注册失败：" + (error?.message || String(error)), "ERROR");
  }
});
