/**
 * SkillForge - AI-powered skill, agent, and plugin generator
 *
 * A comprehensive CLI tool for generating skills, agents, and plugins
 * for Claude Code and 40+ AI coding agents using the Skills.sh open standard.
 *
 * @module skillforge
 */

// Gateway - Pure AI SDK Gateway abstraction
export * from "./gateway/index.js";

// Schemas - Zod validation schemas
export * from "./schemas/index.js";

// Agents - Multi-agent orchestration system
export * from "./agents/index.js";
export * from "./agents/base.js";
export * from "./agents/orchestrator.js";
export * from "./agents/researcher.js";
export * from "./agents/skill-writer.js";
export * from "./agents/example-generator.js";
export * from "./agents/qa.js";

// Generators - File output generators
export * from "./generators/index.js";

// Utilities - Crawler, analyzer, quality gates, checkpointing
export * from "./utils/index.js";

// Templates - Template engine and starter templates
export * from "./templates/index.js";

// Types for convenience
export type {
  // Gateway types
  GatewayConfig,
  GenerateOptions,
  GenerateResult,
  StructuredResult,
} from "./gateway/index.js";

export type {
  // Schema types
  SkillFrontmatter,
  SkillBody,
  AgentFrontmatter,
  PluginManifest,
  HooksConfig,
  SkillGenerationRequest,
  SkillForgeConfig,
} from "./schemas/index.js";

export type {
  // Agent types
  AgentInput,
  AgentResult,
  AgentEventHandlers,
  Plan,
  Task,
} from "./agents/index.js";

export type { ResearchOutput } from "./agents/researcher.js";

export type { SkillOutput } from "./agents/skill-writer.js";

export type {
  ExamplesOutput,
  CodeExample,
} from "./agents/example-generator.js";

export type { QAResult, Issue as QAIssue } from "./agents/qa.js";

export type {
  // Generator types
  GeneratedSkill,
  GenerationResult as SkillGenerationResult,
  SkillGeneratorOptions,
} from "./generators/skill.js";

export type {
  AgentDefinition,
  GeneratedAgent,
  AgentGeneratorOptions,
} from "./generators/agent.js";

export type {
  PluginDefinition,
  GeneratedPlugin,
  PluginGeneratorOptions,
  HookDefinition,
  PluginSetting,
} from "./generators/plugin.js";

export type {
  // Utility types
  CrawlResult,
  CrawlOptions,
  CrawlSession,
} from "./utils/crawler.js";

export type {
  AnalysisResult,
  AnalyzerOptions,
  FileInfo,
  CodePattern,
  ProjectStructure,
} from "./utils/repo-analyzer.js";

export type {
  LintResult,
  LintIssue,
  QualityConfig,
  QualityGate,
} from "./utils/quality-gates.js";

export type {
  CheckpointData,
  CheckpointSummary,
  CheckpointManagerOptions,
} from "./utils/checkpoint.js";

// ============================================================================
// CONVENIENCE FACTORY FUNCTIONS
// ============================================================================

import { AIGateway } from "./gateway/index.js";
import {
  SkillGenerationPipeline,
  type PipelineOptions,
  type PipelineEvents,
} from "./agents/index.js";
import { UnifiedGenerator } from "./generators/index.js";
import type { SkillGenerationRequest } from "./schemas/index.js";
import type { AgentResult } from "./agents/base.js";

/**
 * Create a new SkillForge instance with all components configured
 */
/** Default model used when none specified */
const DEFAULT_MODEL =
  process.env.SKILLFORGE_DEFAULT_MODEL || "anthropic/claude-sonnet-4";

export function createSkillForge(config: {
  apiKey: string;
  model?: string;
  outputDir?: string;
  verbose?: boolean;
}) {
  const gateway = new AIGateway({
    apiKey: config.apiKey,
    defaultModel: config.model || DEFAULT_MODEL,
  });

  const createPipeline = (
    events?: PipelineEvents,
    options?: PipelineOptions,
  ) => {
    return new SkillGenerationPipeline(
      {
        onStart: config.verbose
          ? (agent) => console.log(`Agent started: ${agent.name}`)
          : undefined,
        onComplete: config.verbose
          ? (agent, result: AgentResult) =>
              console.log(
                `Agent complete: ${agent.name} (${result.duration}ms)`,
              )
          : undefined,
      },
      events,
      options,
    );
  };

  const createGenerator = (outputDir?: string) => {
    return new UnifiedGenerator(
      {
        outputDir: outputDir || config.outputDir || "./output",
        verbose: config.verbose,
      },
      gateway,
    );
  };

  return {
    gateway,
    createPipeline,
    createGenerator,

    /**
     * Generate skills from a prompt (full pipeline)
     */
    async generate(
      request: SkillGenerationRequest,
      options?: {
        outputDir?: string;
        events?: PipelineEvents;
        pipelineOptions?: PipelineOptions;
      },
    ) {
      const pipeline = createPipeline(
        options?.events,
        options?.pipelineOptions,
      );
      const result = await pipeline.run(request);

      if (options?.outputDir || config.outputDir) {
        const generator = createGenerator(options?.outputDir);
        const genResult = await generator.generateFromPipeline(result);
        return { ...result, generation: genResult };
      }

      return result;
    },

    /**
     * Generate a single skill without full orchestration
     */
    async generateSingle(
      skillName: string,
      skillDescription: string,
      context?: {
        domain?: string;
        framework?: string;
        language?: string;
      },
    ) {
      const pipeline = createPipeline();
      return pipeline.runSingle(skillName, skillDescription, context);
    },
  };
}

/**
 * Quick skill generation from a prompt
 */
export async function quickGenerate(
  prompt: string,
  config: {
    apiKey: string;
    outputDir?: string;
    model?: string;
    domain?: string;
    framework?: string;
    language?: string;
  },
) {
  const sf = createSkillForge({
    apiKey: config.apiKey,
    model: config.model,
    outputDir: config.outputDir,
  });

  return sf.generate({
    prompt,
    target: {
      domain: config.domain,
      framework: config.framework,
      language: config.language,
    },
  });
}
