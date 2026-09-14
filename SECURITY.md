# Security

The desktop renderer runs with a sandbox, context isolation, and no Node.js access. A narrow preload bridge exposes validated operations to the main process. Its navigation, popups, webviews, and browser permissions are blocked. External publication links open in the system browser and must use HTTP or HTTPS. Copying a DOI uses a validated text-only clipboard-write operation; the app exposes no clipboard-read operation.

Google Scholar loads internally in a separate sandboxed remote view without a preload bridge or Node.js access. Its temporary session is separate from the app workspace. A local verification toolbar and the main app expose guarded search controls. Internal collection runs a fixed, read-only extraction function on supported Scholar pages, then validate and bound the resulting publication metadata. The function does not read credentials, solve verification challenges, click links, or make network requests. Pagination follows validated same-query Scholar result links with bounded pacing and limits. Google receives page requests; sign-in and verification remain user actions. Captured page URLs are stored with publication provenance and included in workspace exports.

Workspaces are stored locally with atomic replacement and one recovery copy. API keys are encrypted using Electron `safeStorage`, backed by the current macOS or Windows account. The application refuses to save keys if encryption is unavailable. Workspace exports do not contain settings or API keys. Files imported or exported through native dialogs are limited to 25 MB.

Email addresses in source settings and publication notes are stored locally without encryption. API providers receive submitted searches and applicable credentials. The app does not send telemetry or synchronize your library to a project server.

Please report suspected vulnerabilities through GitHub's private vulnerability reporting on the repository's **Security** tab once the maintainers enable it. Do not include secrets or private publication data in a public issue. If private reporting is unavailable, open a public issue requesting a private reporting channel without disclosing exploit details.

Version 0.4 is an early release. Security fixes target the latest released version. See `docs/RELEASING.md` for code signing and release verification.
