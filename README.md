# FlowArchitect

A small Tauri 2 + Vue 3 desktop canvas for planning n8n and Make automations. Document the design in Architect View and walk through the same workflow in Client View or Presentation Mode.

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
- Scroll or pinch to zoom, drag empty canvas to pan, or use the view controls at bottom left.

## Architect View

- Turn on **Architect View** in the toolbar. Select a node to edit its purpose, inputs, outputs, configuration notes, and error-handling strategy. Node duplicates have independent copies of those notes. Deleting a node deletes its notes and its connections’ descriptions.
- Select a connection to write its technical description, such as a data contract, routing condition, or fallback. The **Label** field controls the canvas label. Reconnecting either endpoint keeps both fields.
- Click empty canvas to edit the **Project overview**, which holds the summary, architecture goals, assumptions, and constraints.
- Notes accept multiline plain text. Tab or click away to commit one field edit to project history. **Escape** in a note restores its last committed text. Inside the field, Enter inserts a line break, and the usual text-editing shortcuts apply. Save, project switches, and normal window close also commit a focused note.
- Recovery captures committed notes after the usual 500 ms delay. A forced exit can lose text still being edited in a focused field or committed too recently for the snapshot to finish.

## Client View and Presentation Mode

- Turn on **Architect View** and select a node. In the inspector’s **Client View** section, enter a **Client label** and **Business description**. Tab or click away to commit each field. Escape restores its last committed text. Duplicating a node copies both fields.
- Click **Client View** in the toolbar to see the read-only diagram. The larger cards use the client label when available and the technical name otherwise. Long labels and descriptions show up to two lines each. Hover over either field to read the full text. Ports, edge labels, and editing controls are hidden. Click **Back to Architect View** to edit or manage project files.
- Click **Present** to give the diagram the full app content area. Pan, zoom, and **Fit workflow to view** work in both client modes. Click **Exit Presentation** or press Escape to return to Client View. View changes preserve the current viewport and leave project history intact.
- Cards keep their Architect canvas coordinates. Closely spaced nodes may overlap in Client View. Adjust their spacing in Architect View when preparing a diagram for presentation.

## Export

- **Export PNG** creates the complete Client View diagram from either workflow view, including nodes outside the viewport. It keeps the current layout, port-specific curves, icons, colors, and two-line client text previews on a padded charcoal background. It uses 2× pixel density when the image fits within 8,192 pixels per side and 16 megapixels. Larger diagrams scale down to fit those limits.
- **Export Markdown** writes the project overview, a topology summary, node documentation, and connection documentation in workflow order. It preserves multiline notes and escapes Markdown formatting in project text. Empty technical fields appear as **Not documented.**
- Both buttons use the Linux desktop save dialog. The suggested filename comes from the project title. Keep the `.png` or `.md` extension when renaming it. The dialog confirms before replacing an existing file. Either format can export an empty workflow.
- Export reads committed fields, including unsaved project edits. Finish editing a draft field with Tab before exporting it. Exports operate offline and leave the open project, its file path, undo history, and recovery state in place. The buttons are available outside Presentation Mode.

## Project files, recovery, and history

