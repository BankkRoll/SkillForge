/**
 * SkillForge Agent Generator
 * Creates agent.md files and folder structures
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { z } from "zod";
import type { AIGateway } from "../gateway/index.js";

// ============================================================================
// TYPES
// ============================================================================

export interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
  skills?: string[];
  systemPrompt: string;
  capabilities: string[];
  constraints: string[];
  communication: {
    style: string;
    tone: string;
    guidelines: string[];
  };
  workflow?: {
    steps: Array<{
      name: string;
      description: string;
      toolsUsed?: string[];
    }>;
    errorHandling?: string[];
  };
  examples?: Array<{
    input: string;
    output: string;
    explanation?: string;
  }>;
  metadata?: {
    version?: string;
    author?: string;
    tags?: string[];
    category?: string;
  };
}

export interface AgentGeneratorOptions {
  outputDir: string;
  overwrite?: boolean;
  includeExamples?: boolean;
  includeResources?: boolean;
  verbose?: boolean;
}

export interface GeneratedAgent {
  name: string;
  path: string;
  files: string[];
  success: boolean;
  error?: string;
}

// ============================================================================
// AGENT SCHEMA FOR LLM OUTPUT
// ============================================================================

const AgentOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().optional(),
  tools: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  systemPrompt: z.string(),
  capabilities: z.array(z.string()),
  constraints: z.array(z.string()),
  communication: z.object({
    style: z.string(),
    tone: z.string(),
    guidelines: z.array(z.string()),
  }),
  workflow: z
    .object({
      steps: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          toolsUsed: z.array(z.string()).optional(),
        }),
      ),
      errorHandling: z.array(z.string()).optional(),
    })
    .optional(),
  examples: z
    .array(
      z.object({
        input: z.string(),
        output: z.string(),
        explanation: z.string().optional(),
      }),
    )
    .optional(),
  metadata: z
    .object({
      version: z.string().optional(),
      author: z.string().optional(),
      tags: z.array(z.string()).optional(),
      category: z.string().optional(),
    })
    .optional(),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;

// ============================================================================
// AGENT GENERATOR
// ============================================================================

export class AgentGenerator {
  private options: Required<AgentGeneratorOptions>;
  private gateway?: AIGateway;

  constructor(options: AgentGeneratorOptions, gateway?: AIGateway) {
    this.options = {
      outputDir: options.outputDir,
      overwrite: options.overwrite ?? false,
      includeExamples: options.includeExamples ?? true,
      includeResources: options.includeResources ?? true,
      verbose: options.verbose ?? false,
    };
    this.gateway = gateway;
  }

  /**
   * Generate an agent from a prompt using AI
   */
  async generateFromPrompt(
    prompt: string,
    context?: {
      domain?: string;
      framework?: string;
      existingTools?: string[];
      existingSkills?: string[];
    },
  ): Promise<GeneratedAgent> {
    if (!this.gateway) {
      throw new Error("AI Gateway required for prompt-based generation");
    }

    // Build the generation prompt
    const generationPrompt = this.buildGenerationPrompt(prompt, context);

    // Generate agent definition using structured output
    const result = await this.gateway.generateStructured(
      generationPrompt,
      AgentOutputSchema,
      {
        systemPrompt: AGENT_GENERATION_SYSTEM_PROMPT,
        temperature: 0.4,
      },
    );

    // Generate the agent files
    return this.generateAgent(result.object);
  }

  /**
   * Generate an agent from a definition
   */
  async generateAgent(definition: AgentDefinition): Promise<GeneratedAgent> {
    const agentName = this.sanitizeName(definition.name);
    const agentDir = join(this.options.outputDir, agentName);
    const files: string[] = [];

    // Check if directory exists
    if (existsSync(agentDir) && !this.options.overwrite) {
      throw new Error(`Agent directory already exists: ${agentDir}`);
    }

    // Create agent directory
    await mkdir(agentDir, { recursive: true });

    // Write agent.md
    const agentMd = this.definitionToMarkdown(definition);
    const agentMdPath = join(agentDir, "agent.md");
    await writeFile(agentMdPath, agentMd, "utf-8");
    files.push("agent.md");

    // Create examples if provided
    if (this.options.includeExamples && definition.examples?.length) {
      const examplesDir = join(agentDir, "examples");
      await mkdir(examplesDir, { recursive: true });

      for (let i = 0; i < definition.examples.length; i++) {
        const example = definition.examples[i];
        const exampleContent = this.formatExample(example, i + 1);
        const examplePath = join(examplesDir, `example-${i + 1}.md`);
        await writeFile(examplePath, exampleContent, "utf-8");
        files.push(`examples/example-${i + 1}.md`);
      }
    }

    // Create resources directory with system prompt
    if (this.options.includeResources) {
      const resourcesDir = join(agentDir, "resources");
      await mkdir(resourcesDir, { recursive: true });

      // System prompt as separate file for easy editing
      const systemPromptPath = join(resourcesDir, "system-prompt.md");
      await writeFile(systemPromptPath, definition.systemPrompt, "utf-8");
      files.push("resources/system-prompt.md");

      // Workflow documentation if present
      if (definition.workflow) {
        const workflowContent = this.formatWorkflow(definition.workflow);
        const workflowPath = join(resourcesDir, "workflow.md");
        await writeFile(workflowPath, workflowContent, "utf-8");
        files.push("resources/workflow.md");
      }
    }

    // Create README.md
    const readmePath = join(agentDir, "README.md");
    const readme = this.generateReadme(definition);
    await writeFile(readmePath, readme, "utf-8");
    files.push("README.md");

    if (this.options.verbose) {
      console.log(
        `Generated agent: ${definition.name} (${files.length} files)`,
      );
    }

    return {
      name: definition.name,
      path: agentDir,
      files,
      success: true,
    };
  }

  /**
   * Build prompt for AI agent generation
   */
  private buildGenerationPrompt(
    prompt: string,
    context?: {
      domain?: string;
      framework?: string;
      existingTools?: string[];
      existingSkills?: string[];
    },
  ): string {
    let fullPrompt = `Create a comprehensive agent definition for the following request:

## Request
${prompt}
`;

    if (context) {
      fullPrompt += `
## Context
`;
      if (context.domain) fullPrompt += `- Domain: ${context.domain}\n`;
      if (context.framework)
        fullPrompt += `- Framework: ${context.framework}\n`;
      if (context.existingTools?.length) {
        fullPrompt += `- Available Tools: ${context.existingTools.join(", ")}\n`;
      }
      if (context.existingSkills?.length) {
        fullPrompt += `- Available Skills: ${context.existingSkills.join(", ")}\n`;
      }
    }

    fullPrompt += `
## Instructions
Create a complete agent definition with:
1. Clear name and description
2. Comprehensive system prompt
3. List of capabilities (what it CAN do)
4. List of constraints (what it should NOT do)
5. Communication style and guidelines
6. Workflow steps if applicable
7. Example interactions

Make the agent focused, capable, and well-defined.`;

    return fullPrompt;
  }

  /**
   * Convert agent definition to agent.md markdown
   */
  definitionToMarkdown(definition: AgentDefinition): string {
    const lines: string[] = [];

    // YAML frontmatter
    lines.push("---");
    lines.push(`name: ${definition.name}`);
    lines.push(`description: ${definition.description}`);

    if (definition.model) {
      lines.push(`model: ${definition.model}`);
    }
    if (definition.temperature !== undefined) {
      lines.push(`temperature: ${definition.temperature}`);
    }
    if (definition.maxTokens) {
      lines.push(`max-tokens: ${definition.maxTokens}`);
    }
    if (definition.tools?.length) {
      lines.push(`tools: [${definition.tools.join(", ")}]`);
    }
    if (definition.skills?.length) {
      lines.push(`skills: [${definition.skills.join(", ")}]`);
    }
    if (definition.metadata?.version) {
      lines.push(`version: ${definition.metadata.version}`);
    }
    if (definition.metadata?.tags?.length) {
      lines.push(`tags: [${definition.metadata.tags.join(", ")}]`);
    }
    if (definition.metadata?.category) {
      lines.push(`category: ${definition.metadata.category}`);
    }

    lines.push("---");
    lines.push("");

    // Title
    lines.push(`# ${definition.name}`);
    lines.push("");
    lines.push(definition.description);
    lines.push("");

    // System Prompt
    lines.push("## System Prompt");
    lines.push("");
    lines.push(definition.systemPrompt);
    lines.push("");

    // Capabilities
    lines.push("## Capabilities");
    lines.push("");
    for (const capability of definition.capabilities) {
      lines.push(`- ${capability}`);
    }
    lines.push("");

    // Constraints
    lines.push("## Constraints");
    lines.push("");
    for (const constraint of definition.constraints) {
      lines.push(`- ${constraint}`);
    }
    lines.push("");

    // Communication
    lines.push("## Communication");
    lines.push("");
    lines.push(`**Style:** ${definition.communication.style}`);
    lines.push("");
    lines.push(`**Tone:** ${definition.communication.tone}`);
    lines.push("");
    lines.push("### Guidelines");
    lines.push("");
    for (const guideline of definition.communication.guidelines) {
      lines.push(`- ${guideline}`);
    }
    lines.push("");

    // Workflow
    if (definition.workflow) {
      lines.push("## Workflow");
      lines.push("");
      for (const step of definition.workflow.steps) {
        lines.push(`### ${step.name}`);
        lines.push("");
        lines.push(step.description);
        if (step.toolsUsed?.length) {
          lines.push("");
          lines.push(`**Tools:** ${step.toolsUsed.join(", ")}`);
        }
        lines.push("");
      }

      if (definition.workflow.errorHandling?.length) {
        lines.push("### Error Handling");
        lines.push("");
        for (const handling of definition.workflow.errorHandling) {
          lines.push(`- ${handling}`);
        }
        lines.push("");
      }
    }

    // Examples
    if (definition.examples?.length) {
      lines.push("## Examples");
      lines.push("");
      for (let i = 0; i < definition.examples.length; i++) {
        const example = definition.examples[i];
        lines.push(`### Example ${i + 1}`);
        lines.push("");
        lines.push("**Input:**");
        lines.push("```");
        lines.push(example.input);
        lines.push("```");
        lines.push("");
        lines.push("**Output:**");
        lines.push("```");
        lines.push(example.output);
        lines.push("```");
        if (example.explanation) {
          lines.push("");
          lines.push(`*${example.explanation}*`);
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  /**
   * Format a single example as markdown
   */
  private formatExample(
    example: { input: string; output: string; explanation?: string },
    index: number,
  ): string {
    const lines: string[] = [];

    lines.push(`# Example ${index}`);
    lines.push("");
    lines.push("## Input");
    lines.push("");
    lines.push("```");
    lines.push(example.input);
    lines.push("```");
    lines.push("");
    lines.push("## Output");
    lines.push("");
    lines.push("```");
    lines.push(example.output);
    lines.push("```");

    if (example.explanation) {
      lines.push("");
      lines.push("## Explanation");
      lines.push("");
      lines.push(example.explanation);
    }

    return lines.join("\n");
  }

  /**
   * Format workflow as markdown
   */
  private formatWorkflow(
    workflow: NonNullable<AgentDefinition["workflow"]>,
  ): string {
    const lines: string[] = [];

    lines.push("# Agent Workflow");
    lines.push("");
    lines.push(
      "This document describes the step-by-step workflow this agent follows.",
    );
    lines.push("");

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      lines.push(`## Step ${i + 1}: ${step.name}`);
      lines.push("");
      lines.push(step.description);

      if (step.toolsUsed?.length) {
        lines.push("");
        lines.push("### Tools Used");
        lines.push("");
        for (const tool of step.toolsUsed) {
          lines.push(`- ${tool}`);
        }
      }
      lines.push("");
    }

    if (workflow.errorHandling?.length) {
      lines.push("## Error Handling");
      lines.push("");
      for (const handling of workflow.errorHandling) {
        lines.push(`- ${handling}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Generate README.md for an agent
   */
  private generateReadme(definition: AgentDefinition): string {
    const lines: string[] = [];

    lines.push(`# ${definition.name}`);
    lines.push("");
    lines.push(definition.description);
    lines.push("");

    // Metadata
    if (definition.metadata?.tags?.length) {
      lines.push(`**Tags:** ${definition.metadata.tags.join(", ")}`);
      lines.push("");
    }
    if (definition.metadata?.version) {
      lines.push(`**Version:** ${definition.metadata.version}`);
      lines.push("");
    }

    // Quick info
    lines.push("## Quick Info");
    lines.push("");
    if (definition.model) {
      lines.push(`- **Model:** ${definition.model}`);
    }
    if (definition.tools?.length) {
      lines.push(`- **Tools:** ${definition.tools.join(", ")}`);
    }
    if (definition.skills?.length) {
      lines.push(`- **Skills:** ${definition.skills.join(", ")}`);
    }
    lines.push("");

    // Capabilities summary
    lines.push("## What This Agent Does");
    lines.push("");
    for (const cap of definition.capabilities.slice(0, 5)) {
      lines.push(`- ${cap}`);
    }
    if (definition.capabilities.length > 5) {
      lines.push(`- ...and ${definition.capabilities.length - 5} more`);
    }
    lines.push("");

    // Files
    lines.push("## Files");
    lines.push("");
    lines.push("- `agent.md` - Main agent definition");
    lines.push("- `resources/system-prompt.md` - System prompt (editable)");
    if (definition.workflow) {
      lines.push("- `resources/workflow.md` - Workflow documentation");
    }
    if (definition.examples?.length) {
      lines.push(
        `- \`examples/\` - ${definition.examples.length} example interactions`,
      );
    }
    lines.push("");

    lines.push("---");
    lines.push("*Generated by SkillForge*");

    return lines.join("\n");
  }

  /**
   * Sanitize agent name for filesystem
   */
  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }
}

// ============================================================================
// SYSTEM PROMPT FOR AGENT GENERATION
// ============================================================================

const AGENT_GENERATION_SYSTEM_PROMPT = `You are an expert at designing AI agents. Your task is to create comprehensive agent definitions.

When creating an agent:
1. Give it a clear, descriptive name
2. Write a detailed system prompt that fully defines its behavior
3. List specific capabilities (what it CAN do)
4. Define constraints (what it should NOT do)
5. Specify communication style and tone
6. Design a logical workflow if the agent follows steps
7. Create realistic example interactions

Best practices:
- Be specific and actionable
- Avoid vague instructions
- Include edge case handling
- Consider security implications
- Make the agent focused on its purpose

Output a complete, well-structured agent definition.`;

// ============================================================================
// STANDALONE FUNCTIONS
// ============================================================================

/**
 * Generate an agent from a prompt
 */
export async function generateAgentFromPrompt(
  prompt: string,
  gateway: AIGateway,
  options: AgentGeneratorOptions,
  context?: {
    domain?: string;
    framework?: string;
    existingTools?: string[];
    existingSkills?: string[];
  },
): Promise<GeneratedAgent> {
  const generator = new AgentGenerator(options, gateway);
  return generator.generateFromPrompt(prompt, context);
}

/**
 * Generate an agent from a definition
 */
export async function generateAgent(
  definition: AgentDefinition,
  options: AgentGeneratorOptions,
): Promise<GeneratedAgent> {
  const generator = new AgentGenerator(options);
  return generator.generateAgent(definition);
}
