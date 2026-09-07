/**
 * pi-gears: Cognitive Execution Transmission for Pi Coding Agent
 *
 * Exposes a structured, configurable Gear registry enabling cognitive execution gear shifting
 * across local llama-server profiles (e.g. GPU R9700, CPU Flash, remote/cluster nodes).
 *
 * Configuration:
 * - ~/.pi/agent/gears.json (global)
 * - <cwd>/.pi/gears.json (project-local overrides/augments)
 *
 * Usage:
 * - `/gear`: Open modal interactive gear selector.
 * - `/gear <id|name|alias>`: Direct gear switch (e.g. `/gear 1`, `/gear exec`, `/gear cpu-plan`).
 * - `alt+shift+g`: Sequential gear cycling shortcut.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Container, Key, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import {
	executeToolInterceptors,
	createDefaultInterceptors,
	type InterceptorsConfig,
	type ToolInterceptor,
	type ToolInterceptorContext,
} from "./interceptors.js";

export interface GearConfig {
	id: number;
	name: string;
	modelId: string;
	provider: string;
	model: string;
	alias: string[];
	description: string;
	temperature: number;
	thinking: boolean;
	instructions?: string;
	interceptors?: InterceptorsConfig;
}

export interface GearsConfigFile {
	gears?: GearConfig[];
	interceptors?: InterceptorsConfig;
}

export function loadGearsConfigFile(cwd?: string): { gears: GearConfig[]; interceptors?: InterceptorsConfig } {
	let customGears: GearConfig[] = [];
	let interceptors: InterceptorsConfig | undefined;
	const candidates = [
		join(getAgentDir(), "gears.json"),
		cwd ? join(cwd, ".pi", "gears.json") : null,
		join(process.cwd(), "gears.json"),
	].filter(Boolean) as string[];

	for (const filepath of candidates) {
		if (existsSync(filepath)) {
			try {
				const content = readFileSync(filepath, "utf-8");
				const parsed = JSON.parse(content) as GearsConfigFile;
				if (parsed && typeof parsed === "object") {
					if (Array.isArray(parsed.gears)) {
						customGears = parsed.gears;
					}
					if (parsed.interceptors && typeof parsed.interceptors === "object") {
						interceptors = parsed.interceptors;
					}
					if (Array.isArray(parsed.gears) || parsed.interceptors) {
						break;
					}
				}
			} catch (err) {
				console.error(`Failed to parse gears config from ${filepath}:`, err);
			}
		}
	}

	if (customGears.length === 0) {
		throw new Error(
			"gears.json not found. Copy gears.example.json to ~/.pi/agent/ or project root and customize providers/models."
		);
	}

	return {
		gears: customGears,
		interceptors,
	};
}

export function loadGearsConfig(cwd?: string): GearConfig[] {
	return loadGearsConfigFile(cwd).gears;
}

const initialConfig = loadGearsConfigFile();
export let GEARS: GearConfig[] = initialConfig.gears;
export let GLOBAL_INTERCEPTORS: InterceptorsConfig | undefined = initialConfig.interceptors;

export function findGear(identifier: string | number, gears: GearConfig[] = GEARS): GearConfig | undefined {
	const str = String(identifier).trim().toLowerCase();
	return gears.find((g) => {
		if (String(g.id) === str) return true;
		if (g.name.toLowerCase() === str) return true;
		return g.alias.some((a) => a.toLowerCase() === str);
	});
}

export function buildGearDescription(gear: GearConfig): string {
	const parts: string[] = [
		`[Gear ${gear.id}:${gear.name}]`,
		`${gear.provider}/${gear.model}`,
		`temp:${gear.temperature}`,
		`thinking:${gear.thinking ? "on" : "off"}`,
	];
	if (gear.description) {
		parts.push(gear.description);
	}
	return parts.join(" | ");
}

export default function piGearsExtension(pi: ExtensionAPI) {
	let activeGear: GearConfig | undefined;

	// Text presentation symbols (non-colored unicode)
	const GEAR_ICON = "\u2699\uFE0E";      // U+2699 + VS-15 (gear)
	const BRAIN_ICON = "\u{1F9E0}\uFE0E";   // U+1F9E0 + VS-15 (brain, text style)
	const LIGHTNING_ICON = "\u{1F5F2}\uFE0E"; // U+1F5F2 (lightning mood)

	function updateStatus(ctx: ExtensionContext) {
		if (activeGear) {
			const modeSymbol = activeGear.thinking ? BRAIN_ICON : LIGHTNING_ICON;
			const modeLabel = activeGear.thinking ? "think" : "exec";
			const label = `[${GEAR_ICON} gear:${activeGear.id}:${activeGear.name} (${modeSymbol} ${modeLabel})]`;
			ctx.ui.setStatus("pi-gears", ctx.ui.theme.fg("accent", label));
		} else {
			ctx.ui.setStatus("pi-gears", undefined);
		}
	}

	async function applyGear(gear: GearConfig, ctx: ExtensionContext): Promise<boolean> {
		activeGear = gear;

		// 1. Switch model if found in registry
		const model = ctx.modelRegistry.find(gear.provider, gear.model);
		if (model) {
			const success = await pi.setModel(model);
			if (!success) {
				ctx.ui.notify(`Gear ${gear.id} (${gear.name}): Unable to activate model ${gear.modelId}`, "warning");
			}
		} else {
			ctx.ui.notify(
				`Gear ${gear.id} (${gear.name}): Target model ${gear.modelId} not registered in models.json`,
				"warning"
			);
		}

		// 2. Set thinking level
		pi.setThinkingLevel(gear.thinking ? "high" : "off");

		// 3. Update status badge
		updateStatus(ctx);

		ctx.ui.notify(`Shifted to Gear ${gear.id}: ${gear.name} (${gear.provider}/${gear.model}, temp: ${gear.temperature})`, "info");
		return true;
	}

	async function showGearSelector(ctx: ExtensionContext): Promise<void> {
		const items: SelectItem[] = GEARS.map((gear) => {
			const isActive = activeGear?.id === gear.id;
			const modeIcon = gear.thinking ? BRAIN_ICON : LIGHTNING_ICON;
			return {
				value: String(gear.id),
				label: isActive
					? `[${gear.id}] ${gear.name} ${modeIcon} (active)`
					: `[${gear.id}] ${gear.name} ${modeIcon}`,
				description: buildGearDescription(gear),
			};
		});

		const result = await ctx.ui.custom<string | null>((tui, theme, kb, done) => {
			// Record mount time. Foot terminal buffers the \n from the \r\n Enter
			// sequence in pi's own pendingUserInputs queue and replays it to the
			// newly focused component. We discard any confirm key (\n, \r, or the
			// tui.select.confirm binding) received within 200 ms of mounting so
			// the user can actually see and navigate the list.
			const mountedAt = Date.now();
			const GUARD_MS = 200;

			const container = new Container();
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
			container.addChild(new Text(theme.fg("accent", theme.bold(`${GEAR_ICON} Select Cognitive Execution Gear`))));

			const selectList = new SelectList(items, Math.min(items.length, 10), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText:   (text) => theme.fg("accent", text),
				description:    (text) => theme.fg("muted", text),
				scrollInfo:     (text) => theme.fg("dim", text),
				noMatch:        (text) => theme.fg("warning", text),
			});

			selectList.onSelect = (item) => done(item.value);
			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					// Drop spurious confirm key replayed by foot's \r\n buffering
					const isConfirm = data === "\n" || data === "\r" || kb.matches(data, "tui.select.confirm");
					if (isConfirm && Date.now() - mountedAt < GUARD_MS) return;

					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (!result) return;

		const selectedGear = findGear(result);
		if (selectedGear) {
			await applyGear(selectedGear, ctx);
		}
	}

	async function cycleGear(ctx: ExtensionContext): Promise<void> {
		if (GEARS.length === 0) return;

		const currentIndex = activeGear ? GEARS.findIndex((g) => g.id === activeGear!.id) : -1;
		const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % GEARS.length;
		const nextGear = GEARS[nextIndex];

		await applyGear(nextGear, ctx);
	}

	// Register /gear command
	pi.registerCommand("gear", {
		description: "Switch cognitive execution gear (e.g. 1: plan, 2: exec, 3: cpu-plan, 4: cpu-exec)",
		getArgumentCompletions: (argumentPrefix: string) => {
			const prefix = argumentPrefix.toLowerCase().trim();
			const suggestions: { value: string; label: string; description: string }[] = [];

			for (const gear of GEARS) {
				const idStr = String(gear.id);
				if (idStr.startsWith(prefix)) {
					suggestions.push({
						value: idStr,
						label: idStr,
						description: `Gear ${gear.id} (${gear.name}) - ${gear.description}`,
					});
				}
				if (gear.name.toLowerCase().startsWith(prefix) && gear.name.toLowerCase() !== prefix) {
					suggestions.push({
						value: gear.name,
						label: gear.name,
						description: `Gear ${gear.id} (${gear.name}) - ${gear.description}`,
					});
				}
				for (const alias of gear.alias) {
					if (alias.toLowerCase().startsWith(prefix) && alias !== idStr && alias !== gear.name) {
						suggestions.push({
							value: alias,
							label: alias,
							description: `Alias for Gear ${gear.id} (${gear.name})`,
						});
					}
				}
			}

			return suggestions.length > 0 ? suggestions : null;
		},
		handler: async (args, ctx) => {
			const trimmed = args?.trim();
			if (trimmed) {
				const gear = findGear(trimmed);
				if (!gear) {
					const available = GEARS.map((g) => `${g.id} (${g.name})`).join(", ");
					ctx.ui.notify(`Unknown gear "${trimmed}". Available gears: ${available}`, "error");
					return;
				}
				await applyGear(gear, ctx);
				return;
			}

			await showGearSelector(ctx);
		},
	});

	// Register keyboard shortcut alt+shift+g to cycle gears sequentially
	pi.registerShortcut(Key.altShift("g"), {
		description: "Cycle cognitive execution gear",
		handler: async (ctx) => {
			await cycleGear(ctx);
		},
	});

	// Hook before_provider_request to enforce temperature and enable_thinking
	pi.on("before_provider_request", async (event, ctx) => {
		if (!event.payload || typeof event.payload !== "object") return;

		const payload = event.payload as Record<string, unknown>;
		const activeProvider = activeGear?.provider;

		// Check if request is directed to active gear's provider
		const modelStr = typeof payload.model === "string" ? payload.model : "";
		const matchesGearProvider =
			Boolean(activeProvider && modelStr.startsWith(`${activeProvider}/`)) ||
			modelStr.startsWith("qwen-gear-") ||
			ctx.model?.provider === activeProvider;

		if (matchesGearProvider && activeGear) {
			payload.temperature = activeGear.temperature;

			const existingKwargs =
				payload.chat_template_kwargs && typeof payload.chat_template_kwargs === "object"
					? (payload.chat_template_kwargs as Record<string, unknown>)
					: {};

			payload.chat_template_kwargs = {
				...existingKwargs,
				enable_thinking: activeGear.thinking,
			};
		}
	});

	// Optional instructions injection if defined on gear
	pi.on("before_agent_start", async (event) => {
		if (activeGear?.instructions) {
			return {
				systemPrompt: `${event.systemPrompt}\n\n${activeGear.instructions}`,
			};
		}
	});

	// Intercept tool calls using registered interceptors
	pi.on("tool_call", async (event, _ctx) => {
		if (!activeGear) return;
		const targetModel = activeGear.modelId
			? activeGear.modelId
			: `${activeGear.provider}/${activeGear.model}`;
		const interceptorCtx: ToolInterceptorContext = {
			activeGear,
			gearTargetModel: targetModel,
			config: activeGear.interceptors || GLOBAL_INTERCEPTORS,
		};
		await executeToolInterceptors(event.toolName, event.input, interceptorCtx);
	});

	// Reload gears and restore state on session_start
	pi.on("session_start", async (_event, ctx) => {
		const config = loadGearsConfigFile(ctx.cwd);
		GEARS = config.gears;
		GLOBAL_INTERCEPTORS = config.interceptors;

		const entries = ctx.sessionManager.getEntries();
		const gearEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "gear-state")
			.pop() as { data?: { gearId: number } } | undefined;

		if (gearEntry?.data?.gearId) {
			const restored = findGear(gearEntry.data.gearId);
			if (restored) {
				activeGear = restored;
			}
		}

		updateStatus(ctx);
	});

	// Persist gear on turn_start
	pi.on("turn_start", async () => {
		if (activeGear) {
			pi.appendEntry("gear-state", { gearId: activeGear.id });
		}
	});
}
