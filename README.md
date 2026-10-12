# Legacy Mod Suite 0.1.0

A Windows desktop application for GTA V Legacy mod installation, with an Apple Silicon preparation interface. It imports ZIP/RAR/7z/OIV archives, builds validated installation plans, orders required dependencies, and backs up every changed physical file or archive. The same database tracks the library, profiles, queue, editor changes, and transaction history.

This release has a tested native engine for OPEN/NONE RPF7 archives. Encrypted game archives use an optional CodeWalker adapter whose compilation has been checked; its real-game integration still needs Windows testing. Full automatic installation of arbitrary GTA5-Mods pages is unfinished. The supported workflows and remaining gaps are listed in [docs/CAPABILITIES.md](docs/CAPABILITIES.md).

## Run the Windows package

1. Extract the entire Windows ZIP into a folder.
2. Run **LegacyModSuite.exe**. Keep the supplied resources beside the executable.
3. Open **Settings**, choose the folder containing your Legacy **GTA5.exe**, and save.
4. Use **Import** to choose an archive or extracted folder. For a URL blocked by the host, download through your browser and paste the author's instructions into the mod's **Details**.
5. Open the mod's **Preview**. Review its destinations and conflicts, then run **Install dependencies → mod**. An unavailable dependency pauses the branch and names the archive needed in **Dependencies**.
6. To undo an installation, use **Disable** in **Library**. Newer changes sharing the same physical archive must be disabled first.

The Windows package includes Electron and the archive extractors; Node.js is not required for this packaged version. It is unsigned and has not been executed on a Windows machine during this build session.

## Run on your M4 Mac

**Known issue with the personally delivered 0.1.0 Mac ZIP:** macOS has rejected the packaged app with a “damaged and can't be opened” alert. The build was produced on Linux without a macOS signing or runtime check. The exact cause has not been established. Use the source-based launch below while native packaging is corrected and verified on macOS.

Extract the Apple Silicon ZIP and open **Legacy Mod Suite.app**. The Mac package runs in preparation mode: importing, read-only supported archive browsing, instruction analysis, dependency preparation, OIV generation, and Windows bundle export. Installation and profile application remain disabled on macOS.

The Mac app is unsigned, not notarized, and has not been launched on an M4 during this build session. If macOS blocks it, the source package also provides **Start-Mac.command**: install Node.js 22.13 or newer, then run that command. It starts the same interface in your browser. The first run installs the two archive dependencies.

To launch from source on your Mac, install Node.js 22.13 or newer, open Terminal in the extracted project folder, and run:

```sh
npm ci
npm run desktop
```

This downloads Electron for your Mac and runs the application locally. If you prefer the browser interface, run `npm start` after `npm ci`. Mac preparation mode applies to both interfaces.

## Your Short Dreads test

The personally delivered source package and Windows extras include:

- `samples/Short-Dreads-for-Franklin-Windows-bundle.zip`
- `samples/Short-Dreads-for-Franklin.oiv`
- `tests/fixtures/Supplied-ShortDreads.rar`

These third-party mod assets are excluded from this Git repository. Import your own archive to use the application. To run the optional real-asset tests, place your legally obtained original Short Dreads RAR at `tests/fixtures/Supplied-ShortDreads.rar` or set `LEGACY_TEST_RAR` to its absolute path. The corresponding tests skip when the fixture is absent; the remaining tests use synthetic data.

On Windows, choose **Import → Import Windows bundle**, select the sample bundle, review its mapping, and accept the preview. The intended location is:

```text
mods/update/x64/dlcpacks/EMFsingleplayer/dlc.rpf/
  x64/streamedpeds_players.rpf/player_one/
    hair_002_u.ydd
    hair_diff_002_a_uni.ytd
```

The queue orders **ASI Loader → OpenIV.ASI → EMFSingleplayer → Short Dreads**. Existing dependencies are reused only after the supported checks pass. EMF validation checks for the character folder and its DLC registration. Occupied hair slots require explicit conflict acceptance and receive backups.

