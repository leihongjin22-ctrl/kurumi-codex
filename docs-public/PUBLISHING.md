# 发布到自己的 GitHub

1. 将 `*-source-plugin.zip` 中 `kurumi-codex` 文件夹的内容放进自己的 GitHub 仓库根目录，包含点目录 `.codex-plugin`、`.agents` 和 `.github`。
2. 修改仓库介绍、素材和署名，阅读 LICENSE、ASSET-NOTICE.md 与第三方说明。仓库名称不限；文档中的 YOUR_ACCOUNT/YOUR_REPO 替换为真实地址。
3. 在 Windows、Node.js 22 环境运行 `npm test`，再运行 `./scripts/package-release.ps1`。脚本获取固定版本官方运行时并校验已固定的 SHA256，从发布清单生成包；不会复制当前用户的配置、备份或会话。
4. 将 `dist/*-win-x64.zip`、`*-source-plugin.zip`、`SHA256SUMS.txt` 放进 GitHub Release。不要把 build-cache、dist 或 Electron 二进制提交到源码历史。
5. 已附 GitHub Actions 模板 `.github/workflow-templates/release.yml`。当前 CLI 授权没有工作流写入范围；用 GitHub 网页或具备 `workflow` 写入权限的凭据，把模板复制到 `.github/workflows/release.yml` 后启用。启用后，手动运行生成构建产物，`v*` 标签创建草稿 Release。运行使用仓库自带的 GITHUB_TOKEN，不把个人令牌写入源码。

项目仓库：https://github.com/leihongjin22-ctrl/kurumi-codex 。GitHub 仓库发布与 OpenAI 公共插件目录上架是不同流程；本项目提供仓库市场安装，不声明已经进入公共插件目录。

# Publishing in English

Use the contents of the source ZIP's `kurumi-codex` folder as your repository root, including dot directories. Keep portable binaries in Releases rather than Git history. Run `npm test`, build with `scripts/package-release.ps1`, and upload both ZIPs plus `SHA256SUMS.txt`.

An Actions template is supplied at `.github/workflow-templates/release.yml`. Enable it by copying it to `.github/workflows/release.yml` using the GitHub website or a credential with workflow write permission. It supports manual builds and creates draft releases for version tags. The initial publishing credential only has repository scope; it has not been broadened. Never commit a personal access token.
