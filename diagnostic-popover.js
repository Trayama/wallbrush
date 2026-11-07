import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

const status = document.getElementById("status");
status.textContent = "Popover JavaScript 已加载。正在等待 Owlbear SDK……";

OBR.onReady(async () => {
  const role = await OBR.player.getRole();
  status.textContent =
    "Popover 页面已加载\n" +
    "Owlbear SDK 已就绪\n" +
    "当前身份：" + role + "\n\n" +
    "后台页面应同时注册右侧的「墙壁编辑器诊断」工具。";
  await OBR.notification.show("[WallBrush 0.1.5] 诊断弹窗 SDK 已就绪", "SUCCESS");
});
