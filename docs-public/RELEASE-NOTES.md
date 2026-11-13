# Kurumi Codex 0.9.0

[简体中文介绍](https://github.com/leihongjin22-ctrl/kurumi-codex#readme) · [English overview](https://github.com/leihongjin22-ctrl/kurumi-codex/blob/main/README.en.md)

## 简体中文

时崎狂三主题的 Windows x64 独立 Codex 客户端，包含机械时钟开机动画、角色动态、红金界面和海报背景。完整皮肤在独立客户端运行，附带原生插件负责安装与维护。

- 检测 Codex 版本变化与同步协议不兼容，自动提示并预填原生修复会话；每个版本一次，可关闭，不自动发送任务。
- 客户端首次配置向导、默认工作目录、自定义 CLI/Python 路径。
- 可安装的原生维护插件和本地/GitHub 仓库市场结构。
- Windows x64 完整便携版与干净插件源码包、SHA256、可重复构建脚本及草稿 Release 工作流。
- 保留原有动画、皮肤、会话、文件、审核、终端和手机连接；模型权限和额度使用用户自己的 Codex 账户。

**安装**：先安装原生 Codex 并登录自己的账户，完整解压 `*-win-x64.zip`，运行 `Setup.cmd`。包内包含 Electron，不需要 DSH、Node.js 或 npm。源码/插件用户请阅读 README。

## English

A Kurumi-themed Windows x64 Codex companion with a mechanical-clock opening animation, character motion, crimson/gold styling, and an illustrated chat background. The complete theme runs in the companion client; the native plugin supplies setup and repair skills.

- Independent conversation tabs, history, streaming messages, attachments, file previews, task diffs and review.
- Workspace tools, terminal, plugin/skill access, local schedules, mobile Remote and usage-limit display.
- Version/protocol checks and a prefilled native repair draft after an update-related compatibility failure. The draft is not sent automatically.
- A setup wizard, a self-contained portable build, native maintenance skills, and Chinese/English documentation.

**Install:** install native Codex and sign in with your own account, fully extract `*-win-x64.zip`, and run `Setup.cmd`. Electron is included; DSH, Node.js, and npm are not required.

## Checks / 校验

Portable relocation/startup, live service checks, source tests, plugin installation, and conversation regression have passed. No real model messages were sent by the release tests. The native composer's final prefilled contents have not been visually verified.

Verify the ZIPs against `SHA256SUMS.txt`. Each user supplies their own Codex login and quota. Personal sessions and credentials are not distributed. The Actions file is supplied as a template; see the publishing guide to enable it.
