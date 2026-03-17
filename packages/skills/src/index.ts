/**
 * @geo-agent/skills
 *
 * Skill registry and management for the GEO Agent System.
 * Skills are modular tools that agents use during the optimization pipeline.
 *
 * Skill tiers:
 * - Bundled: Core GEO skills shipped with the system
 * - Managed: Installed from ClawHub registry
 * - Workspace: User-created or agent-generated custom skills
 */

export interface SkillMetadata {
	name: string;
	version: string;
	description: string;
	author: string;
	tags: string[];
	tier: "bundled" | "managed" | "workspace";
}

export interface SkillRegistry {
	/** List all registered skills */
	listSkills(): SkillMetadata[];
	/** Get a specific skill by name */
	getSkill(name: string): SkillMetadata | null;
}

/**
 * Creates an in-memory skill registry.
 * TODO: Implement file-system backed registry with SKILL.md parsing.
 */
export function createSkillRegistry(): SkillRegistry {
	const skills = new Map<string, SkillMetadata>();

	return {
		listSkills() {
			return Array.from(skills.values());
		},
		getSkill(name: string) {
			return skills.get(name) ?? null;
		},
	};
}
