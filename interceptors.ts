/**
 * Extensible tool interceptor interfaces and registry for pi-gears.
 *
 * Provides a modular mechanism to inspect and mutate tool execution inputs,
 * enabling cognitive execution gear propagation (e.g. into pi-subagents tasks).
 */

import type { GearConfig } from "./pi-gears.js";

/**
 * Subagent interceptor configuration options.
 */
export interface SubagentInterceptorConfig {
	enabled?: boolean;
	propagateModel?: boolean;
	propagateThinking?: boolean;
	preserveExplicitThinking?: boolean;
	targetAgents?: string[];
}

/**
 * Top-level interceptors configuration.
 */
export interface InterceptorsConfig {
	subagent?: SubagentInterceptorConfig;
	[key: string]: unknown;
}

/**
 * Context provided to tool interceptors during execution.
 */
export interface ToolInterceptorContext {
	activeGear?: GearConfig;
	gearTargetModel?: string;
	config?: InterceptorsConfig;
}

/**
 * Interface representing a tool interceptor.
 */
export interface ToolInterceptor {
	toolName: string;
	enabled?(ctx: ToolInterceptorContext): boolean;
	handler(input: Record<string, unknown>, ctx: ToolInterceptorContext): void | Promise<void>;
}

export const DEFAULT_SUBAGENT_INTERCEPTOR_CONFIG: Required<SubagentInterceptorConfig> = {
	enabled: true,
	propagateModel: true,
	propagateThinking: true,
	preserveExplicitThinking: true,
	targetAgents: ["worker", "reviewer", "coder"],
};

const THINKING_SUFFIX_REGEX = /:(?:high|off|low|medium|none)$/i;

/**
 * Checks whether a model identifier contains an explicit thinking suffix.
 */
export function hasExplicitThinkingSuffix(modelStr: string): boolean {
	return THINKING_SUFFIX_REGEX.test(modelStr.trim());
}

/**
 * Checks whether a given target agent name matches the configured target list.
 * Supports exact case-insensitive matches and "*" wildcard.
 */
export function matchesTargetAgent(agentName: string | undefined, targetAgents: string[]): boolean {
	if (!agentName) return false;
	const name = agentName.trim().toLowerCase();
	return targetAgents.some((t) => {
		const target = t.trim().toLowerCase();
		return target === "*" || target === name;
	});
}

/**
 * Patches a single subagent task item with gear model and thinking level.
 */
function patchSubagentTaskItem(
	item: Record<string, unknown>,
	targetModel: string,
	thinkingSuffix: string,
	config: Required<SubagentInterceptorConfig>
): void {
	const agentName = typeof item.agent === "string" ? item.agent : undefined;
	if (!matchesTargetAgent(agentName, config.targetAgents)) {
		return;
	}

	const existingModel = typeof item.model === "string" ? item.model.trim() : undefined;
	const hasExplicitThinking = existingModel ? hasExplicitThinkingSuffix(existingModel) : false;

	if (!config.propagateModel) {
		// If not propagating model, we do not touch item.model
		return;
	}

	if (!existingModel) {
		// No model specified: set gear target model + thinking suffix if enabled
		const suffix = config.propagateThinking ? thinkingSuffix : "";
		item.model = `${targetModel}${suffix}`;
		return;
	}

	// Model specified by caller
	if (hasExplicitThinking && config.preserveExplicitThinking) {
		// Explicit thinking specified and should be preserved: do not alter suffix
		return;
	}

	if (config.propagateThinking) {
		// Strip any trailing thinking suffix if present (or attach to clean model name)
		const cleanModel = existingModel.replace(THINKING_SUFFIX_REGEX, "");
		item.model = `${cleanModel}${thinkingSuffix}`;
	}
}

/**
 * Patches a task array field (parallel or chain) with gear model and thinking level.
 * Iterates over each task item in the specified array and applies patchSubagentTaskItem.
 */
function patchTaskArrayField(
	input: any,
	fieldName: 'parallel' | 'chain',
	targetModel: string,
	thinkingSuffix: string,
	config: Required<SubagentInterceptorConfig>
): void {
	if (!Array.isArray(input[fieldName])) {
		return;
	}

	for (const step of input[fieldName]) {
		if (step && typeof step === "object") {
			patchSubagentTaskItem(step as Record<string, unknown>, targetModel, thinkingSuffix, config);
		}
	}
}

/**
 * Built-in subagent tool interceptor.
 */
export const subagentInterceptor: ToolInterceptor = {
	toolName: "subagent",
	enabled(ctx: ToolInterceptorContext): boolean {
		const subagentConfig = ctx.config?.subagent;
		if (subagentConfig && subagentConfig.enabled !== undefined) {
			return subagentConfig.enabled;
		}
		return DEFAULT_SUBAGENT_INTERCEPTOR_CONFIG.enabled;
	},
	handler(input: Record<string, unknown>, ctx: ToolInterceptorContext): void {
		if (!ctx.activeGear && !ctx.gearTargetModel) {
			return;
		}

		const mergedConfig: Required<SubagentInterceptorConfig> = {
			...DEFAULT_SUBAGENT_INTERCEPTOR_CONFIG,
			...(ctx.config?.subagent || {}),
		};

		const targetModel = ctx.gearTargetModel || ctx.activeGear?.modelId;
		if (!targetModel) {
			return;
		}

		const thinkingSuffix = ctx.activeGear ? (ctx.activeGear.thinking ? ":high" : ":off") : "";

		// 1. Single task dispatch: { agent: "worker", task: "..." } when not an action dispatch
		if (typeof input.agent === "string" && !input.action) {
			patchSubagentTaskItem(input, targetModel, thinkingSuffix, mergedConfig);
		}

		// Patch subagent task arrays (parallel and chain dispatch)
		patchTaskArrayField(input, 'parallel', targetModel, thinkingSuffix, mergedConfig);
		patchTaskArrayField(input, 'chain', targetModel, thinkingSuffix, mergedConfig);
	},
};

/**
 * Returns the default set of tool interceptors.
 */
export function createDefaultInterceptors(): ToolInterceptor[] {
	return [subagentInterceptor];
}

/**
 * Runs matching interceptors for a given tool invocation.
 */
export async function executeToolInterceptors(
	toolName: string,
	input: unknown,
	ctx: ToolInterceptorContext,
	interceptors: ToolInterceptor[] = createDefaultInterceptors()
): Promise<void> {
	if (!input || typeof input !== "object") {
		return;
	}

	const inputRecord = input as Record<string, unknown>;

	for (const interceptor of interceptors) {
		if (interceptor.toolName !== toolName) {
			continue;
		}

		if (interceptor.enabled && !interceptor.enabled(ctx)) {
			continue;
		}

		await interceptor.handler(inputRecord, ctx);
	}
}
