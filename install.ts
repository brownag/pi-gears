#!/usr/bin/env node
/**
 * pi-gears installer script
 *
 * Augments target models.json with local providers (r9700, cpu-llama) and deploys
 * pi-gears.ts & gears.json to global (~/.pi/agent/) or project-local (<project>/.pi/) scopes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const GEAR_MODELS = [
  {
    id: "qwen-gear-1",
    name: "Qwen Gear 1 (Planning / Deep Thinking)",
    reasoning: true,
    contextWindow: 131072,
    maxTokens: 16384,
  },
  {
    id: "qwen-gear-2",
    name: "Qwen Gear 2 (Execution / Direct Instruct)",
    reasoning: false,
    contextWindow: 131072,
    maxTokens: 16384,
  },
];

/**
 * Shared compatibility configuration for Qwen-based providers.
 * Defines thinking format, developer role support, and reasoning effort settings
 * used consistently across r9700, cpu-llama, and other Qwen provider implementations.
 */
export const QWEN_COMPAT = {
  thinkingFormat: "qwen-chat-template",
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
} as const;

export const CPU_LLAMA_PROVIDER = {
  baseUrl: "http://127.0.0.1:8002/v1",
  api: "openai-completions",
  apiKey: "none",
  compat: QWEN_COMPAT,
  models: GEAR_MODELS,
};

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

export function mergeModelsConfig(existingRaw: string | null): { updatedConfig: Record<string, unknown>; merged: boolean } {
  let config: Record<string, unknown> = { providers: {} };
  if (existingRaw !== null) {
    try {
      config = JSON.parse(existingRaw);
      if (typeof config !== "object" || config === null || Array.isArray(config)) {
        config = { providers: {} };
      }
    } catch {
      config = { providers: {} };
    }
  }

  if (!config.providers || typeof config.providers !== "object" || Array.isArray(config.providers)) {
    config.providers = {};
  }

  const providers = config.providers as Record<string, any>;

  // 1. If r9700 provider exists, augment its models with qwen-gear-1 and qwen-gear-2
  if (providers["r9700"] && typeof providers["r9700"] === "object") {
    const existingModels = Array.isArray(providers["r9700"].models) ? providers["r9700"].models : [];
    for (const gearModel of GEAR_MODELS) {
      if (!existingModels.some((m: any) => m.id === gearModel.id)) {
        existingModels.push(gearModel);
      }
    }
    providers["r9700"].models = existingModels;
    // ensure compat settings
    providers["r9700"].compat = {
      ...QWEN_COMPAT,
      ...(providers["r9700"].compat || {}),
    };
  } else {
    // initialize r9700
    providers["r9700"] = {
      baseUrl: "http://127.0.0.1:8001/v1",
      api: "openai-completions",
      apiKey: "none",
      compat: QWEN_COMPAT,
      models: [...GEAR_MODELS],
    };
  }

  // 2. Augment / add cpu-llama provider for Port 8002
  providers["cpu-llama"] = CPU_LLAMA_PROVIDER;

  return {
    updatedConfig: config,
    merged: true,
  };
}

