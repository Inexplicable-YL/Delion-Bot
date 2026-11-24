<div align="center">

<picture>
  <img src="assets/DelionBot_white_bg.png" alt="Delion Bot" width="160">
</picture>

</div>

---

<div align="center">

**Delion Bot · A local-first personal agent**
</div>

<div align="center">

_The world keeps changing. Delion Bot stays with you._

</div>

---

> [!IMPORTANT]
> 下载、安装或使用 Delion Bot，即视为你已阅读并同意本项目的[使用条款](docs/terms.md)与[隐私条款](docs/privacy.md)。
> 如果你不同意其中部分内容，可以跳过对应服务的配置、不提供该项凭据，从而仅使用其余功能；如果你不同意全部条款，请停止使用并卸载本软件。

Delion Bot 是基于 Pi 的本地优先个人 Agent 工作台。你可以在一个应用里管理项目、处理文件、记待办和使用已连接的应用。应用没有自己的账号系统；只有使用相应功能时，才连接你配置的模型或外部应用。

## 功能概览

**所有侧栏功能入口可在 “设置 > 通用 > 导航入口” 中隐藏。**

### 个人事务

- **连接器**：从侧栏底部打开「连接器」，填入一次 Composio 项目密钥，选择应用并完成浏览器授权。也可以在聊天中请 Agent 连接 Gmail 等应用。自定义 MCP 在同一页面管理。
- **待办**：记录个人任务、截止时间和备注，在列表和月视图之间切换。
- **全局搜索**：搜索项目、会话和设置。

### Agent 功能

Delion Bot Harness 基于 Pi 构建，可以作为一款通用 agent 产品使用，并且 Delion Bot 在 Coding 领域进行了特别加强。

- **第三方接入**：支持导入第三方 skills、接入 MCP 服务器
- **内置 Skills**：Agent 可以处理待办，也可以读取常见文档。
- **联网**：提供自定义的 `web_search` 工具接入（如 DeepSeek、Brave、Google，默认关闭，需自备 API KEY）与免费的 `web_fetch` 工具（默认开启）
- **上下文**：`@` 引用项目文件、`#` 引用同一项目里的其他会话，Agent 按需读取而不是整段塞进上下文；支持上传附件和选中回复添加评论，旁问可以带着当前上下文临时提问而不进入主对话，也可以从任意一条回复分支出新会话
- **Agent 编排**：主 Agent 可以派出上下文独立、工具相同的子 Agent 并行处理子任务，子会话可在只读标签中查看，可在「设置 › 内置能力」中关闭；也可以读取同一项目内其他会话的对话，比如派子 Agent 总结另一个会话
- **异步执行**：长时间的命令（开发服务器、构建）和子 Agent 可以放到后台运行，结束后结果自动回到会话，Agent 会接着处理；运行中的后台任务显示在输入框工具栏，可随时停止。Agent 回答时还可以继续发送消息补充要求，消息在当前工具执行完后送达，送达前可撤回到输入框
- **Remote project**：把远端服务器目录登记为项目，通过 SSH 建立连接后，Delion Bot 上传 helper runtime 维持本机与服务器之间的稳定通道，Agent 的读写与命令直接在服务器上执行，远端目录变化实时同步到文件树，远端文件可在应用内预览与下载
  共享 HOME 的多个节点可以分别建立连接，helper 运行状态按节点保存。
- **会话导出**：会话顶部的「导出会话」可将当前分支保存为 ZIP，内含精简的 `session.jsonl` 聊天记录、图片、上传附件、文件引用和回复评论，可交给其他 Agent 接续工作；导出包含工具调用和结果，分享前请检查内容

### 工作台功能

- **归档**：项目与聊天的状态筛选默认选中「已启用」。打开已归档的文件或对话时，可以选择「恢复并打开」。文件会移回资料库根目录。
- **Markdown 笔记编辑**：支持对 `.md` 文件即时渲染编辑，支持数学公式与 mermaid 流程图
- **文件编辑**：任意文本文件都能打开编辑（包括 `.env`、`Makefile`、无后缀日志），按内容而不是扩展名识别；1 MB 以上只读预览
- **内置终端**：跟随系统 shell（Windows 优先 PowerShell 7，macOS 为登录 shell），如果是 remote project 则默认为 ssh，默认继承项目目录作为启动路径

## 技术栈

