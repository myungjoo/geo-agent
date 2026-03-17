import { z } from "zod";

export const AgentIdSchema = z.enum([
	"orchestrator",
	"analysis",
	"strategy",
	"optimization",
	"validation",
	"monitoring",
]);

export type AgentId = z.infer<typeof AgentIdSchema>;

export const ContextSlotSchema = z.object({
	slot_name: z.string(),
	description: z.string(),
	source: z.string(),
	required: z.boolean(),
});

export type ContextSlot = z.infer<typeof ContextSlotSchema>;

export const AgentPromptConfigSchema = z.object({
	agent_id: AgentIdSchema,
	display_name: z.string(),
	system_instruction: z.string(),
	context_slots: z.array(ContextSlotSchema),
	model_preference: z.string().nullable(),
	temperature: z.number().min(0).max(1).default(0.3),
	is_customized: z.boolean().default(false),
	last_modified: z.string().datetime(),
});

export type AgentPromptConfig = z.infer<typeof AgentPromptConfigSchema>;
