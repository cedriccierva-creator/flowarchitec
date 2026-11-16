# FlowArchitect

A small Tauri 2 + Vue 3 desktop canvas for planning n8n and Make automations. Phase 2A adds dynamic graph editing to Canvas Lab. Edits last for the current session.

## Run

From `/home/cedric/projects/flowarchitect`, with Node available through NVM:

```bash
npm ci
npm run doctor
npm run desktop:dev
```

`desktop:dev` starts Vite on `127.0.0.1:1420` and opens the Tauri desktop window. That server is development tooling; the release application loads bundled local assets and needs no Node process, backend, database, or cloud service.

```bash
# Frontend type check and production build
npm run build

# Compile the standalone Linux executable without creating an installer
npm run desktop:build

# Run the compiled executable
./src-tauri/target/release/flowarchitect

# Optional browser-only development; does not verify Tauri or Wayland
npm run dev
```

The project includes npm and Cargo lockfiles. Use `npm ci` for a fresh frontend install.

## Linux prerequisites

On the project host, `npm run doctor` now detects Node, Rust/Cargo, the Linux development libraries, and the npm dependencies. For a fresh Pop!_OS or Ubuntu machine, install any missing packages from Tauri’s checklist and set up Rust using Rustup. GTK, JavaScriptCore, and libsoup development packages are pulled in by WebKitGTK.

```bash
sudo apt update
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Install Rust using the official installer after reviewing it:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/flowarchitect-rustup-init.sh
less /tmp/flowarchitect-rustup-init.sh
sh /tmp/flowarchitect-rustup-init.sh --profile minimal --default-toolchain stable
source "$HOME/.cargo/env"
```

Network access to npm and Rust crate sources is needed for a fresh build. The compiled app runs offline.

## Canvas

- Open **Add Node**, search the five node types, and choose one. Enter in the search box adds the first match. New nodes appear near the center of the visible canvas.
- Select a node to rename it, choose an icon or color, duplicate it, or delete it. A duplicate copies the node’s settings and has its own ports.
- Drag an output port to an input port, or click the two ports in order. Router exposes separate Success and Error outputs. Webhook has only an output.
- Select an edge to edit or clear its label. Drag either highlighted endpoint to a compatible port to reconnect it. Reconnecting keeps the edge’s label.
- Press Delete or Backspace to remove the selection. Removing a node also removes its connections. Those keys edit text normally in a field. Escape cancels a connection gesture or node drag, discards uncommitted text, or closes the picker or inspector.
- Scroll or pinch to zoom, drag empty canvas to pan, or use the view controls at bottom left. **Reset demo** restores the five original nodes and four edges.

## Structure and dependency purpose

| File | Purpose |
| --- | --- |
| `src/App.vue` | Minimal application frame |
| `src/components/WorkflowCanvas.vue` | Vue Flow graph state, editing actions, and viewport controls |
| `src/components/WorkflowNode.vue` | Reusable icon tile, label, and handles |
| `src/components/NodePicker.vue`, `src/components/GraphInspector.vue` | Searchable picker and contextual editing |
| `src/data/nodeCatalog.ts`, `src/data/sampleWorkflow.ts`, `src/data/workflowGraph.ts` | Node definitions, demo graph, connection validation, and node placement |
| `src/style.css` | Plain CSS, warm charcoal theme |
| `public/` | Local SVG app mark and dot pattern |
| `src-tauri/` | Tauri 2 Rust entry points, window configuration, local icon, empty privileged API capability |
| `scripts/check-prerequisites.mjs` | Read-only environment diagnostic |
| `docs/verification.md` | Actual check results and desktop acceptance checklist |

Runtime frontend dependencies: **Vue 3** for UI, **@vue-flow/core** for canvas behavior, **lucide-vue-next** for icons. Development dependencies: **Vite**, **@vitejs/plugin-vue**, **TypeScript**, **vue-tsc**, **@types/node**, and **@tauri-apps/cli**. Rust dependencies: **tauri** and **tauri-build**.

The frontend structure is adapted from the official cached `create-vite` Vue/TypeScript template. TypeScript settings are kept inline to avoid an extra configuration package. The Tauri shell follows the documented manual/Vite integration; the `create-tauri-app` generator could not download, so it was not run. No n8n source code was copied.

## Verification

The [verification notes](docs/verification.md) record the Phase 2A build, simulated DOM checks, and the remaining COSMIC desktop smoke test.

## Official references

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri + Vite](https://v2.tauri.app/start/frontend/vite/)
- [Tauri project creation](https://v2.tauri.app/start/create-project/)
- [Vue Flow setup](https://vueflow.dev/guide/getting-started.html)
- [Custom nodes](https://vueflow.dev/guide/node.html), [handles](https://vueflow.dev/guide/handle.html), [edges](https://vueflow.dev/guide/edge.html)
