# WallBrush（墙壁编辑器）

WallBrush 是一个用于 Owlbear Rodeo 的轻量级墙壁绘制扩展。房主（GM）在地图上绘制墙线后，扩展会把墙线同步到房间，并由每位参与者的客户端生成对应的本地 `Wall` 碰撞对象。

## 安装

在 Owlbear Rodeo 的个人资料／扩展管理中选择添加扩展，将下面的 Manifest URL 粘贴进去：

```text
https://cdn.jsdelivr.net/gh/Trayama/wallbrush@main/manifest.json
```

安装后进入房间，在扩展列表中启用「墙壁编辑器」。绘制工具仅对 GM 显示；其他参与者会自动接收场景中的墙线并生成本地碰撞墙。

## 功能

- **绘制墙壁**：按住鼠标拖动，创建一段直线墙；拐角由多段墙组成。
- **橡皮擦**：点击墙线附近，删除最近的一段墙。
- **显示／隐藏墙线**：隐藏红色辅助线时，碰撞墙仍然生效。
- **网格吸附**：默认开启，可在工具栏动作中切换为自由绘制。
- **多人同步**：墙线保存在 Owlbear 场景中；每个客户端独立生成本地碰撞墙。
- **角色碰撞锚点**：场景存在墙壁时，为没有其他附着光源的 Character／Mount 棋子生成微型辅助光源，以便原生墙壁碰撞作用于棋子；已有附着光源时会复用，不额外创建。

## 本地运行

要求 Node.js 18 或更新版本。

1. 下载本仓库代码，解压。
2. 双击 `start.bat`，保持命令行窗口运行。
3. 在 Owlbear Rodeo 中添加扩展，Manifest URL 填写：

   ```text
   http://localhost:5173/manifest.json
   ```

本地地址只适用于当前电脑测试。远程参与者无法通过自己的 `localhost` 访问房主电脑；多人使用时请安装上面的公共 HTTPS Manifest URL。

## 项目结构

- `manifest.json`：Owlbear 扩展清单。
- `background.html`：扩展后台页面。
- `main.js`：墙线绘制、场景同步与本地碰撞对象生成逻辑。
- `icons/`：工具栏图标。
- `serve.mjs`、`start.bat`：本地静态文件服务器及启动脚本。

## 版本

当前版本：**0.1.0**。
