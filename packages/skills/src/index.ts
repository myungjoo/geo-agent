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
	input_schema?: Record<string, unknown>;
	output_schema?: Record<string, unknown>;
}

export interface SkillExecutionContext {
	target_id: string;
	target_url: string;
	workspace_dir: string;
	clone_path?: string;
	[key: string]: unknown;
}

export interface SkillResult {
	success: boolean;
	data?: unknown;
	error?: string;
	duration_ms: number;
}

export interface Skill {
	metadata: SkillMetadata;
	execute(context: SkillExecutionContext, params: Record<string, unknown>): Promise<SkillResult>;
}

export interface SkillRegistry {
	/** List all registered skills */
	listSkills(): SkillMetadata[];
	/** Get a specific skill by name */
	getSkill(name: string): SkillMetadata | null;
	/** Register a new skill */
	registerSkill(skill: Skill): void;
	/** Execute a skill by name */
	executeSkill(
		name: string,
		context: SkillExecutionContext,
		params?: Record<string, unknown>,
	): Promise<SkillResult>;
}

// ── Bundled Skills ─────────────────────────────────────────

const BUNDLED_SKILLS: SkillMetadata[] = [
	{
		name: "dual-crawl",
		version: "1.0.0",
		description: "Target URL을 크롤링하여 HTML, 구조화 데이터, robots.txt 등을 수집",
		author: "geo-agent",
		tags: ["crawling", "data-collection"],
		tier: "bundled",
	},
	{
		name: "schema-builder",
		version: "1.0.0",
		description: "JSON-LD, Schema.org 구조화 데이터를 분석하고 개선안 생성",
		author: "geo-agent",
		tags: ["structured-data", "schema.org", "json-ld"],
		tier: "bundled",
	},
	{
		name: "geo-scorer",
		version: "1.0.0",
		description: "GEO 7차원 평가 점수를 산출 (S1~S7)",
		author: "geo-agent",
		tags: ["scoring", "evaluation"],
		tier: "bundled",
	},
	{
		name: "content-optimizer",
		version: "1.0.0",
		description: "콘텐츠 기계가독성 및 팩트 밀도를 개선",
		author: "geo-agent",
		tags: ["optimization", "content"],
		tier: "bundled",
	},
	{
		name: "site-classifier",
		version: "1.0.0",
		description: "사이트 유형 자동 분류 (manufacturer/research/generic)",
		author: "geo-agent",
		tags: ["classification", "analysis"],
		tier: "bundled",
	},
	{
		name: "diff-generator",
		version: "1.0.0",
		description: "원본과 수정본의 변경사항 diff 생성",
		author: "geo-agent",
		tags: ["diff", "comparison", "report"],
		tier: "bundled",
	},
];

/**
 * Creates a skill registry with bundled skills pre-registered.
 */
export function createSkillRegistry(): SkillRegistry {
	const skills = new Map<string, Skill>();

	// Bundled 스킬은 메타데이터만 등록 (실행 로직은 각 에이전트가 담당)
	for (const meta of BUNDLED_SKILLS) {
		skills.set(meta.name, {
			metadata: meta,
			execute: async (_ctx, _params) => {
				return {
					success: false,
					error: `Skill '${meta.name}' execution requires agent integration (not standalone)`,
					duration_ms: 0,
				};
			},
		});
	}

	return {
		listSkills() {
			return Array.from(skills.values()).map((s) => s.metadata);
		},

		getSkill(name: string) {
			return skills.get(name)?.metadata ?? null;
		},

		registerSkill(skill: Skill) {
			skills.set(skill.metadata.name, skill);
		},

		async executeSkill(name, context, params = {}) {
			const skill = skills.get(name);
			if (!skill) {
				return {
					success: false,
					error: `Skill '${name}' not found`,
					duration_ms: 0,
				};
			}
			const startTime = Date.now();
			try {
				const result = await skill.execute(context, params);
				return { ...result, duration_ms: Date.now() - startTime };
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
					duration_ms: Date.now() - startTime,
				};
			}
		},
	};
}

/** Bundled 스킬 메타데이터 직접 접근 */
export function getBundledSkills(): SkillMetadata[] {
	return [...BUNDLED_SKILLS];
}
