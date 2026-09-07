/**
 * Test Suite for pi-gears: extension logic, gear registry, and sandboxed installer.
 *
 * Strict constraint: Zero modifications to ~/.pi.
 * All tests operate purely in-memory or within test-sandbox/.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GEARS,
  findGear,
  buildGearDescription,
  loadGearsConfig,
  loadGearsConfigFile,
  GLOBAL_INTERCEPTORS,
} from "../pi-gears.js";

import {
  executeToolInterceptors,
  subagentInterceptor,
  hasExplicitThinkingSuffix,
  matchesTargetAgent,
  DEFAULT_SUBAGENT_INTERCEPTOR_CONFIG,
} from "../interceptors.js";

import {
  GEAR_MODELS,
  CPU_LLAMA_PROVIDER,
  parseArgs,
  mergeModelsConfig,
  runInstaller,
} from "../install.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const sandboxDir = path.resolve(projectRoot, "test-sandbox");

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

async function main() {
  console.log("========================================");
  console.log(" Running pi-gears Test Suite");
  console.log("========================================\n");

  // 1. GearConfig Registry & findGear tests
  console.log("--- 1. GearConfig Registry & findGear ---");

  await runTest("GEARS contains gears from config or defaults", () => {
    assert.ok(GEARS.length >= 2, "Should have at least 2 gears");
    const g1 = findGear(1);
    const g2 = findGear(2);
    assert.ok(g1, "Gear 1 should exist");
    assert.ok(g2, "Gear 2 should exist");
    assert.equal(g1.temperature, 0.6);
    assert.equal(g1.thinking, true);
    assert.equal(g2.temperature, 0.1);
    assert.equal(g2.thinking, false);
  });

  await runTest("findGear by numeric ID", () => {
    const g1 = findGear(1);
    const g2 = findGear(2);
    assert.equal(g1?.id, 1);
    assert.equal(g2?.id, 2);
  });

  await runTest("findGear by string ID", () => {
    const g1 = findGear("1");
    const g2 = findGear("2");
    assert.equal(g1?.id, 1);
    assert.equal(g2?.id, 2);
  });

  await runTest("findGear by exact and case-insensitive name / aliases", () => {
    assert.equal(findGear("r9700-plan")?.id, 1);
    assert.equal(findGear("plan")?.id, 1);
    assert.equal(findGear("PLAN")?.id, 1);
    assert.equal(findGear("exec")?.id, 2);
    assert.equal(findGear("EXEC")?.id, 2);
  });

  await runTest("findGear supports CPU profile gears (Gears 3 & 4)", () => {
    assert.equal(findGear(3)?.id, 3);
    assert.equal(findGear("cpu-plan")?.id, 3);
    assert.equal(findGear(4)?.id, 4);
    assert.equal(findGear("cpu-exec")?.id, 4);
  });

  await runTest("findGear returns undefined for unknown identifier", () => {
    assert.equal(findGear("turbo"), undefined);
    assert.equal(findGear("99"), undefined);
    assert.equal(findGear(""), undefined);
  });

  // 2. buildGearDescription
  console.log("\n--- 2. buildGearDescription ---");

  await runTest("buildGearDescription formats details correctly", () => {
    const g1 = findGear(1)!;
    const desc = buildGearDescription(g1);
    assert.ok(desc.includes(`[Gear 1:${g1.name}]`));
    assert.ok(desc.includes("temp:0.6"));
    assert.ok(desc.includes("thinking:on"));
    assert.ok(desc.includes(g1.provider));
  });

  // 3. Provider Payload Hook Simulation
  console.log("\n--- 3. Provider Payload Hook Simulation ---");

  await runTest("Payload hook modifies temperature and enable_thinking for Gear 1", () => {
    const gear = findGear(1)!;
    const payload: Record<string, unknown> = {
      model: `${gear.provider}/qwen-gear-1`,
      messages: [{ role: "user", content: "hello" }],
    };

    const modelStr = typeof payload.model === "string" ? payload.model : "";
    const matchesProvider = modelStr.startsWith(`${gear.provider}/`) || modelStr.startsWith("qwen-gear-");
    assert.ok(matchesProvider);

    payload.temperature = gear.temperature;
    const existingKwargs =
      payload.chat_template_kwargs && typeof payload.chat_template_kwargs === "object"
        ? (payload.chat_template_kwargs as Record<string, unknown>)
        : {};
    payload.chat_template_kwargs = {
      ...existingKwargs,
      enable_thinking: gear.thinking,
    };

    assert.equal(payload.temperature, 0.6);
    assert.deepEqual(payload.chat_template_kwargs, { enable_thinking: true });
  });

  await runTest("Payload hook modifies temperature and enable_thinking for Gear 2", () => {
    const gear = findGear(2)!;
    const payload: Record<string, unknown> = {
      model: `${gear.provider}/qwen-gear-2`,
      messages: [{ role: "user", content: "hello" }],
    };

    const modelStr = typeof payload.model === "string" ? payload.model : "";
    const matchesProvider = modelStr.startsWith(`${gear.provider}/`) || modelStr.startsWith("qwen-gear-");
    assert.ok(matchesProvider);

    payload.temperature = gear.temperature;
    const existingKwargs =
      payload.chat_template_kwargs && typeof payload.chat_template_kwargs === "object"
        ? (payload.chat_template_kwargs as Record<string, unknown>)
        : {};
    payload.chat_template_kwargs = {
      ...existingKwargs,
      enable_thinking: gear.thinking,
    };

    assert.equal(payload.temperature, 0.1);
    assert.deepEqual(payload.chat_template_kwargs, { enable_thinking: false });
  });

  // 4. Installer Unit Functions
  console.log("\n--- 4. Installer Helper Functions ---");

  await runTest("parseArgs correctly recognizes custom-target, symlink, and dry-run", () => {
    const opts = parseArgs(["--custom-target", "./test-sandbox", "--symlink", "--dry-run"]);
    assert.equal(opts.targetDir, path.resolve("./test-sandbox"));
    assert.equal(opts.symlink, true);
    assert.equal(opts.dryRun, true);
  });

  await runTest("mergeModelsConfig handles null or empty existing config", () => {
    const { updatedConfig } = mergeModelsConfig(null);
    assert.ok(updatedConfig.providers);
    const providers = updatedConfig.providers as Record<string, unknown>;
    assert.ok(providers["r9700"]);
    assert.ok(providers["cpu-llama"]);
  });

  await runTest("mergeModelsConfig preserves existing multi-provider configurations", () => {
    const mockExisting = JSON.stringify({
      providers: {
        r9700: {
          baseUrl: "http://127.0.0.1:8001/v1",
          api: "openai-completions",
          models: [{ id: "existing-model", name: "Existing Model" }],
        },
        "apu-embeddings": {
          baseUrl: "http://127.0.0.1:8080/v1",
          api: "openai-embeddings",
        },
      },
    });

    const { updatedConfig } = mergeModelsConfig(mockExisting);
    const providers = updatedConfig.providers as Record<string, any>;
    assert.ok(providers["r9700"], "r9700 provider must be preserved");
    assert.ok(providers["apu-embeddings"], "apu-embeddings provider must be preserved");
    assert.ok(providers["cpu-llama"], "cpu-llama provider must be added");

    // r9700 should have existing-model + qwen-gear-1 + qwen-gear-2
    assert.ok(providers["r9700"].models.some((m: any) => m.id === "existing-model"));
    assert.ok(providers["r9700"].models.some((m: any) => m.id === "qwen-gear-1"));
    assert.ok(providers["r9700"].models.some((m: any) => m.id === "qwen-gear-2"));
  });

  // 5. Sandboxed Installer Integration Tests
  console.log("\n--- 5. Sandboxed Installer Integration Tests ---");

  const mockExistingConfig = {
    providers: {
      r9700: {
        baseUrl: "http://127.0.0.1:8001/v1",
        api: "openai-completions",
        models: [{ id: "deepseek-coder", name: "DeepSeek Coder" }],
      },
      "apu-embeddings": {
        baseUrl: "http://127.0.0.1:8080/v1",
        api: "openai-embeddings",
        models: [{ id: "nomic-embed-text", name: "Nomic Embed" }],
      },
    },
  };

  function setupSandbox() {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
    fs.mkdirSync(sandboxDir, { recursive: true });
    const modelsPath = path.join(sandboxDir, "models.json");
    fs.writeFileSync(modelsPath, JSON.stringify(mockExistingConfig, null, 2) + "\n", "utf-8");
  }

  await runTest("Installer execution with copy mode (--custom-target)", async () => {
    setupSandbox();

    await runInstaller({
      targetDir: sandboxDir,
      scopeName: "test-sandbox",
      symlink: false,
      dryRun: false,
    });

    const modelsJsonPath = path.join(sandboxDir, "models.json");
    const modelsJsonBakPath = path.join(sandboxDir, "models.json.bak");
    const deployedExtensionPath = path.join(sandboxDir, "extensions", "pi-gears", "index.ts");
    const deployedInterceptorsPath = path.join(sandboxDir, "extensions", "pi-gears", "interceptors.ts");
    const deployedGearsJsonPath = path.join(sandboxDir, "gears.json");

    assert.ok(fs.existsSync(modelsJsonPath), "models.json should exist");
    assert.ok(fs.existsSync(modelsJsonBakPath), "models.json.bak should exist");
    assert.ok(fs.existsSync(deployedExtensionPath), "extensions/pi-gears/index.ts should exist");
    assert.ok(fs.existsSync(deployedInterceptorsPath), "extensions/pi-gears/interceptors.ts should exist");
    assert.ok(fs.existsSync(deployedGearsJsonPath), "gears.json should exist");

    const stat = fs.lstatSync(deployedExtensionPath);
    const statInterceptors = fs.lstatSync(deployedInterceptorsPath);
    assert.ok(!stat.isSymbolicLink(), "pi-gears/index.ts should be regular copied file");
    assert.ok(!statInterceptors.isSymbolicLink(), "pi-gears/interceptors.ts should be regular copied file");

    const updated = JSON.parse(fs.readFileSync(modelsJsonPath, "utf-8"));
    assert.ok(updated.providers.r9700);
    assert.ok(updated.providers["cpu-llama"]);
    assert.ok(updated.providers["apu-embeddings"]);
  });

  await runTest("Installer execution with symlink mode (--custom-target --symlink)", async () => {
    setupSandbox();

    await runInstaller({
      targetDir: sandboxDir,
      scopeName: "test-sandbox",
      symlink: true,
      dryRun: false,
    });

    const deployedExtensionPath = path.join(sandboxDir, "extensions", "pi-gears", "index.ts");
    const deployedInterceptorsPath = path.join(sandboxDir, "extensions", "pi-gears", "interceptors.ts");
    assert.ok(fs.existsSync(deployedExtensionPath), "extensions/pi-gears/index.ts should exist");
    assert.ok(fs.existsSync(deployedInterceptorsPath), "extensions/pi-gears/interceptors.ts should exist");

    const stat = fs.lstatSync(deployedExtensionPath);
    const statInterceptors = fs.lstatSync(deployedInterceptorsPath);
    assert.ok(stat.isSymbolicLink(), "pi-gears/index.ts should be symbolic link");
    assert.ok(statInterceptors.isSymbolicLink(), "pi-gears/interceptors.ts should be symbolic link");
  });

  await runTest("Installer dry-run mode does not modify files", async () => {
    setupSandbox();
    const modelsJsonPath = path.join(sandboxDir, "models.json");
    const originalContent = fs.readFileSync(modelsJsonPath, "utf-8");

    await runInstaller({
      targetDir: sandboxDir,
      scopeName: "test-sandbox",
      symlink: false,
      dryRun: true,
    });

    const afterContent = fs.readFileSync(modelsJsonPath, "utf-8");
    assert.equal(originalContent, afterContent);
    assert.ok(!fs.existsSync(path.join(sandboxDir, "extensions")), "extensions dir should not be created");
  });

  // 6. Tool Interceptor Registry & Subagent Propagation Tests
  console.log("\n--- 6. Tool Interceptor Registry & Subagent Propagation ---");

  await runTest("hasExplicitThinkingSuffix detects explicit suffixes and ignores clean model IDs", () => {
    assert.ok(hasExplicitThinkingSuffix("r9700/qwen-gear-1:high"));
    assert.ok(hasExplicitThinkingSuffix("cpu-llama/qwen-gear-2:off"));
    assert.ok(hasExplicitThinkingSuffix("some-model:none"));
    assert.ok(hasExplicitThinkingSuffix("custom:low"));
    assert.ok(hasExplicitThinkingSuffix("custom:medium"));
    assert.ok(!hasExplicitThinkingSuffix("r9700/qwen-gear-1"));
    assert.ok(!hasExplicitThinkingSuffix("cpu-llama/qwen-gear-2"));
    assert.ok(!hasExplicitThinkingSuffix("model-with-colon:unknown"));
  });

  await runTest("matchesTargetAgent handles exact match, case insensitivity, and wildcard", () => {
    assert.ok(matchesTargetAgent("worker", ["worker", "reviewer"]));
    assert.ok(matchesTargetAgent("WORKER", ["worker", "reviewer"]));
    assert.ok(matchesTargetAgent("reviewer", ["worker", "reviewer"]));
    assert.ok(!matchesTargetAgent("explorer", ["worker", "reviewer"]));
    assert.ok(!matchesTargetAgent(undefined, ["worker", "reviewer"]));
    assert.ok(matchesTargetAgent("any-agent", ["*"]));
    assert.ok(matchesTargetAgent("custom-worker", ["coder", "*"]));
  });

  await runTest("executeToolInterceptors invokes handler for matching toolName and ignores non-matching", async () => {
    let subagentCalled = false;
    let otherCalled = false;

    const mockInterceptors = [
      {
        toolName: "subagent",
        handler: () => {
          subagentCalled = true;
        },
      },
      {
        toolName: "other_tool",
        handler: () => {
          otherCalled = true;
        },
      },
    ];

    await executeToolInterceptors("subagent", { agent: "worker" }, {}, mockInterceptors);
    assert.ok(subagentCalled, "subagent interceptor should have executed");
    assert.ok(!otherCalled, "other_tool interceptor should NOT have executed");
  });

  await runTest("executeToolInterceptors respects interceptor enabled() guard (skips when disabled)", async () => {
    const gear = findGear(1)!;
    const input: Record<string, unknown> = {
      agent: "worker",
      task: "test task",
    };

    // Disabled in config: ctx.config.subagent.enabled = false
    await executeToolInterceptors(
      "subagent",
      input,
      {
        activeGear: gear,
        gearTargetModel: gear.modelId,
        config: {
          subagent: {
            enabled: false,
          },
        },
      },
      [subagentInterceptor]
    );

    assert.equal(input.model, undefined, "Input model should NOT be patched when interceptor is disabled");
  });

  await runTest("Strict preservation: does not overwrite caller-explicit thinking suffix", async () => {
    const gear = findGear(1)!; // Gear 1 has thinking: true (:high)

    // Test cases with various explicit suffixes
    const suffixes = [":high", ":off", ":none", ":low", ":medium"];
    for (const suffix of suffixes) {
      const input: Record<string, unknown> = {
        agent: "worker",
        task: "some task",
        model: `custom-provider/custom-model${suffix}`,
      };

      await executeToolInterceptors(
        "subagent",
        input,
        {
          activeGear: gear,
          gearTargetModel: gear.modelId,
        },
        [subagentInterceptor]
      );

      assert.equal(
        input.model,
        `custom-provider/custom-model${suffix}`,
        `Explicit thinking suffix ${suffix} must be preserved without alteration`
      );
    }
  });

  await runTest("Target agent filtering: patches worker/reviewer but leaves explorer unmodified", async () => {
    const gear = findGear(1)!; // Gear 1 is r9700/qwen-gear-1, thinking: true

    const workerInput = { agent: "worker", task: "code something" };
    const reviewerInput = { agent: "reviewer", task: "review something" };
    const explorerInput = { agent: "explorer", task: "explore something" };

    const ctx = {
      activeGear: gear,
      gearTargetModel: gear.modelId,
      config: {
        subagent: {
          targetAgents: ["worker", "reviewer"],
        },
      },
    };

    await executeToolInterceptors("subagent", workerInput, ctx, [subagentInterceptor]);
    await executeToolInterceptors("subagent", reviewerInput, ctx, [subagentInterceptor]);
    await executeToolInterceptors("subagent", explorerInput, ctx, [subagentInterceptor]);

    assert.equal(workerInput.model, "r9700/qwen-gear-1:high", "worker should be patched with gear model + :high");
    assert.equal(reviewerInput.model, "r9700/qwen-gear-1:high", "reviewer should be patched with gear model + :high");
    assert.equal(explorerInput.model, undefined, "explorer should remain unpatched");
  });

  await runTest("Target agent filtering: wildcard * matches any agent name", async () => {
    const gear = findGear(2)!; // Gear 2 is r9700/qwen-gear-2, thinking: false

    const customInput = { agent: "any-custom-agent", task: "do something" };
    const ctx = {
      activeGear: gear,
      gearTargetModel: gear.modelId,
      config: {
        subagent: {
          targetAgents: ["*"],
        },
      },
    };

    await executeToolInterceptors("subagent", customInput, ctx, [subagentInterceptor]);
    assert.equal(customInput.model, "r9700/qwen-gear-2:off", "Wildcard should patch any-custom-agent");
  });

  await runTest("Per-gear override test: gear-specific interceptors config overrides global defaults", async () => {
    const customGear = {
      ...findGear(1)!,
      interceptors: {
        subagent: {
          targetAgents: ["coder"], // Only coder, not worker or reviewer
        },
      },
    };

    const workerInput = { agent: "worker", task: "task" };
    const coderInput = { agent: "coder", task: "task" };

    const ctx = {
      activeGear: customGear,
      gearTargetModel: customGear.modelId,
      config: customGear.interceptors,
    };

    await executeToolInterceptors("subagent", workerInput, ctx, [subagentInterceptor]);
    await executeToolInterceptors("subagent", coderInput, ctx, [subagentInterceptor]);

    assert.equal(workerInput.model, undefined, "worker should NOT be patched because per-gear config overrides targetAgents");
    assert.equal(coderInput.model, "r9700/qwen-gear-1:high", "coder should be patched per gear override");
  });

  await runTest("Subagent interceptor patches parallel and chain dispatch arrays", async () => {
    const gear = findGear(2)!; // Gear 2: r9700/qwen-gear-2, thinking: false (:off)

    const parallelInput = {
      parallel: [
        { agent: "worker", task: "task 1" },
        { agent: "explorer", task: "task 2" },
        { agent: "reviewer", task: "task 3" },
      ],
    };

    const chainInput = {
      chain: [
        { agent: "worker", task: "step 1" },
        { agent: "coder", task: "step 2" },
      ],
    };

    const ctx = {
      activeGear: gear,
      gearTargetModel: gear.modelId,
    };

    await executeToolInterceptors("subagent", parallelInput, ctx, [subagentInterceptor]);
    await executeToolInterceptors("subagent", chainInput, ctx, [subagentInterceptor]);

    assert.equal(parallelInput.parallel[0].model, "r9700/qwen-gear-2:off");
    assert.equal(parallelInput.parallel[1].model, undefined, "explorer is not in default targetAgents");
    assert.equal(parallelInput.parallel[2].model, "r9700/qwen-gear-2:off");

    assert.equal(chainInput.chain[0].model, "r9700/qwen-gear-2:off");
    assert.equal(chainInput.chain[1].model, "r9700/qwen-gear-2:off");
  });

  // Summary
  console.log("\n========================================");
  console.log(` Summary: ${passed} passed, ${failed} failed`);
  console.log("========================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
