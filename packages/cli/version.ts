// Reads the repo root's package.json directly rather than duplicating the
// number : there's no separate cli/package.json (see cli/README.md), the
// root version is the one number the whole repo shares (bump-version.ts
// bumps it, tags are `v<version>`, see .releaserc.json's tagFormat) and
// scripts/build-packages.ts bundles this in at compile time for the
// standalone binary, no runtime file read needed.
import pkg from "../../package.json";

export const CLI_VERSION: string = pkg.version;
