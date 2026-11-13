---
name: kurumi-setup
description: Install, configure, or launch the Kurumi Codex skin companion client when the user asks to use this skin. The full animation and UI run in a separate Windows client.
---

Use only for an explicit request to set up or launch Kurumi Codex.

Read `../../docs-public/README.md` relative to this skill. The plugin root contains `setup.ps1`, `release-manifest.json`, and the full client source. On Windows, run that root's `setup.ps1` to copy the allowlisted client into the current user's LocalAppData, obtain the pinned SHA256-verified Electron runtime when absent, and create the desktop entry. Do not install or alter native Codex binaries. The user must have installed native Codex and signed in with their own account.

The setup launches a visible configuration wizard. Let the user select a workspace, optional CLI/Python paths, and automatic repair handoff. Do not read login credentials, copy someone else's profile, or enable remote access without the user's request. Explain that the native plugin supplies setup and maintenance skills; the complete skin is in the companion client. If already installed, read the current user's `kurumi-codex-client/install-location.json` under AppData to locate it and verify package.json identifies kurumi-codex-client before launching its script.