export async function runInstaller(options: InstallOptions) {
  const { targetDir, scopeName, symlink, dryRun } = options;
  console.log(`=== pi-gears installer ===`);
  console.log(`Target Scope: ${scopeName}`);
  console.log(`Target Directory: ${targetDir}`);
  console.log(`Mode: ${dryRun ? "[DRY RUN]" : "[LIVE]"}`);
  console.log(`Deployment method: ${symlink ? "symlink" : "copy"}\n`);

  const modelsJsonPath = path.join(targetDir, "models.json");
  const modelsJsonBakPath = path.join(targetDir, "models.json.bak");
  const gearsJsonPath = path.join(targetDir, "gears.json");
  const extensionsDir = path.join(targetDir, "extensions");
  const packageExtensionsDir = path.join(extensionsDir, "pi-gears");
  const targetExtensionPath = path.join(packageExtensionsDir, "index.ts");
  const targetInterceptorsPath = path.join(packageExtensionsDir, "interceptors.ts");

  // Clean up legacy flat extension file if present
  const legacyFlatExtensionPath = path.join(extensionsDir, "pi-gears.ts");
  const legacyFlatInterceptorsPath = path.join(extensionsDir, "interceptors.ts");
  if (fs.existsSync(legacyFlatExtensionPath)) {
    fs.rmSync(legacyFlatExtensionPath, { force: true });
  }
  if (fs.existsSync(legacyFlatInterceptorsPath)) {
    fs.rmSync(legacyFlatInterceptorsPath, { force: true });
  }

  // Locate source pi-gears.ts, interceptors.ts, and gears.json
  let sourceExtensionPath = path.join(__dirname, "pi-gears.ts");
  let sourceInterceptorsPath = path.join(__dirname, "interceptors.ts");
  let sourceGearsJsonPath = path.join(__dirname, "gears.json");
  if (!fs.existsSync(sourceExtensionPath)) {
    sourceExtensionPath = path.join(process.cwd(), "pi-gears.ts");
  }
  if (!fs.existsSync(sourceInterceptorsPath)) {
    sourceInterceptorsPath = path.join(process.cwd(), "interceptors.ts");
  }
  if (!fs.existsSync(sourceGearsJsonPath)) {
    sourceGearsJsonPath = path.join(process.cwd(), "gears.json");
  }

  if (!fs.existsSync(sourceExtensionPath)) {
    throw new Error(`Source extension file not found at ${sourceExtensionPath}`);
  }
  if (!fs.existsSync(sourceInterceptorsPath)) {
    throw new Error(`Source interceptors file not found at ${sourceInterceptorsPath}`);
  }

  // 1. Check existing models.json
  let existingContent: string | null = null;
  const fileExists = fs.existsSync(modelsJsonPath);
  if (fileExists) {
    existingContent = fs.readFileSync(modelsJsonPath, "utf-8");
  }

  const { updatedConfig } = mergeModelsConfig(existingContent);
  const updatedJsonStr = JSON.stringify(updatedConfig, null, 2) + "\n";

  console.log(`[Config] models.json target: ${modelsJsonPath}`);
  if (fileExists) {
    console.log(`[Config] Existing models.json detected. Backup will be created at: ${modelsJsonBakPath}`);
  } else {
    console.log(`[Config] models.json does not exist. A new file will be initialized.`);
  }

  if (dryRun) {
    console.log("\n[Dry Run] Proposed models.json content:\n----------------------------------------");
    console.log(updatedJsonStr);
    console.log("----------------------------------------");
    console.log(`[Dry Run] Would copy / symlink gears.json -> ${gearsJsonPath}`);
    console.log(`[Dry Run] Would ensure directory exists: ${packageExtensionsDir}`);
    console.log(`[Dry Run] Would ${symlink ? "symlink" : "copy"} ${sourceExtensionPath} -> ${targetExtensionPath}`);
    console.log(`[Dry Run] Would ${symlink ? "symlink" : "copy"} ${sourceInterceptorsPath} -> ${targetInterceptorsPath}`);
    console.log("\n[Dry Run] Completed successfully with zero changes made to disk.");
    return;
  }

  // Live execution
  fs.mkdirSync(targetDir, { recursive: true });

  if (fileExists && existingContent !== null) {
    fs.writeFileSync(modelsJsonBakPath, existingContent, "utf-8");
    console.log(`[Success] Created backup: ${modelsJsonBakPath}`);
  }

  fs.writeFileSync(modelsJsonPath, updatedJsonStr, "utf-8");
  console.log(`[Success] Updated models.json with r9700 and cpu-llama gear models.`);

  // Deploy gears.json
  if (fs.existsSync(sourceGearsJsonPath)) {
    fs.copyFileSync(sourceGearsJsonPath, gearsJsonPath);
    console.log(`[Success] Deployed gears configuration to: ${gearsJsonPath}`);
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
