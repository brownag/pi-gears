#!/usr/bin/env node
/**
 * pi-gears installer script
 *
 * Deploys pi-gears.ts and interceptors.ts and seeds gears.json from gears.json.example
 * when it is missing, to global (~/.pi/agent/) or project-local (<project>/.pi/) scopes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface InstallOptions {
  targetDir: string;
  scopeName: string;
  symlink: boolean;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): InstallOptions {
  let isGlobal = true;
  let projectDir: string | undefined;
  let customTargetDir: string | undefined;
  let symlink = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--global" || arg === "-g") {
      isGlobal = true;
    } else if (arg === "--project" || arg === "-p") {
      isGlobal = false;
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        projectDir = next;
        i++;
      } else {
        projectDir = process.cwd();
      }
    } else if (arg === "--custom-target") {
      isGlobal = false;
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        customTargetDir = next;
        i++;
      } else {
        throw new Error("Missing directory argument after --custom-target");
      }
    } else if (arg === "--symlink" || arg === "-s") {
      symlink = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (customTargetDir) {
    return {
      targetDir: path.resolve(customTargetDir),
      scopeName: `custom (${customTargetDir})`,
      symlink,
      dryRun,
    };
  }

  if (projectDir) {
    return {
      targetDir: path.resolve(projectDir, ".pi"),
      scopeName: `project (${path.resolve(projectDir, ".pi")})`,
      symlink,
      dryRun,
    };
  }

  const homedir = os.homedir();
  return {
    targetDir: path.join(homedir, ".pi", "agent"),
    scopeName: `global (${path.join(homedir, ".pi", "agent")})`,
    symlink,
    dryRun,
  };
}

export function printHelp() {
  console.log(`pi-gears installer

Usage:
  npx tsx install.ts [options]

Options:
  -g, --global              Install globally to ~/.pi/agent/ (default)
  -p, --project [dir]       Install locally to <dir>/.pi/ (defaults to current working directory)
      --custom-target <dir> Install directly to target directory (sandbox / testing)
  -s, --symlink             Symlink extensions (pi-gears.ts, interceptors.ts) instead of copying
      --dry-run             Preview changes without modifying disk
  -h, --help                Show this help message
`);
}

export async function runInstaller(options: InstallOptions) {
  const { targetDir, scopeName, symlink, dryRun } = options;
  console.log(`=== pi-gears installer ===`);
  console.log(`Target Scope: ${scopeName}`);
  console.log(`Target Directory: ${targetDir}`);
  console.log(`Mode: ${dryRun ? "[DRY RUN]" : "[LIVE]"}`);
  console.log(`Deployment method: ${symlink ? "symlink" : "copy"}\n`);

  const gearsJsonPath = path.join(targetDir, "gears.json");
  const extensionsDir = path.join(targetDir, "extensions");
  const packageExtensionsDir = path.join(extensionsDir, "pi-gears");
  const targetExtensionPath = path.join(packageExtensionsDir, "index.ts");
  const targetInterceptorsPath = path.join(packageExtensionsDir, "interceptors.ts");

  const legacyFlatExtensionPath = path.join(extensionsDir, "pi-gears.ts");
  const legacyFlatInterceptorsPath = path.join(extensionsDir, "interceptors.ts");

  // Locate source pi-gears.ts, interceptors.ts, and gears.json.example
  let sourceExtensionPath = path.join(__dirname, "pi-gears.ts");
  let sourceInterceptorsPath = path.join(__dirname, "interceptors.ts");
  let sourceGearsJsonPath = path.join(__dirname, "gears.json.example");
  if (!fs.existsSync(sourceExtensionPath)) {
    sourceExtensionPath = path.join(process.cwd(), "pi-gears.ts");
  }
  if (!fs.existsSync(sourceInterceptorsPath)) {
    sourceInterceptorsPath = path.join(process.cwd(), "interceptors.ts");
  }
  if (!fs.existsSync(sourceGearsJsonPath)) {
    sourceGearsJsonPath = path.join(process.cwd(), "gears.json.example");
  }

  if (!fs.existsSync(sourceExtensionPath)) {
    throw new Error(`Source extension file not found at ${sourceExtensionPath}`);
  }
  if (!fs.existsSync(sourceInterceptorsPath)) {
    throw new Error(`Source interceptors file not found at ${sourceInterceptorsPath}`);
  }

  if (dryRun) {
    for (const legacyPath of [legacyFlatExtensionPath, legacyFlatInterceptorsPath]) {
      if (fs.existsSync(legacyPath)) {
        console.log(`[Dry Run] Would remove legacy file ${legacyPath}`);
      }
    }
    if (fs.existsSync(gearsJsonPath)) {
      console.log(`[Dry Run] Would keep existing gears.json at ${gearsJsonPath}`);
    } else {
      console.log(`[Dry Run] Would seed ${gearsJsonPath} from ${sourceGearsJsonPath}`);
    }
    console.log(`[Dry Run] Would ensure directory exists: ${packageExtensionsDir}`);
    console.log(`[Dry Run] Would ${symlink ? "symlink" : "copy"} ${sourceExtensionPath} -> ${targetExtensionPath}`);
    console.log(`[Dry Run] Would ${symlink ? "symlink" : "copy"} ${sourceInterceptorsPath} -> ${targetInterceptorsPath}`);
    console.log("\n[Dry Run] Completed successfully with zero changes made to disk.");
    return;
  }

  // Live execution
  // Clean up legacy flat extension file if present
  if (fs.existsSync(legacyFlatExtensionPath)) {
    fs.rmSync(legacyFlatExtensionPath, { force: true });
  }
  if (fs.existsSync(legacyFlatInterceptorsPath)) {
    fs.rmSync(legacyFlatInterceptorsPath, { force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  // Seed gears.json from the example, never overwriting a user's existing config
  if (fs.existsSync(gearsJsonPath)) {
    console.log(`[Skip] Keeping existing gears configuration: ${gearsJsonPath}`);
  } else if (fs.existsSync(sourceGearsJsonPath)) {
    fs.copyFileSync(sourceGearsJsonPath, gearsJsonPath);
    console.log(`[Success] Seeded gears configuration from example: ${gearsJsonPath} (edit providers/models to match models.json)`);
  }

  fs.mkdirSync(packageExtensionsDir, { recursive: true });
  console.log(`[Success] Ensured extensions directory exists: ${packageExtensionsDir}`);

  // Helper to deploy an extension file (symlink or copy)
  const deployExtensionFile = (sourcePath: string, targetPath: string, fileName: string) => {
    if (fs.existsSync(targetPath)) {
      try {
        const stat = fs.lstatSync(targetPath);
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(targetPath);
        }
      } catch {
        // Continue if not link
      }
    }

    if (symlink) {
      try {
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
        fs.symlinkSync(path.resolve(sourcePath), targetPath);
        console.log(`[Success] Created symlink: ${targetPath} -> ${path.resolve(sourcePath)}`);
      } catch (err) {
        console.warn(`[Warning] Symlink creation failed (${err}), falling back to copy.`);
        fs.copyFileSync(sourcePath, targetPath);
        console.log(`[Success] Copied ${fileName} to: ${targetPath}`);
      }
    } else {
      fs.copyFileSync(sourcePath, targetPath);
      console.log(`[Success] Copied ${fileName} to: ${targetPath}`);
    }
  };

  // Deploy pi-gears.ts and interceptors.ts
  deployExtensionFile(sourceExtensionPath, targetExtensionPath, "extension");
  deployExtensionFile(sourceInterceptorsPath, targetInterceptorsPath, "interceptors");

  console.log(`\n=== Installation completed successfully ===`);
}

// Execute if run directly
if (process.argv[1] && (process.argv[1].endsWith("install.ts") || process.argv[1].endsWith("install.js"))) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    runInstaller(opts).catch((err) => {
      console.error(`[Error] Installation failed:`, err);
      process.exit(1);
    });
  } catch (err) {
    console.error(`[Error] ${(err as Error).message}`);
    process.exit(1);
  }
}
