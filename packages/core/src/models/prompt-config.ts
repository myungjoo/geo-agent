import { z } from "zod";

// ── Prompt Category ─────────────────────────────────────────

export const PromptCategorySchema = z.enum([
	"agent_system",
	"skill",
	"evaluation_template",
	"probe_definition",
	"judgment",
	"optimization",
	"strategy_validation",
]);
export type PromptCategory = z.infer<typeof PromptCategorySchema>;

export const CATEGORY_LABELS: Record<PromptCategory, string> = {
	agent_system: "Agent System Prompts",
	skill: "Analysis Skill",
	evaluation_template: "Evaluation Templates",
	probe_definition: "Probe Definitions",
	judgment: "Judgment Prompts",
	optimization: "Optimization Prompts",
	strategy_validation: "Strategy & Validation",
};

export const CATEGORY_ICONS: Record<PromptCategory, string> = {
	agent_system: "🤖",
	skill: "📋",
	evaluation_template: "📝",
	probe_definition: "🧪",
	judgment: "⚖️",
	optimization: "🔧",
	strategy_validation: "📊",
};

export const CATEGORY_ORDER: PromptCategory[] = [
	"agent_system",
	"skill",
	"evaluation_template",
	"probe_definition",
	"judgment",
	"optimization",
	"strategy_validation",
];

// ── Variable Reference ──────────────────────────────────────

export const VariableRefSchema = z.object({
	name: z.string(),
	description: z.string(),
});
export type VariableRef = z.infer<typeof VariableRefSchema>;

// ── Prompt Config Item ──────────────────────────────────────

export const PromptConfigItemSchema = z.object({
	id: z.string(),
	category: PromptCategorySchema,
	display_name: z.string(),
	prompt_template: z.string(),
	system_instruction: z.string(),
	variables: z.array(VariableRefSchema),
	is_customized: z.boolean().default(false),
	last_modified: z.string().nullable().default(null),
});
export type PromptConfigItem = z.infer<typeof PromptConfigItemSchema>;

// ── Grouped result type ─────────────────────────────────────

export interface PromptConfigGroup {
	category: PromptCategory;
	label: string;
	icon: string;
	items: PromptConfigItem[];
}
