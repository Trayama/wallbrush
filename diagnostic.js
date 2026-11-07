import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

const TOOL_ID = "com.trpglab.wallbrush/diagnostic-v014";
const TOOL_ICON = new URL("./icons/tool.svg", import.meta.url).href;

function notify(message, type = "INFO") {
  return OBR.notification.show("[WallBrush 诊断] " + message, type);
}

OBR.onReady(async () => {
  console.info("[WallBrush diagnostic] SDK ready", {
    isReady: OBR.isReady,
    isAvailable: OBR.isAvailable,
    location: window.location.href
  });

  try {
    await notify("后台脚本已运行，SDK 已就绪。", "SUCCESS");
  } catch (error) {
    console.error("[WallBrush diagnostic] notification failed", error);
  }

  try {
    await OBR.tool.create({
      id: TOOL_ID,
      icons: [{
        icon: TOOL_ICON,
        label: "墙壁编辑器诊断"
      }]
    });

    console.info("[WallBrush diagnostic] OBR.tool.create resolved", TOOL_ID);
    await notify("右侧工具注册请求已成功提交。请找红色斜线图标。", "SUCCESS");
  } catch (error) {
    console.error("[WallBrush diagnostic] OBR.tool.create failed", error);
    try {
      await notify(
        "工具注册失败：" + (error && error.message ? error.message : String(error)),
        "ERROR"
      );
    } catch (notificationError) {
      console.error("[WallBrush diagnostic] cannot show error notification", notificationError);
    }
  }
});