- The app starts with an empty workflow. Click the project title to rename it. **New Project** resets the graph and project name. **Load demo** starts a separate workflow with the original five nodes and four edges. Switching away from unsaved changes requires confirmation.
- **Save** writes to the current file, or prompts for a location on the first save. **Save As…** chooses a destination, and **Open…** validates a local workflow before switching. The canvas footer shows the current filename and unsaved status. Hover over it for the full path.
- Workflow JSON uses `schemaVersion: 1` and stores the project name, nodes, positions, icons, colors, connections, and labels. Documentation is optional under `metadata.overview`, `nodes[].documentation`, and `edges[].description`. Phase 2B files open with empty fields. Blank notes are omitted on save. Each note supports up to 8,000 UTF-16 code units. Files must be UTF-8 and at most 8 MiB. Saving writes a temporary file beside the destination and atomically renames it into place on Linux.
- Client metadata uses optional `nodes[].clientLabel` and `nodes[].businessDescription` fields. Labels are single-line text up to 80 UTF-16 code units, and descriptions allow up to 240. Blank values are omitted from JSON. Phase 2B and 3A files use the technical node names in Client View. Client metadata participates in save, reopen, undo, redo, and recovery alongside technical notes.
- Unsaved edits are written after 500 ms of inactivity to snapshots under Tauri's application-data `recovery` folder. On Linux this is normally `~/.local/share/io.flowarchitect.desktop/recovery/`. Switching projects or closing the window flushes pending edits. Snapshots are offered at startup. **Restore as unsaved** loads a copy that needs an explicit file destination, and **Discard snapshot** permanently removes the selected snapshot after confirmation.
- **Ctrl+Z** undoes an edit. **Ctrl+Shift+Z** and **Ctrl+Y** redo. The workspace keeps up to 80 undo steps in memory per open workflow. A drag counts as one step, and text fields keep their own editing shortcuts.

Native file, recovery, and export actions are available in the Linux Tauri app. The browser preview supports canvas editing and history.

## Structure and dependency purpose

| File | Purpose |
| --- | --- |
| `src/App.vue` | Minimal application frame |
| `src/components/WorkflowCanvas.vue` | Vue Flow state, project and recovery controls, and keyboard shortcuts |
| `src/composables/useWorkflowSession.ts` | Active project, unsaved state, history, and recovery scheduling |
| `src/data/workflowDocument.ts`, `src/data/desktop.ts` | Workflow schema, validation, and Tauri command bridge |
| `src/data/exportPng.ts`, `src/data/exportMarkdown.ts` | Client diagram rasterization and architecture documentation formatting |
| `src/components/WorkflowNode.vue` | Architect tile, Client View card, and shared connection anchors |
| `src/components/NodePicker.vue`, `src/components/GraphInspector.vue` | Searchable picker and contextual editing |
| `src/components/DocumentationField.vue` | Plain text editing and blur commits |
| `src/data/nodeCatalog.ts`, `src/data/sampleWorkflow.ts`, `src/data/workflowGraph.ts` | Node definitions, demo graph, connection validation, and node placement |
| `src/style.css` | Plain CSS, warm charcoal theme |
| `public/` | Local SVG app mark and dot pattern |
| `src-tauri/` | Tauri shell, GTK file dialogs, atomic file writes, and local recovery storage |
| `scripts/check-prerequisites.mjs` | Read-only environment diagnostic |
| `tests/architect-view.test.cjs` | Production bundle tests with simulated input and mocked Tauri commands |
| `docs/verification.md` | Actual check results and desktop acceptance checklist |

Runtime frontend dependencies: **Vue 3** for UI, **@vue-flow/core** for canvas behavior, **lucide-vue-next** for icons. Development dependencies: **Vite**, **@vitejs/plugin-vue**, **TypeScript**, **vue-tsc**, **@types/node**, and **@tauri-apps/cli**. Rust dependencies include **tauri**, **tauri-build**, and a direct Linux reference to **gtk**, which Tauri already uses and had locked. No npm packages or Rust crate versions were added.

The frontend structure is adapted from the official cached `create-vite` Vue/TypeScript template. TypeScript settings are kept inline to avoid an extra configuration package. The Tauri shell follows the documented manual/Vite integration; the `create-tauri-app` generator could not download, so it was not run. No n8n source code was copied.

## Verification

The [verification notes](docs/verification.md) record the automated results, test commands, and Phase 4A COSMIC/Wayland checklist.

## Official references

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri + Vite](https://v2.tauri.app/start/frontend/vite/)
- [Tauri project creation](https://v2.tauri.app/start/create-project/)
- [Vue Flow setup](https://vueflow.dev/guide/getting-started.html)
- [Custom nodes](https://vueflow.dev/guide/node.html), [handles](https://vueflow.dev/guide/handle.html), [edges](https://vueflow.dev/guide/edge.html)