The original Short Dreads page returned HTTP 403 in this environment. The example's EMF recommendation comes from your uploaded specification. Its recipe is limited to the exact hashes of your supplied files; it does not infer Franklin compatibility from filenames alone. The two real files were installed into controlled RPF fixtures, verified byte-for-byte, exported as an OIV, re-imported, and rolled back. No game launch was performed.

The original mod's version remains unknown. The generated OIV container uses package version 1.0. These supplied mod assets are for your personal testing and retain their original author's rights.

## Encrypted archives and the optional bridge

Native support is limited to unencrypted RPF7 archives of at most 256 MiB. This includes nested RPF traversal and preserves RSC7 resource headers and opaque payload bytes. It does not decrypt the base game's archives or display 3D models and YTD textures.

To try the optional Windows backend:

1. Obtain or build **CodeWalker.Core.dll** and its dependencies from the matching CodeWalkerProjects revision you supplied. That code is not redistributed here.
2. Install .NET 8 on Windows, or build the bridge as a self-contained executable using the instructions below.
3. Build the bridge with the command below, then in Settings set **Optional archive bridge** to `release/bridge/LegacyArchiveBridge.exe`, **CodeWalker.Core.dll** to your own assembly, and **Game folder for key initialization** to the folder containing your real GTA5.exe. The personally delivered Windows package also provides `extras/bridge/LegacyArchiveBridge.dll`, which requires .NET 8.

The personally delivered source package contains the compiled managed DLL and its runtime configuration in `bridge/prebuilt/`; generated bridge binaries are excluded from this Git repository. The bridge uses CodeWalker's inspected public API. Its writes are confined to staged transaction copies. No Rockstar keys or OpenIV components are bundled. An API or game-key mismatch stops the operation rather than falling back to an original-file edit.

**Compilation is verified; encrypted-archive runtime behavior is not verified.** Do not treat the configured-path indicator as a successful backend test.

## Build and test the source

Use Node.js 22.13 or newer. From this project folder:

```sh
npm ci
npm test
npm run desktop
```

Browser mode, including Mac preparation:

```sh
npm start
```

Windows portable folder:

```sh
npm run dist:win
```

Windows installer, built on a Windows development computer:

```sh
npm run dist:setup
```

Apple Silicon ZIP:

```sh
npm run dist:mac
```

Optional self-contained Windows bridge with .NET SDK 8:

```sh
dotnet publish bridge/LegacyArchiveBridge.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o release/bridge
```

The source's lockfile pins the Node dependencies. `npm run dist:win` creates `release/win-unpacked/`; zip the whole folder to share a portable build. The test report describes the separate native-package inspection and browser UI checks.

## Optional AI

Set an OpenAI-compatible **chat-completions endpoint** and model in Settings. For a hosted endpoint, set `LEGACY_AI_KEY` in the process environment before launch. Local servers can use endpoints such as `http://localhost:1234/v1/chat/completions`.

Press **Ask configured AI** in a mod's Details to request a proposal. Only imported filenames and author/readme text are sent. Game-directory contents are excluded. A proposal cannot run code and cannot select an unsupported operation. AI destinations must have matching author-path evidence; the accepted plan is still checked by the deterministic installer.

AI transport and evidence rejection were tested against a controlled compatible service. No paid AI provider was configured or queried during this build.

## Files and recovery

The desktop stores its database, mod payloads, and backup journals in the application user-data folder. Browser mode uses a separate local data folder. `LEGACY_SUITE_DATA` can select a different data directory; choose it before importing or installing mods.

Backups copy physical outer archives so restoration is exact. Large installations can require several times an archive's size for the live file, stage, and backup. There is no silent backup pruning. Interrupted prepared/committed installations are examined on the next Windows start. Unknown external edits stop recovery and are preserved. **Backups → Check interrupted installations** retries after you resolve the reported mismatch.

Vanilla profiles disable only mods managed by this application. They do not remove older manual installations. Shared dependencies cannot be disabled while enabled mods still require them.

See [docs/TEST-REPORT.md](docs/TEST-REPORT.md), [docs/SOURCE-AUDIT.md](docs/SOURCE-AUDIT.md), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for evidence, provenance, and implementation details.
