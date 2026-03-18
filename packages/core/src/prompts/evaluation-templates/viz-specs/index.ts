/**
 * Visualization Spec System — Barrel Export
 */

// Schema types
export {
	type CompetitorEstimation,
	CompetitorEstimationSchema,
	DerivationSchema,
	type EvidenceSection,
	EvidenceSectionSchema,
	type ProductRecognitionItem,
	ProductRecognitionItemSchema,
	type QualityBar,
	QualityBarSchema,
	type ReferenceSpec,
	ReferenceSpecSchema,
	type SiteSubtype,
	SiteSubtypeSchema,
	SUBTYPE_BY_SITE_TYPE,
	SUBTYPE_SIGNALS,
	type SubtypeSignal,
	type TabSpec,
	TabSpecSchema,
	type VizElement,
	VizElementSchema,
	type VizElementType,
	VizElementTypeSchema,
	type VisualizationSpec,
	VisualizationSpecSchema,
} from "./viz-spec-schema.js";

// Tab definitions
export { COMMON_TABS } from "./common-tabs.js";
export {
	MANUFACTURER_EXTRA_TABS,
	MANUFACTURER_SIMULATION_LINES,
	MANUFACTURER_TAB_EXTENSIONS,
} from "./manufacturer-tabs.js";
export {
	RESEARCH_EXTRA_TABS,
	RESEARCH_SIMULATION_LINES,
	RESEARCH_TAB_EXTENSIONS,
} from "./research-tabs.js";
export {
	GENERIC_EXTRA_TABS,
	GENERIC_SIMULATION_LINES,
	GENERIC_TAB_EXTENSIONS,
} from "./generic-tabs.js";

// Reference specs
export { MANUFACTURER_ELECTRONICS_REF } from "./references/manufacturer-electronics.js";

// Loader
export {
	classifySubtype,
	findReference,
	getTabSpec,
	listReferences,
	type LoadVizSpecOptions,
	loadVisualizationSpec,
	type SubtypeClassificationResult,
	validateQualityBar,
} from "./viz-spec-loader.js";
