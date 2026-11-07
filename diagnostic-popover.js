import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

const status = document.getElementById("status");
status.textContent = "HTML 已解析，JavaScript 模块已加载，等待 Owlbear SDK……";

OBR.onReady(async () => {
  const role = await OBR.player.getRole();
  status.textContent =
    "HTML 页面已正确解析\n" +
    "JavaScript 模块已执行\n" +
    "Owlbear SDK 已就绪\n" +
    "当前身份：" + role;
  await OBR.notification.show("[WallBrush 0.1.6] Popover SDK 已就绪。", "SUCCESS");
});
