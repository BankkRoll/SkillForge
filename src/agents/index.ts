/**
 * SkillForge Agents
 *
 * Multi-agent orchestration system for skill generation.
 * Exports all agents and the main pipeline.
 *
 * @module agents
 */

export * from "./base.js";
export * from "./orchestrator.js";
export * from "./researcher.js";
export * from "./skill-writer.js";
export * from "./example-generator.js";
export * from "./qa.js";

import { OrchestratorAgent, type Plan } from "./orchestrator.js";
import { ResearcherAgent, type ResearchOutput } from "./researcher.js";
import { SkillWriterAgent, type SkillOutput } from "./skill-writer.js";
import {
  ExampleGeneratorAgent,
  type ExamplesOutput,
} from "./example-generator.js";
import { QAAgent, type QAResult } from "./qa.js";
import type { SkillGenerationRequest } from "../schemas/index.js";
import type { AgentEventHandlers } from "./base.js";

// ============================================================================
// PIPELINE TYPES
// ============================================================================

/** Result from the full pipeline run */
export interface PipelineResult {
  success: boolean;
  plan: Plan;
  skills: Array<{
    name: string;
    research: ResearchOutput;
    skill: SkillOutput;
    markdown: string;
    examples?: ExamplesOutput;
    qa: QAResult;
    passed: boolean;
  }>;
  totalTokens: number;
  totalDuration: number;
  errors: string[];
}

/** Options for pipeline configuration */
export interface PipelineOptions {
  /** Generate code examples (default: true) */
  generateExamples?: boolean;
  /** Run QA review (default: true) - skip for faster/cheaper generation */
  runQA?: boolean;
  /** Minimum QA score to pass (default: 80) */
  qualityThreshold?: number;
  /** Maximum refinement iterations (default: 3) */
  maxIterations?: number;
  /** Process skills in parallel (default: false) */
  parallel?: boolean;
  /** Enable web search for research (default: true) */
  useWebSearch?: boolean;
  /** Maximum web search results (default: 10) */
  maxSearchResults?: number;
  /** Model to use for all agents (inherits from gateway if not specified) */
  model?: string;
}

/** Complete skill data for immediate writing */
export interface SkillData {
  name: string;
  research: ResearchOutput;
  skill: SkillOutput;
  markdown: string;
  examples?: ExamplesOutput;
  qa: QAResult;
  passed: boolean;
}

/** Event handlers for pipeline progress */
export interface PipelineEvents {
  onPlanCreated?: (plan: Plan) => void;
  onSkillStart?: (skillName: string) => void;
  onResearchComplete?: (skillName: string, research: ResearchOutput) => void;
  onSkillWritten?: (skillName: string, skill: SkillOutput) => void;
  onExamplesGenerated?: (skillName: string, examples: ExamplesOutput) => void;
  onQAComplete?: (skillName: string, qa: QAResult) => void;
  onSkillComplete?: (skillName: string, passed: boolean) => void;
  /** Called with full skill data - use this to write files immediately */
  onSkillReady?: (skill: SkillData) => void | Promise<void>;
  onProgress?: (current: number, total: number, message: string) => void;
}

// ============================================================================
// SKILL GENERATION PIPELINE
// ============================================================================

/**
 * Main pipeline for skill generation.
 * Coordinates all agents to produce complete skills.
 */
export class SkillGenerationPipeline {
  private orchestrator: OrchestratorAgent;
  private researcher: ResearcherAgent;
  private skillWriter: SkillWriterAgent;
  private exampleGenerator: ExampleGeneratorAgent;
  private qa: QAAgent;

  private options: Required<Omit<PipelineOptions, "model">> & {
    model?: string;
  };
  private events: PipelineEvents;

