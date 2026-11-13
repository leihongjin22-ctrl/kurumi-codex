# Kurumi Codex Windows 便携版

完整解压到可写文件夹，先安装原生 Codex 并登录自己的账户。

- `Setup.cmd`：创建桌面快捷方式并打开配置向导。
- `Launch.cmd`：直接启动皮肤客户端。
- `Kurumi Codex.exe`：便携主程序；旁边的 DLL、locales、resources 等必须一起保留。
- `resources/app/README.md`：完整说明、插件安装和可选配置。

本包已包含 Electron，不需要 DSH、Node.js 或 npm。它是独立皮肤客户端；原生维护插件负责安装与修复技能，不替换官方整体 UI。使用自己的 Codex 登录和额度。

配置、草稿和标签在当前用户 AppData 中。升级时先正常退出客户端，再将新版解压到新目录并运行 Setup.cmd；不要覆盖或删除 AppData 用户资料。旧窗口仍有任务时先处理完任务。
