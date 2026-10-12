# Validation report — 0.1.0

The engine was tested on Linux x64 using Node.js 24.19.0. **67 automated tests passed, with 0 failures and 0 skips.** The full output is in `test-output.txt`.

This report records validation of the personally delivered release, including the supplied local mod fixture. That third-party asset is excluded from this Git repository. A checkout without it skips the real-asset tests; set `LEGACY_TEST_RAR` to a legally obtained copy to rerun all 67 checks.

## Real supplied asset workflow

The original Short Dreads RAR was extracted through the production portable RAR implementation. It contains exactly these assets:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| hair_002_u.ydd | 1,731,469 | cfe935fe6cb0757a48ec24abbf2cca0e0812f9bf4a5e8410a67489ad03284b7e |
| hair_diff_002_a_uni.ytd | 79,547 | dac8fd30a0b04cf25cfd88c3a746fb2cf159796826b968aed8dca7f785c95c9c |

The production importer and installation engine selected the exact user-supplied EMF recipe, checked the character destination and DLC registration in a controlled fixture, installed both original assets into nested RPFs, read them back byte-for-byte, verified the recorded outer-file hash, disabled the mod, and restored the exact original outer archive.

The dependency graph without providers resolved ASI Loader → OpenIV.ASI → EMF → hair. An absent or invalid character destination stopped installation. A filename-only mod without author/recipe evidence did not infer Franklin. Explicit author instructions forbidding EMF preserved the supported mods-folder replacement method.

The real EMF archive, GTA executable, and game installation were not supplied. The fixtures have the expected directory/XML shape and use stub dependency files; they are not evidence that GTA loaded the mod, that the player's rig matches, or that Script Hook V matches a particular game build. The Short Dreads author page returned HTTP 403, so its recommendation was grounded in the uploaded specification rather than a live page capture.

## OIV and non-OIV workflows

The real hair payloads were exported as a complete OIV 2.2 container with metadata, colors, GUID, content files, and nested archive commands. The package was parsed again, re-imported through the normal application API, installed into the controlled EMF fixture, and rolled back exactly. EMF remained a required dependency even when the generated OIV was imported without pasted instructions.

A separate OIV fixture exercised root archive creation before file addition, including a newly created internal directory. Unsupported PSO commands refused the entire package. No third-party pre-existing OIV mod was supplied, so this report does not claim testing of arbitrary community OIV packages.

Non-OIV fixtures exercised explicit scripts layouts, ASI requirements, explicit archive destinations, DLC copying and registration, existing-file conflicts, and byte-exact restoration. Other checks covered shared provider protection, failure isolation between unrelated queue roots, profile application/vanilla restoration, case aliases, import tampering, and stale previews.

## Failure and safety checks

- Traversal, drive/ADS paths, reserved Windows names, symlink paths, and ambiguous case duplicates refused.
- ZIP CRC damage and duplicate paths refused; real RAR extraction verified; 7z data extracted into memory before guarded file writes.
- Required dependency cycles and numeric version conflicts refused; unknown versions failed numeric constraints; zero-major caret ranges checked.
- File changes after preview refused before commit.
- Injected failure after the first committed file restored earlier bytes and removed owned new files.
- A prepared journal simulated an interrupted process and recovered its exact original bytes.
- Unknown external edits and damaged/missing restoration assumptions prevented destructive recovery.
- Local API tokens, same-origin requests, host validation, and static-file allowlist checked.
- AI proposals checked against a controlled compatible service; invented destinations refused; payload excluded game-directory contents.
- Native OPEN/NONE archives, nested files, resource-header preservation, folder creation, actual text preview, XML validation, and original/modded byte comparison checked.

## Interface

The production interface was exercised with Playwright and a real headless Chromium browser. All 12 pages rendered. The real RAR import, EMF preview, nested archive listing, and actual text preview passed with **0 page errors and 0 failed requests**. The result is in `ui-test-output.json`.

Home, the install preview, and Archive Explorer were rendered to screenshots and visually inspected. These screenshots were internal QA files, not included in the release. They used controlled game fixtures and the real supplied mod payloads.

## Builds and unverified areas

- Windows x64 Electron portable folder built successfully. PE architecture and packaged content inspected. No Windows runtime execution or game launch was performed.
- macOS arm64 Electron ZIP built successfully on Linux. Mach-O architecture and packaged content inspected. Signing/notarization and native M4 execution were not performed.
- A subsequent user screenshot shows macOS rejecting that packaged app with a “damaged and can't be opened” alert. Native Mac packaging is therefore not validated for release. Source-based local launch is the available workaround; the exact package rejection cause remains unverified.
- The independent C# bridge compiled using the .NET SDK 8.0.412 Roslyn compiler and .NET 8 reference assemblies. The prebuilt DLL and runtime configuration are included in the personal release package and excluded from this Git repository. The environment's CLI/MSBuild startup failed on process metadata access, so full project publishing was not verified here.
- No compatible CodeWalker.Core runtime plus real GTA executable was available for encrypted-archive validation. The bridge is experimental.
- Public page/download resolver behavior was tested with controlled HTML/URLs. Live mod download restrictions and every dependency release were not exhaustively tested.
- No paid AI provider, real in-game model/texture render, generalized clothing conversion, or GTA Online workflow was tested.

All successful installation claims in this report refer to file operations and integrity checks against the stated fixtures. The release still needs a Windows test with the actual EMF package, encrypted mods copies, and a real game launch.
