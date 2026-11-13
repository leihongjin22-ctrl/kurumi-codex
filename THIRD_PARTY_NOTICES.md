# Third-party components

- Marked 17.0.5: bundled under its MIT license; see `vendor/marked-LICENSE.md`.
- Electron 43.3.0: portable builds contain the unmodified upstream runtime files apart from executable filename. The runtime's `LICENSE` and `LICENSES.chromium.html` remain at the portable root. Official download and pinned SHA256 are in `runtime.json`.
- Optional Python document libraries are installed separately under their respective licenses; they are not embedded in this archive. See `requirements-documents.txt`.
- Native Codex is not redistributed. Each user installs it and uses their own account. This project is an independent companion client, not an official OpenAI product.

Packaging reference: https://www.electronjs.org/docs/latest/tutorial/application-distribution
