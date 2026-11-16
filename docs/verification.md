# FlowArchitect verification

## Phase 2A — Dynamic Graph Editing

Checked on 2026-11-16. Git found no repository in the command environment, which exposes a read-only `.git` placeholder. The Phase 1 source and lockfiles were checkpointed as commit `36710f2` in the temporary repository `/tmp/flowarchitect-phase1-EKF3pz`.

| Check | Result |
| --- | --- |
| `npm run doctor` | Passed. Node, Rust/Cargo, native development libraries, and frontend dependencies are present. |
| `npm run build` | Passed. Vue/TypeScript check and production Vite bundle both completed. |
| `cd src-tauri && cargo check --locked --offline` | Passed. Tauri and the native development dependencies compiled for the Rust check. |
| Production bundle in a simulated DOM | 10 checks passed with synthetic input and mocked layout. The harness used cached jsdom in a temporary directory. |
| `npm run desktop:dev` | Blocked before Tauri launch. Vite returned `listen EPERM: operation not permitted 127.0.0.1:1420`. Connections to the host Wayland and X11 sockets also returned `EPERM`. |
| Phase 2A Tauri window, WebKit rendering, and native input | Pending on the COSMIC desktop. |

The simulated DOM checks mounted the production bundle. They exercised the five-node sample and Bézier paths, picker search and node placement, rename/icon/color edits, input-safe Delete and Backspace, edge creation with a preview, duplicate and self-loop rejection, click-to-connect, edge tracking during a drag, reconnecting both endpoints, duplicate reconnect rejection, preserving edge IDs and labels, edge and node deletion, duplication, Escape cancellation, pan, zoom, fit, and reset. The harness captured no console warnings or errors.

### Phase 2A desktop smoke test

From a normal terminal on the Pop!_OS desktop:

```bash
cd /home/cedric/projects/flowarchitect
npm run desktop:dev
```

1. Confirm a FlowArchitect window opens with five nodes and four edges. Open the WebKit inspector and check its console while running the following steps.
2. Click **Add Node**, search for HTTP, and add **HTTP Request**. Confirm the new node appears within the current view. Choose a new name, the Mail icon, and Violet in the inspector.
3. Drag the new output to **AI Agent**’s input. Confirm the preview and a fifth edge. Repeat the same connection and drag to the node’s own input. Both should leave the count at five.
4. Drag the new node and confirm the edge follows. Start another drag and press Escape to restore the position.
5. Select the new edge, give it a label, and drag its highlighted target endpoint to **Error Handler**’s input. The edge count and label should stay the same. Also try reconnecting from the source endpoint and cancelling a reconnect with Escape.
6. Delete the edge using the inspector or Delete. Duplicate the edited node and verify its appearance is copied. Press Delete and Backspace while typing in its name field, then select the tile and delete it using Backspace.
7. Verify wheel/pinch zoom, canvas panning, **Fit workflow to view**, and resizing. **Reset demo** should restore five nodes and four connections. Reopen the window and check for console errors or repainting issues.

## Phase 1 — Canvas proof of concept

The user ran the Phase 1 desktop app on Pop!_OS 24.04 with COSMIC/Wayland and reported passes for node dragging, zoom, pan, Fit View, and window resizing. Connection creation, connection tracking, and stability were not tested in that pass.

### Initial implementation and recovery runs

The following records describe the initial restricted command environment on 2026-11-16.

After approval, a recovery attempt in that environment hit denied DNS socket access (`EPERM`) and denied sudo elevation (`NoNewPrivs: 1`). The [recovery log](environment-recovery.md) records those commands and results. The dependencies were present by the Phase 2A inspection.

#### Environment

| Check | Observed result |
| --- | --- |
| OS/session | Pop!_OS 24.04 LTS; `XDG_CURRENT_DESKTOP=COSMIC`, `XDG_SESSION_TYPE=wayland` |
| Displays | `WAYLAND_DISPLAY=wayland-1`, `DISPLAY=:0` |
| Node/npm | 22.23.3 / 10.9.9; Node provided by NVM |
| C compiler, build-essential, pkg-config, OpenSSL dev | Available |
| rustc / cargo | Not found; no `~/.cargo` or `~/.rustup` directory |
| GTK 3, WebKitGTK 4.1, JavaScriptCoreGTK 4.1, libsoup 3 dev | Not found through pkg-config |
| librsvg dev | Missing |
| npm registry | `curl` failed: could not resolve `registry.npmjs.org` |
| Existing project | No application files were present; environment-managed directories were preserved |

#### Initial acceptance status

| Verification | Status |
| --- | --- |
| Vue script and template compilation | Passed for all three `.vue` components using locally cached Vue compiler 3.5.44 in an isolated temporary QA directory |
| TypeScript syntax/transpilation | Passed for main entry, sample graph, Vite config, and compiled Vue scripts using cached TypeScript 5.9.3; **not a full type check** |
| CSS and JSON syntax | Passed CSS parsing and all six project JSON configurations |
| Sample graph integrity | Passed unique node/edge IDs, valid node/handle references, and independent reset factory data |
| Native manifest and assets | Cargo TOML and SVG parsing passed; app PNG verified as 128×128 RGBA; native compilation still pending |
| Prerequisite script syntax | `node --check scripts/check-prerequisites.mjs` passed |
| `npm install` | Failed: `ENOTFOUND registry.npmjs.org`; no project dependencies were installed |
| `npm run doctor` | Reported missing Rust/Cargo and dependencies; some subprocess pkg-config calls were blocked by the restricted execution environment; direct pkg-config calls independently confirmed the missing libraries |
| Frontend production build | Blocked: required npm dependencies could not be downloaded |
| Tauri compilation and launch | Blocked: npm dependencies, Rust/Cargo, and Linux development libraries missing |
| Drag nodes | Not exercised |
| Create connections | Not exercised |
| Zoom and pan | Not exercised |
| COSMIC/Wayland window behavior | Not exercised |

The attempted `npm run build` stopped at `vue-tsc: not found`. The attempted `npm run desktop:dev` stopped at `tauri: not found`. The isolated cached compiler checks validate source syntax, not dependency linking, Vue Flow runtime behavior, Tauri configuration schema, or WebKit rendering. Temporary QA tools were not added to the application's dependency list.