![Electron](https://img.shields.io/badge/Electron-v44-47848F?style=for-the-badge&logo=electron&logoColor=white&labelColor=1F2328)
![React](https://img.shields.io/badge/React-v19-087EA4?style=for-the-badge&logo=react&logoColor=white&labelColor=1F2328)
![TypeScript](https://img.shields.io/badge/TypeScript-v7-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=1F2328)
![Vite](https://img.shields.io/badge/Vite-v8-646CFF?style=for-the-badge&logo=vite&logoColor=white&labelColor=1F2328)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white&labelColor=1F2328)
![Pi](https://img.shields.io/badge/Pi-v1.1-1E293B?style=for-the-badge&logoColor=white&labelColor=1F2328)
![Go](https://img.shields.io/badge/Go-v1.25-00ADD8?style=for-the-badge&logo=go&logoColor=white&labelColor=1F2328)

## 下载安装

首版不配置自动更新。可按下方说明本地构建，或运行 `pnpm package:dist` 生成当前平台的安装包。首版使用独立的应用数据和工作目录，不导入旧数据。

## 本地开发

从 `main` 创建功能分支，并向 `main` 提交 PR。详见 [贡献指南](CONTRIBUTING.md#分支与合并流程)。

推荐使用 [`.node-version`](.node-version) 指定的 Node.js 与 [`package.json`](package.json) 的 `packageManager` 指定的 pnpm，兼容范围见 `engines`（本机可用 `. ./scripts/use-local-tools.ps1` 启用仓库内固定版本）：

本地开发及打包需要 Go 1.25 或更高版本来构建文件隔离程序。

```sh
pnpm install
pnpm dev
```

| 命令                | 用途                                                  |
| ------------------- | ----------------------------------------------------- |
| `pnpm dev`          | 启动开发服务器和窗口，监听主进程/preload 变更         |
| `pnpm build`        | 类型检查与 main/preload/renderer 三入口生产构建       |
| `pnpm test`         | Vitest 单元测试                                       |
| `pnpm smoke`        | Electron 内 SQLite、React 渲染与 preload 隔离冒烟检查 |
| `pnpm package:dist` | 生成 Windows 安装包                                   |

环境搭建细节、冒烟测试与代码组织约定见 [开发文档](docs/DEVELOPMENT.md)；版本与发布流程同样在其中。

## 文档

| 文档                               | 内容                               | 读者           |
| ---------------------------------- | ---------------------------------- | -------------- |
| [开发文档](docs/DEVELOPMENT.md)    | 架构、各子系统约定、构建与发布流程 | 贡献者（先读） |
| [架构决策](docs/adr/README.md)     | 架构决定的背景、内容与后果         | 贡献者         |
| [使用条款](docs/terms.md)          | 软件性质、责任划分与免责范围       | 使用者         |
| [隐私条款](docs/privacy.md)        | 数据存放位置与联网去向             | 使用者         |
| [更新日志](CHANGELOG.md)           | 按版本分节的变更记录               | 贡献者         |
| [贡献指南](CONTRIBUTING.md)        | 环境准备、提交规范与协作方式       | 贡献者         |
| [功能边界](docs/what-we-not-do.md) | 明确不做与需先讨论的功能           | 贡献者         |
| [安全策略](SECURITY.md)            | 漏洞报告渠道、支持范围与安全边界   | 使用者、贡献者 |

## 贡献者

Delion Bot 基于 [Dela](https://github.com/Chang-Yo/Dela) 的源码修改，于 2026-11-20 建立独立项目。感谢原作者、上游贡献者和 Delion Bot 的维护者。

## 许可

本项目以 GNU General Public License v3.0（GPL-3.0-or-later）发布，全文见 [LICENSE](LICENSE)。代码与素材版权归原作者所有。

## 上游赞助鸣谢

您可以前往 “设置 > 关于” 页面为作者提供赞助 🙏

<table>
  <tr>
    <td width="80" align="center" valign="middle">
      <img src="assets/sponsors/FRAMENEO_logo_black.png" width="44" alt="FRAMENEO logo">
    </td>
    <td valign="middle">
      <a href="https://www.frameneo.com/"><strong>FRAMENEO</strong></a><br>
      曾为上游项目的软件包分发提供 CDN 服务。
    </td>
    <td valign="middle">
      <a href="https://www.frameneo.com/">FRAMENEO Website</a>
    </td>
  </tr>
</table>
