# Input and reuse audit

| Supplied project | Finding in supplied archive | Decision |
| --- | --- | --- |
| [GTArage](https://github.com/DelusionalWizard/gtarage) | Electron/TypeScript, MIT LICENSE. Its engine cannot itself edit RPF archives. Contains a ZIP reader, filesystem helpers, game registry, and PE/readme dependency scanning | Reused four MIT modules, stripped types to JS, retained the complete license. New transaction and RPF engines use the same Node/Electron architecture |
| [CodeWalkerProjects](https://github.com/crxhvrd/CodeWalkerProjects) | OIV installer/CLI and CodeWalker core source. Notice.txt has the upstream author's copyright and notices for several third-party sections, including a GPL FBX component. No clear project-wide grant found in the supplied archive | Inspected public APIs and format behavior. No CodeWalker code, DLL, executable, key material, or resource is redistributed. Independent adapter loads a user-provided assembly |
| [CodeWalker upstream](https://github.com/dexyfex/CodeWalker) | The upstream [license request](https://github.com/dexyfex/CodeWalker/issues/243) remains unresolved in retrieved evidence | Does not establish a reusable whole-project license. External integration only |
| [Bilago GTAVModManager](https://github.com/bilago/GTAVModManager) | Supplied ZIP has EXEs, update XML, changelogs, FAQ, and another binary release ZIP; no actual application source or license grant | No code or binary reuse |
| [OpenIV Package Format](https://github.com/OpenIV-Team/OpenIV-PackageFormat) | Official documented format, versions 1.1/2.1/2.2 and examples | Independently implemented the supported 2.2 operations. Linked specification; did not copy or redistribute documentation as application source |
| OpenIV installer `ovisetup.exe` | Proprietary installer, not source | Not executed, decompiled, bundled, or copied into the release |
| Supplied Short Dreads RAR | Exactly `hair_002_u.ydd` (1,731,469 B) and `hair_diff_002_a_uni.ytd` (79,547 B); no readme | Used real bytes for tests and personal preparation examples. No change to the uploaded original |

The foundation is a new Node/Electron application using verified MIT GTArage utilities, rather than an attempt to merge unrelated native applications. Only one engine writes the game folder. Archive edits, OIV installs, AI plans, and profiles all go through its validation and journal.

The independently written native RPF module covers unencrypted structures and opaque resource payload preservation. It includes no encryption keys or decryption implementation. The optional bridge uses your separately obtained CodeWalker installation. License availability remains distinct from technical API compatibility.

## Third-party distribution notices

- GTArage: MIT, copyright notice preserved in `vendor/gtarage/LICENSE`.
- Space Grotesk and JetBrains Mono: SIL OFL notices preserved in `ui/fonts/`.
- Electron: its runtime's LICENSE and Chromium third-party notices accompany packaged builds.
- `7zip-bin` wrapper: MIT notice preserved; bundled 7-Zip/p7zip code has its own LGPL/BSD terms. Corresponding upstream source is available through [7-Zip](https://www.7-zip.org/download.html) and [p7zip](https://sourceforge.net/projects/p7zip/). No changes were made to those binaries.
- `node-unrar-js` wrapper: MIT, notice preserved. Its compiled UnRAR extractor additionally has the original author's UnRAR license. The full notice is in `third-party-licenses/UnRAR-License.txt`; upstream source for the packaged implementation is [UnRAR 6.1.7](https://www.rarlab.com/rar/unrarsrc-6.1.7.tar.gz).
- Third-party MIT, UnRAR, 7-Zip, and LGPL texts are included in `third-party-licenses/`.

The personally delivered source package includes the supplied hair mod only for personal testing. The application's MIT license does not grant new rights over that mod or any separately installed dependencies. The supplied RAR, generated mod bundles/OIV, and compiled release packages are excluded from this Git repository. Real-asset tests accept an optional local fixture through `LEGACY_TEST_RAR`.
