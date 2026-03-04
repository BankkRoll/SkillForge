/**
 * SkillForge Generators
 * File output generators for skills, agents, and plugins
 */

export * from "./skill.js";
export * from "./agent.js";
export * from "./plugin.js";

import {
  SkillGenerator,
  type GeneratedSkill,
  type GenerationResult,
} from "./skill.js";
import {
  AgentGenerator,
  type AgentDefinition,
  type GeneratedAgent,
} from "./agent.js";
import {
  PluginGenerator,
  type PluginDefinition,
  type GeneratedPlugin,
} from "./plugin.js";
import type { AIGateway } from "../gateway/index.js";
import type { PipelineResult } from "../agents/index.js";

// ============================================================================
// UNIFIED GENERATOR
// ============================================================================

export interface UnifiedGeneratorOptions {
  outputDir: string;
  overwrite?: boolean;
  includeExamples?: boolean;
  includeTests?: boolean;
  verbose?: boolean;
}

export interface UnifiedGenerationResult {
  skills: GeneratedSkill[];
  agents: GeneratedAgent[];
  plugins: GeneratedPlugin[];
  totalFiles: number;
  success: boolean;
  errors: string[];
}

/**
 * Unified generator that can output skills, agents, and plugins
 */
export class UnifiedGenerator {
  private skillGenerator: SkillGenerator;
  private agentGenerator: AgentGenerator;
  private pluginGenerator: PluginGenerator;

  constructor(options: UnifiedGeneratorOptions, gateway?: AIGateway) {
    this.skillGenerator = new SkillGenerator({
      outputDir: options.outputDir,
      overwrite: options.overwrite,
      createExamples: options.includeExamples,
      verbose: options.verbose,
    });

    this.agentGenerator = new AgentGenerator(
      {
        outputDir: options.outputDir,
        overwrite: options.overwrite,
        includeExamples: options.includeExamples,
        verbose: options.verbose,
      },
      gateway,
    );

    this.pluginGenerator = new PluginGenerator(
      {
        outputDir: options.outputDir,
        overwrite: options.overwrite,
        includeExamples: options.includeExamples,
        includeTests: options.includeTests,
        verbose: options.verbose,
      },
      gateway,
    );
  }

  /**
   * Generate from pipeline result (skills only)
   */
  async generateFromPipeline(
    result: PipelineResult,
  ): Promise<GenerationResult> {
    return this.skillGenerator.generateFromPipeline(result);
  }

  /**
   * Generate agents from definitions
   */
  async generateAgents(agents: AgentDefinition[]): Promise<GeneratedAgent[]> {
    const results: GeneratedAgent[] = [];

    for (const agent of agents) {
      try {
        const generated = await this.agentGenerator.generateAgent(agent);
        results.push(generated);
      } catch (error) {
        results.push({
          name: agent.name,
          path: "",
          files: [],
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Generate a plugin from definition
   */
  async generatePlugin(definition: PluginDefinition): Promise<GeneratedPlugin> {
    return this.pluginGenerator.generatePlugin(definition);
  }

  /**
   * Generate everything from a combined definition
   */
  async generateAll(definition: {
    skills?: PipelineResult;
    agents?: AgentDefinition[];
    plugin?: PluginDefinition;
  }): Promise<UnifiedGenerationResult> {
    const errors: string[] = [];
    const skills: GeneratedSkill[] = [];
    const agents: GeneratedAgent[] = [];
    const plugins: GeneratedPlugin[] = [];
    let totalFiles = 0;

    // Generate skills
    if (definition.skills) {
      try {
        const skillsResult = await this.generateFromPipeline(definition.skills);
        skills.push(...skillsResult.skills);
        totalFiles += skillsResult.totalFiles;
        errors.push(...skillsResult.errors);
      } catch (error) {
        errors.push(
          `Skills generation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Generate agents
    if (definition.agents?.length) {
      try {
        const agentsResult = await this.generateAgents(definition.agents);
        agents.push(...agentsResult);
        totalFiles += agentsResult.reduce((sum, a) => sum + a.files.length, 0);

        for (const agent of agentsResult) {
          if (!agent.success && agent.error) {
            errors.push(`Agent ${agent.name}: ${agent.error}`);
          }
        }
      } catch (error) {
        errors.push(
          `Agents generation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Generate plugin
    if (definition.plugin) {
      try {
        const pluginResult = await this.generatePlugin(definition.plugin);
        plugins.push(pluginResult);
        totalFiles += pluginResult.files.length;

        if (!pluginResult.success && pluginResult.error) {
          errors.push(`Plugin ${pluginResult.name}: ${pluginResult.error}`);
        }
      } catch (error) {
        errors.push(
          `Plugin generation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      skills,
      agents,
      plugins,
      totalFiles,
      success: errors.length === 0,
      errors,
    };
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create a unified generator
 */
export function createGenerator(
  options: UnifiedGeneratorOptions,
  gateway?: AIGateway,
): UnifiedGenerator {
  return new UnifiedGenerator(options, gateway);
}

/**
 * Quick generation from pipeline result
 */
export async function quickGenerate(
  result: PipelineResult,
  outputDir: string,
): Promise<GenerationResult> {
  const generator = new SkillGenerator({ outputDir });
  return generator.generateFromPipeline(result);
}
