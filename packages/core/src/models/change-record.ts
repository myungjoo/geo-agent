import { z } from "zod";
import { ChangeTypeSchema } from "./change-type.js";

export const ChangeRecordSchema = z.object({
	change_id: z.string().uuid(),
	experiment_id: z.string().uuid(),
	url: z.string().url(),
	target_id: z.string().uuid(),
	changed_at: z.string().datetime(),
	change_type: ChangeTypeSchema,
	change_summary: z.string(),
	diff: z.string(),
	snapshot_before: z.string().uuid(),
	snapshot_after: z.string().uuid().nullable(),
	triggered_by: z.enum(["auto", "manual", "scheduled"]),
	strategy_ref: z.string().uuid().nullable(),
});

export type ChangeRecord = z.infer<typeof ChangeRecordSchema>;
