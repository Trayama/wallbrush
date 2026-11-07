# WallBrush 0.1.5 诊断版

本版本只诊断 Owlbear 扩展入口和 Tool API，不包含绘墙逻辑。

## 本次修复

- Manifest 的 icon、background_url、action.icon、action.popover 全部改为绝对 HTTPS URL。
- background.html 中的脚本地址改为绝对 HTTPS URL。
- 新增诊断弹窗：用于区分扩展未在当前房间启用、页面资源无法加载、SDK 未就绪。
- 后台 SDK 就绪后先显示通知，再单独注册测试 Tool。

## 安装

https://cdn.jsdelivr.net/gh/Trayama/wallbrush@main/manifest.json

## 观察

1. 安装后在当前房间的扩展菜单中确认启用。
2. 点击左上角的「墙壁编辑器诊断」扩展动作。
3. 如果弹窗显示「HTML 页面已加载」，Popover URL 已正常加载。
4. 如果弹窗显示「Popover 页面已加载 / Owlbear SDK 已就绪」，SDK 在扩展 iframe 内正常工作。
5. 后台若成功，右侧工具栏会出现「墙壁编辑器诊断」图标，并弹出两条通知。
6. 如果弹窗可加载但后台没有通知，问题集中在 background_url / 后台 iframe 加载，而非工具栏 UI。

注意：manifest 及资源 URL 使用绝对地址，避免 Owlbear 将 ./background.html 解析到错误的站点根目录。