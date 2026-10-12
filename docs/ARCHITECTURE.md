# Architecture

`src/desktop.mjs` owns the Electron window and narrow native file/save dialogs. The sandboxed renderer communicates with a loopback HTTP service. `src/launch.mjs` exposes the same local interface in a browser for source-based preparation.

`src/service.mjs` defines application operations. All state-changing calls are serialized. The renderer cannot supply arbitrary shell commands or direct game-file writes. Imported mods are copied to a content store and hashed. A mod ID refers to that immutable snapshot; if payload bytes change later, the engine refuses it.

`src/analyze.mjs` builds structured operations from the author section, local readmes, explicit layouts, OIV XML, catalog identities, and verified recipes. AI suggestions are optional and cannot bypass supported operation or evidence checks. A human-reviewed mapping can resolve an otherwise unsupported destination, while mandatory dependencies remain attached.

`src/dependencies.mjs` holds curated IDs and a recursive topological sorter. Required edges are ordered, numeric constraints are checked, duplicate providers are reused, and cycles fail before installation. Missing archives pause dependent branches; unrelated roots can continue. Managed dependents protect shared providers from disable/uninstall.

`src/engine.mjs` is the only game-directory writer. Before installation it checks the selected Legacy executable, preparation mode, running game processes on Windows, import integrity, supported operations, required dependencies, conflicts, and whether destination hashes changed after preview. Sources and destinations pass case-insensitive containment checks. Original archives are mirrored under mods; protected base paths cannot be overridden.

For each transaction, the engine copies previous outer files to verified backups, creates stage copies, applies every operation to those copies, and verifies changes. It writes a persistent prepared journal before the first commit. Atomic file replacement then publishes the staged result. Completion updates the unified database and journal. A failure reverses committed changes. Startup examines interrupted journals; restoration refuses unknown external hashes or damaged backups.

Whole-archive backups mean an earlier mod cannot be removed while a later mod still changes the same physical archive. The app explains that ordering rather than restoring an older archive over newer work. Logical entry claims still distinguish two mods using different EMF slots, so a shared outer archive alone is not presented as an occupied-slot conflict.

`src/rpf.mjs` parses and rebuilds bounded OPEN/NONE RPF7 containers. It preserves resource headers/payloads and existing compressed binary data. `src/backend.mjs` uses native operations when supported and otherwise calls the optional compiled bridge on Windows. Requests use stdin; model data never goes through shell interpolation or Windows' command-line-length limit. Bridge mutations are restricted to staged transaction paths.

`src/oiv.mjs` parses a supported deterministic subset of the official 2.2 format. An unknown operation refuses the whole package. Exports contain proper package metadata, colors, a GUID, content files, and nested archive commands. The generated document is parsed again before export.

Future player-model conversion can be added as a preparation stage that creates a new imported snapshot before planning. Rigging/material validation, Blender/Sollumz invocation, and in-game checks must be completed before such a converter may claim compatibility. There is no placeholder model conversion or fabricated 3D preview in this release.
