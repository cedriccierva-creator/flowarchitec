# FlowArchitect verification

## Phase 3A — Architect View and Technical Documentation

Checked on 2026-11-16. The worktree started clean at `243792e`.

### Automated checks

| Check | Result |
| --- | --- |
| `npm run doctor` | Passed. The available toolchain and Linux build prerequisites were detected. |
| `npm run build` | Passed. Vue/TypeScript checks and the production bundle completed. |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline` | 2 passed. Native file storage and recovery ID unit tests. |
| `cargo build --manifest-path src-tauri/Cargo.toml --locked --offline --features tauri/custom-protocol` | Passed. Built the Linux executable with embedded frontend assets. |
| `tests/architect-view.test.cjs` | 12 passed. The suite loads the production bundle in jsdom with simulated canvas geometry and Tauri commands in memory. It covers node, edge, and overview edits, Save/Save As/Open, Phase 2B files, independent copies and deletion, history, recovery and normal-close flush, dirty state, text shortcut handling, edge reconnection, and malformed notes. |
| Phase 2B session and canvas smoke harnesses | 30 additional checks passed. Covered existing project actions, graph edits, drag, connection gestures, zoom, pan, and fit with mocked IPC and geometry. |

To run the Architect View suite using Node 22.23.3, install the pinned test helper in a temporary directory:

```bash
npm run build
qa_dir=$(mktemp -d)
npm install --prefix "$qa_dir" --no-save --no-package-lock jsdom@30.1.3
NODE_PATH="$qa_dir/node_modules" node tests/architect-view.test.cjs
```

### Manual COSMIC/Wayland checklist

The sandbox denied Vite's bind to `127.0.0.1:1420` with `EPERM`. The executable with embedded assets also failed to initialize GTK there. Verify the window, WebKitGTK rendering, platform input, and native dialogs from a COSMIC desktop terminal:

```bash
cd /home/cedric/projects/flowarchitect && npm run desktop:dev
```

1. Load the demo and toggle **Architect View**. With the canvas unselected, fill in the four project overview fields. Select a node and fill in all five node note fields. Select a connection, add a multiline technical description, and set a visible label. Confirm the canvas still shows compact nodes and curved, labeled connections.
2. Shrink the window to its minimum size. Scroll the inspector to its last field and action buttons, resize a textarea, and verify that scrolling in the inspector and zooming on the canvas work independently. Pan or move a node while the inspector is open.
3. While typing a note, confirm Enter inserts a new line and Backspace, Delete, Ctrl+Z, Ctrl+Shift+Z, and Ctrl+Y affect only text editing. Press Escape to revert a draft. Commit an edit with Tab, then use graph undo and redo. Check that one graph undo reverses the whole field edit and that returning to the saved checkpoint clears **Unsaved changes**.
4. Duplicate a documented node and change the copy’s notes. Check the original, delete it, and undo the deletion to restore its notes and incident connection descriptions. Reconnect a documented connection at both ends and verify its label and description follow it.
5. Save with a note field still focused. Reopen the saved file and check all three documentation scopes. Save As to a second file and reopen it. Open a Phase 2B JSON file and verify its notes start empty and graph contents are intact. Try opening a copied JSON file with a numeric node purpose and confirm the current project stays open and an error appears.
6. Edit a note, keep its field focused, and close the window normally. Relaunch, choose **Restore as unsaved**, and verify the note and dirty state. To test recovery after abrupt exit with a throwaway project, commit a note, wait for the recovery write, and terminate the app. Relaunch and verify the committed notes.

## Phase 2B — Persistence and Undo/Redo

Checked on 2026-11-16 from a clean worktree at `08fa172`.

### Automated checks

| Check | Result |
| --- | --- |
| `npm run doctor` | Passed. Node, Cargo, GTK, WebKitGTK, and other required development packages were detected. |
| `npm run build` | Passed. Vue/TypeScript and the production bundle built successfully. |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline` | 2 passed. Covered atomic replacement, file isolation, failed-write cleanup, the file-size limit, and recovery ID validation. |
| `cargo build --manifest-path src-tauri/Cargo.toml --locked --offline --features tauri/custom-protocol` | Passed. Built the native executable with frontend assets. |
| Production bundle, session smoke checks | 20 passed in a temporary jsdom harness with mocked Tauri IPC. Covered Save/Open/Save As, dialog cancellation responses, data round-trip, rejection of invalid files, per-project recovery, corrupt snapshots, normal-close flush, New Project, all requested edit operations, the 80-step history limit, and text shortcut handling. |
| Production bundle, canvas regression checks | 10 passed with simulated input and mocked geometry. Covered node appearance, the picker and inspector, Bézier connections, drag and Escape, both reconnection endpoints, deletion and duplication, zoom, pan, and fit. |

### Manual COSMIC/Wayland verification pending

The development launch stopped at Vite's `listen EPERM` on `127.0.0.1:1420`. Running the executable with embedded assets also failed to initialize GTK. Direct connections to the host Wayland and X11 sockets returned `EPERM` in the command sandbox. Native dialogs, real desktop input, and the COSMIC launch require a check from a regular desktop terminal.

```bash
cd /home/cedric/projects/flowarchitect && npm run desktop:dev
```

1. Confirm the window opens to an empty graph. Click **Load demo** and confirm five nodes, four curved edges, and the existing node styling.
2. Rename the project, move a node, change its name, icon, and color, and label an edge. Click **Save** and choose a JSON path. Open that file and compare the title, positions, styles, edges, and label. Use **Save As…** to write a second file. Cancel both the Open and Save As dialogs and confirm the canvas and current path stay the same.
3. Edit project A and give recovery at least a second. Open project B, confirm the switch, then edit B without saving. Close and reopen FlowArchitect. Verify both recovery entries are offered. Click **Restore as unsaved** for A and confirm the edits return with no file path. Open the original saved A file separately to verify it still has the saved contents. An interrupted-session test can be done with a throwaway workflow by terminating the app after the autosave interval.
4. Undo and redo node add, duplicate, delete, drag, rename, icon and color changes. Repeat for edge creation, deletion, labeling, and reconnection at both ends. One Ctrl+Z should undo a full drag. Test Ctrl+Shift+Z and Ctrl+Y. In a text field, use the same shortcuts and confirm they edit only the text.
5. Attempt to open invalid JSON, a copied file with a repeated node ID, and a copied file with an edge pointing to a missing node. Confirm each error leaves the current workflow in place. Start **New Project** with unsaved changes, cancel once, then confirm and check that the graph, file path, and undo state reset.
6. Confirm click-to-connect, Escape cancellation, normal Delete and Backspace in text fields, zoom, pan, fit, and window resizing on COSMIC.

## Phase 2A — Dynamic Graph Editing

During the initial checks on 2026-11-16, Git found no repository in the command environment, which exposes a read-only `.git` placeholder. The Phase 1 source and lockfiles were checkpointed as commit `36710f2` in the temporary repository `/tmp/flowarchitect-phase1-EKF3pz`.

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

The user later reported completing desktop verification on Pop!_OS 24.04 with COSMIC/Wayland.

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
