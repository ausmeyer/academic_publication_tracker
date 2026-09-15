# Building and releasing desktop installers

The distributable application includes Electron, the user interface, and the source adapters. End users do not install Node.js, Python, a browser extension, or a separate database. Searches still require internet access. Saved workspaces, notes, metrics, and exports are available offline.

## Build locally

Use Node.js 24 LTS and the committed npm lockfile:

```sh
npm ci
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
node scripts/smoke-electron.mjs
node scripts/smoke-scholar.mjs
```

On macOS:

```sh
npm run dist:mac
```

This creates ad-hoc-signed preview builds for Apple Silicon (`arm64`) and Intel (`x64`): DMGs and ZIP archives in `release/`. Open a DMG and drag the app to Applications. ZIPs contain the complete `.app` bundle.

For a repository inside Google Drive or another synced folder, build outside that folder to prevent Finder metadata from invalidating signatures. After `npm run build`, pass `--config.directories.output=/absolute/local/build-folder` to `electron-builder`, then pass both resulting `.app` paths to `scripts/verify-mac-signatures.mjs`. Copy the finished DMGs/ZIPs back; keep the app bundles outside synchronization.

On Windows:

```sh
npm run dist:win
```

This creates an x64 NSIS installer in `release/`. It supports a user-selected install location and includes the runtime, so it works without downloading prerequisites. Windows on ARM may run the x64 package through Windows emulation; there is no native Windows ARM installer in this release.

Use each platform's native build environment for release verification. Creating a Windows installer on a Mac is not a substitute for installation and launch testing on Windows.

## Signing

Mac preview builds use `electron-builder.preview.yml` to sign the complete app and nested code with an ad-hoc signature. This seals the bundle against accidental modification; it does not identify a trusted Apple developer or notarize the app. Preview users may still need a security exception. Windows preview builds remain unsigned.

`npm run dist:mac` verifies both app bundles with `codesign --verify --deep --strict`. The missing resource seal in v0.4.2 fails this check. A successful local launch is not evidence that a browser-downloaded app passes Gatekeeper.

For a public Mac build, run `npm run dist:mac:signed`. The main configuration requires a signing identity, and the command additionally checks the Apple signature, stapled notarization ticket, and Gatekeeper assessment. Missing credentials or failed verification stop the release. Do not describe an ad-hoc build as Developer ID signed or notarized.

For macOS distribution, supply an Apple Developer ID Application certificate through `CSC_LINK` and `CSC_KEY_PASSWORD`, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for notarization. Electron Builder performs the configured signing/notarization when valid credentials are present. Signing requires the maintainer's Apple Developer membership; no credentials are bundled or committed.

For local signing, Xcode can create and install the Developer ID Application certificate under **Settings → Apple Accounts → your paid team → Manage Certificates → +**. Keep its private key in the login keychain. The certificate does not need to be exported for a local build.

Notarization credentials can also remain in the keychain. Run `xcrun notarytool store-credentials academic-publication-tracker` interactively, entering the Apple account, team ID, and app-specific password at its prompts. Then use `APPLE_KEYCHAIN_PROFILE=academic-publication-tracker npm run dist:mac:signed`. Never put passwords in command arguments, source files, or chat. [Apple certificate instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates).

For Windows, supply the code-signing certificate through `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. Follow your certificate issuer's signing requirements; hardware-backed or cloud signing certificates can require an additional signing integration. Never place signing secrets in the repository.

The workflow reads these values from repository secrets. Pull requests from forks cannot access signing secrets. Without a Mac certificate, the workflow explicitly selects the ad-hoc preview configuration. Empty secret values are unset before invoking the builder. Release notes must state the signing status.

## GitHub workflow

The desktop build workflow runs on native macOS and Windows runners, checks types, runs unit and browser tests, verifies the native desktop shell, builds installers, and launches the packaged application before uploading artifacts. The desktop smoke check uses a fresh temporary profile, makes no live API requests, and tests storage and security boundaries without opening personal credentials. Pushing a version tag such as `v0.4.0` also creates a **draft** release containing both platforms' artifacts. It does not publish the draft automatically.

To inspect the native interface without owning a Windows computer, open a completed GitHub Actions run and download **Desktop-screenshots-win** from its Artifacts section. It contains the packaged app's main screen and new-search dialog captured on Windows. **Desktop-screenshots-mac** provides the corresponding Mac views. These are screenshots, not an interactive remote desktop.

To smoke-test a local packaged candidate, pass its executable to `node scripts/smoke-electron.mjs`. On macOS the executable is inside the `.app` bundle at `Contents/MacOS/Academic Publication Tracker`; on Windows it is `release/win-unpacked/Academic Publication Tracker.exe`. Run `node scripts/smoke-scholar.mjs` with the same executable path to verify the packaged Scholar toolbar, isolated browser, internal paging, verification, and stop/cancel controls using intercepted synthetic pages. Both scripts also accept `--packaged` to select the local host architecture automatically. These checks do not replace testing the installer wizard or signed distribution on a clean computer.

Before tagging:

1. Set the same version in `package.json` and `package-lock.json` and document the release's changes.
2. Run all checks and ensure the platform build jobs succeed.
3. Install and launch the exact candidate artifacts on a clean Mac and Windows computer without development tools.
4. Check a real search, keyless and configured-key sources, restart persistence, export/import, external links, and uninstall behavior.
5. Verify signatures/notarization when signing is configured. Test both Mac architectures before claiming both are validated.
6. Review the draft, state remaining limitations and signing status, and publish it manually when ready.

No GitHub repository or release is created by the local build command. Release automation acts only after the code has been pushed to a configured GitHub repository.

## Local data and recovery

The application stores `workspace.json`, `workspace.json.backup`, and encrypted `settings.json` under Electron's user data directory:

- macOS: `~/Library/Application Support/Academic Publication Tracker/`
- Windows: `%APPDATA%/Academic Publication Tracker/`

The previous valid workspace is retained as `.backup`. If the main file is unreadable, the application loads the valid backup. Before a restore or later save replaces a corrupt primary file, the app preserves its exact original bytes in a timestamped `.corrupt` file. Keep these files when investigating data recovery. API-key encryption is bound to the operating system account; moving the settings file to another machine is not a credential migration mechanism. Use the in-app workspace backup/restore feature to move publication data, then enter credentials on the new computer.

Uninstalling preserves user data. Remove it manually only after exporting a backup if you intentionally want a full reset.
