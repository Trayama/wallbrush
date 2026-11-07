# WallBrush 0.1.4 诊断版

这是一次最小化诊断，不包含绘制/擦除/墙体同步功能。

它只做两件事：
1. SDK 就绪后弹出「后台脚本已运行」。
2. 调用官方 OBR.tool.create 注册一个名为「墙壁编辑器诊断」的右侧工具图标。

根据结果定位：
- 完全没有通知：background 页面或 SDK 模块没有成功运行。
- 有「后台脚本已运行」，随后报工具注册失败：看错误通知内容。
- 两条成功通知都有但图标不出现：问题在 Owlbear 工具栏显示/房间状态，不在墙体绘制代码。
- 图标出现：后台与 SDK 的基础链路正常，下一步再把完整工具功能逐项加回。

安装 manifest：
https://cdn.jsdelivr.net/gh/Trayama/wallbrush@main/manifest.json
