import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

const TOOL_ID = "com.trpglab.wallbrush/diagnostic-v016";
const TOOL_ICON = "https://trayama.github.io/wallbrush/icons/tool.svg";

console.info("[WallBrush 0.1.6] background script loaded");

OBR.onReady(async () => {
  console.info("[WallBrush 0.1.6] OBR.onReady fired");
  await OBR.notification.show("[WallBrush 0.1.6] 后台页面与 SDK 已启动。", "SUCCESS");

  try {
    await OBR.tool.create({
      id: TOOL_ID,
      icons: [{ icon: TOOL_ICON, label: "墙壁编辑器诊断" }]
    });
    console.info("[WallBrush 0.1.6] Tool registered");
    await OBR.notification.show("[WallBrush 0.1.6] 测试工具已注册，请查看右侧工具栏。", "SUCCESS");
  } catch (error) {
    console.error("[WallBrush 0.1.6] Tool registration failed", error);
    await OBR.notification.show(
      "[WallBrush 0.1.6] 工具注册失败：" + (error?.message || String(error)),
      "ERROR"
    );
  }
});