  constructor(
    eventHandlers: AgentEventHandlers = {},
    pipelineEvents: PipelineEvents = {},
    options: PipelineOptions = {},
  ) {
    const model = options.model;

    this.orchestrator = new OrchestratorAgent({ model, eventHandlers });
    this.researcher = new ResearcherAgent({ model, eventHandlers });
    this.skillWriter = new SkillWriterAgent({ model, eventHandlers });
    this.exampleGenerator = new ExampleGeneratorAgent({ model, eventHandlers });
    this.qa = new QAAgent({ model, eventHandlers });

    this.options = {
      generateExamples: options.generateExamples ?? true,
      runQA: options.runQA ?? true,
      qualityThreshold: options.qualityThreshold ?? 80,
      maxIterations: options.maxIterations ?? 3,
      parallel: options.parallel ?? false,
      useWebSearch: options.useWebSearch ?? true,
      maxSearchResults: options.maxSearchResults ?? 10,
      model,
    };

    this.events = pipelineEvents;
  }

  /** Run the full skill generation pipeline */
  async run(request: SkillGenerationRequest): Promise<PipelineResult> {
    const startTime = Date.now();
    let totalTokens = 0;
    const errors: string[] = [];
    const skills: PipelineResult["skills"] = [];

    this.events.onProgress?.(0, 100, "Creating execution plan...");

    const planResult = await this.orchestrator.run({
      content: request.prompt,
      context: { request },
    });

    if (!planResult.success) {
      return {
        success: false,
        plan: { skills: [], tasks: [], totalEstimatedSteps: 0, reasoning: "" },
        skills: [],
        totalTokens: planResult.usage.totalTokens,
        totalDuration: Date.now() - startTime,
        errors: [planResult.error || "Failed to create plan"],
      };
    }

    const plan = planResult.output as Plan;
    totalTokens += planResult.usage.totalTokens;
    this.events.onPlanCreated?.(plan);

    const totalSkills = plan.skills.length;
    let completedSkills = 0;

    const processSkill = async (skillDef: {
      name: string;
      description: string;
      scope: string;
    }) => {
      this.events.onSkillStart?.(skillDef.name);

      try {
        this.events.onProgress?.(
          Math.round((completedSkills / totalSkills) * 100),
          100,
          `Researching ${skillDef.name}...`,
        );

        const researchResult = await this.researcher.run({
          content: skillDef.description,
          context: {
            skillName: skillDef.name,
            skillDescription: skillDef.description,
            context: {
              domain: request.target?.domain,
              framework: request.target?.framework,
              language: request.target?.language,
            },
            useWebSearch: this.options.useWebSearch,
            maxSearchResults: this.options.maxSearchResults,
          },
        });

        if (!researchResult.success) {
          throw new Error(`Research failed: ${researchResult.error}`);
        }

        const research = researchResult.output as ResearchOutput;
        totalTokens += researchResult.usage.totalTokens;
        this.events.onResearchComplete?.(skillDef.name, research);

        this.events.onProgress?.(
          Math.round((completedSkills / totalSkills) * 100),
          100,
          `Writing ${skillDef.name}...`,
        );

        const writeResult = await this.skillWriter.run({
          content: skillDef.description,
          context: {
            skillName: skillDef.name,
            skillDescription: skillDef.description,
            research,
            options: request.options,
          },
        });

        if (!writeResult.success) {
          throw new Error(`Writing failed: ${writeResult.error}`);
        }

        const { skill, markdown } = writeResult.output as {
          skill: SkillOutput;
          markdown: string;
        };
        totalTokens += writeResult.usage.totalTokens;
        this.events.onSkillWritten?.(skillDef.name, skill);

        let examples: ExamplesOutput | undefined;
        if (this.options.generateExamples) {
          this.events.onProgress?.(
            Math.round((completedSkills / totalSkills) * 100),
            100,
            `Generating examples for ${skillDef.name}...`,
          );

          const examplesResult = await this.exampleGenerator.run({
            content: skillDef.description,
            context: {
              skill,
              options: {
                language: request.target?.language,
                framework: request.target?.framework,
                includeScripts: request.options?.generateScripts,
                includeReferences: request.options?.generateReferences,
              },
            },
          });

          if (examplesResult.success) {
            examples = examplesResult.output as ExamplesOutput;
            totalTokens += examplesResult.usage.totalTokens;
            this.events.onExamplesGenerated?.(skillDef.name, examples);
          }
        }

        // Run QA if enabled (skip for faster/cheaper generation)
        let qa: QAResult;
        let passed = true;

        if (this.options.runQA) {
          this.events.onProgress?.(
            Math.round((completedSkills / totalSkills) * 100),
            100,
            `Reviewing ${skillDef.name}...`,
          );

          const qaResult = await this.qa.run({
            content: skillDef.description,
            context: { skill, markdown, examples },
          });

          if (!qaResult.success) {
            throw new Error(`QA failed: ${qaResult.error}`);
          }

          qa = qaResult.output as QAResult;
          totalTokens += qaResult.usage.totalTokens;
          this.events.onQAComplete?.(skillDef.name, qa);

          passed =
            qa.overallScore >= this.options.qualityThreshold &&
            !qa.issues.some((i) => i.severity === "critical");
        } else {
          // Skip QA - create minimal passing QA result
          qa = {
            skillName: skillDef.name,
            passed: true,
            overallScore: 100,
            summary: "QA skipped for faster generation",
            issues: [],
            scores: {
              completeness: 100,
              clarity: 100,
              accuracy: 100,
              security: 100,
              consistency: 100,
              examples: 100,
            },
            strengths: ["Generated successfully"],
            recommendations: [],
          };
          this.events.onQAComplete?.(skillDef.name, qa);
        }

        const skillData: SkillData = {
          name: skillDef.name,
          research,
          skill,
          markdown,
          examples,
          qa,
          passed,
        };

        // Allow immediate file writing
        await this.events.onSkillReady?.(skillData);
        this.events.onSkillComplete?.(skillDef.name, passed);
        completedSkills++;

        return skillData;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${skillDef.name}: ${errorMsg}`);
        completedSkills++;

        return {
          name: skillDef.name,
          research: {} as ResearchOutput,
          skill: {} as SkillOutput,
          markdown: "",
          qa: { passed: false, overallScore: 0 } as QAResult,
          passed: false,
        };
      }
    };

    if (this.options.parallel) {
      const results = await Promise.all(plan.skills.map(processSkill));
      skills.push(...results);
    } else {
      for (const skillDef of plan.skills) {
        const result = await processSkill(skillDef);
        skills.push(result);
      }
    }

    this.events.onProgress?.(100, 100, "Complete!");

    return {
      success: errors.length === 0,
      plan,
      skills,
      totalTokens,
      totalDuration: Date.now() - startTime,
      errors,
    };
  }

  /** Run a single skill generation without planning */
  async runSingle(
    skillName: string,
    skillDescription: string,
    context?: {
      domain?: string;
      framework?: string;
      language?: string;
    },
  ): Promise<PipelineResult["skills"][0]> {
    const researchResult = await this.researcher.run({
      content: skillDescription,
      context: {
        skillName,
        skillDescription,
        context,
        useWebSearch: this.options.useWebSearch,
        maxSearchResults: this.options.maxSearchResults,
      },
    });

    const research = researchResult.output as ResearchOutput;

    const writeResult = await this.skillWriter.run({
      content: skillDescription,
      context: {
        skillName,
        skillDescription,
        research,
      },
    });

    const { skill, markdown } = writeResult.output as {
      skill: SkillOutput;
      markdown: string;
    };

    let examples: ExamplesOutput | undefined;
    if (this.options.generateExamples) {
      const examplesResult = await this.exampleGenerator.run({
        content: skillDescription,
        context: { skill, options: { language: context?.language } },
      });
      examples = examplesResult.output as ExamplesOutput;
    }

    const qaResult = await this.qa.run({
      content: skillDescription,
      context: { skill, markdown, examples },
    });

    const qa = qaResult.output as QAResult;
    const passed = qa.overallScore >= this.options.qualityThreshold;

    return {
      name: skillName,
      research,
      skill,
      markdown,
      examples,
      qa,
      passed,
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new skill generation pipeline
 */
export function createPipeline(
  options?: PipelineOptions,
  events?: PipelineEvents,
): SkillGenerationPipeline {
  return new SkillGenerationPipeline({}, events, options);
}
