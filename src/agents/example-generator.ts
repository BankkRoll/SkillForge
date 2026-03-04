/**
 * SkillForge Example Generator Agent
 *
 * Creates code examples, templates, and reference files for skills.
 * Generates practical, runnable code that demonstrates skill usage.
 *
 * @module agents/example-generator
 */

import { z } from "zod";
import {
  BaseAgent,
  type AgentInput,
  type AgentResult,
  type AgentEventHandlers,
} from "./base.js";
import type { SkillOutput } from "./skill-writer.js";

// ============================================================================
// SCHEMAS
// ============================================================================

/** Schema for a code example */
const CodeExampleSchema = z.object({
  filename: z.string(),
  language: z.string(),
  description: z.string(),
  code: z.string(),
  inputs: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        example: z.string(),
      }),
    )
    .optional(),
  expectedOutput: z.string().optional(),
  notes: z.array(z.string()).optional(),
});

/** Schema for reference documentation */
const ReferenceDocSchema = z.object({
  filename: z.string(),
  title: z.string(),
  content: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      content: z.string(),
    }),
  ),
});

/** Schema for complete examples output */
const ExamplesOutputSchema = z.object({
  skillName: z.string(),
  codeExamples: z.array(CodeExampleSchema),
  templates: z.array(
    z.object({
      filename: z.string(),
      description: z.string(),
      content: z.string(),
      variables: z
        .array(
          z.object({
            name: z.string(),
            description: z.string(),
            defaultValue: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
  references: z.array(ReferenceDocSchema).optional(),
  scripts: z
    .array(
      z.object({
        filename: z.string(),
        description: z.string(),
        language: z.enum(["bash", "python", "typescript", "javascript"]),
        content: z.string(),
        usage: z.string(),
      }),
    )
    .optional(),
});

export type CodeExample = z.infer<typeof CodeExampleSchema>;
export type ExamplesOutput = z.infer<typeof ExamplesOutputSchema>;

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const EXAMPLE_GENERATOR_SYSTEM_PROMPT = `You are the SkillForge Example Generator, an expert at creating practical code examples.

Your role is to:
1. Create realistic, runnable code examples
2. Build useful templates for common patterns
3. Write helper scripts when appropriate
4. Document examples thoroughly

When creating examples:
- Make them complete and runnable
- Use realistic variable names and data
- Include necessary imports and setup
- Add comments explaining key parts
- Handle edge cases and errors
- Follow language conventions and best practices

Types of artifacts:
1. **Code Examples**: Complete, demonstrative snippets
2. **Templates**: Parameterized starting points
3. **Reference Docs**: Quick-reference information
4. **Helper Scripts**: Automation utilities

Quality standards:
- Examples should work out of the box
- Templates should need minimal modification
- Scripts should be self-documenting
- All code should follow security best practices

Create examples that accelerate developer success.`;

// ============================================================================
// EXAMPLE GENERATOR AGENT
// ============================================================================

/** Options for creating an example generator agent */
export interface ExampleGeneratorOptions {
  /** Model to use (inherits from gateway if not specified) */
  model?: string;
  /** Event handlers for lifecycle events */
  eventHandlers?: AgentEventHandlers;
}

/**
 * Example generator agent that creates code examples and templates.
 * Produces runnable code that demonstrates skill usage.
 */
export class ExampleGeneratorAgent extends BaseAgent {
  constructor(options: ExampleGeneratorOptions = {}) {
    super(
      {
        name: "example-generator",
        description: "Creates code examples, templates, and reference files",
        model: options.model,
        temperature: 0.3,
        maxTokens: 8192,
        systemPrompt: EXAMPLE_GENERATOR_SYSTEM_PROMPT,
        maxIterations: 3,
      },
      options.eventHandlers || {},
    );
  }

  /** Generate examples for a skill */
  async generateExamples(
    skill: SkillOutput,
    options?: {
      language?: string;
      framework?: string;
      includeScripts?: boolean;
      includeReferences?: boolean;
      exampleCount?: number;
    },
  ): Promise<ExamplesOutput> {
    const prompt = this.buildExamplesPrompt(skill, options);

    const examples = await this.callLLMStructured(
      prompt,
      ExamplesOutputSchema,
      {
        schemaName: "examples_output",
        schemaDescription: "Code examples and templates for a skill",
      },
    );

    this.setContext(`examples:${skill.frontmatter.name}`, examples);

    return examples;
  }

  /** Build the examples prompt from inputs */
  private buildExamplesPrompt(
    skill: SkillOutput,
    options?: {
      language?: string;
      framework?: string;
      includeScripts?: boolean;
      includeReferences?: boolean;
      exampleCount?: number;
    },
  ): string {
    const exampleCount = options?.exampleCount || 3;

    return `Create examples and templates for this skill.

## Skill Definition
Name: ${skill.frontmatter.name}
Description: ${skill.frontmatter.description}

### Procedure Steps
${skill.sections.procedure.map((p) => `${p.step}. ${p.title}: ${p.description}`).join("\n")}

### Constraints
${skill.sections.constraints.join("\n")}

${options?.language ? `## Target Language: ${options.language}` : ""}
${options?.framework ? `## Framework: ${options.framework}` : ""}

## Generation Instructions

### 1. Code Examples (create ${exampleCount})
For each major workflow in the skill:
- Create a complete, runnable example
- Include all necessary imports
- Use realistic data and variable names
- Add inline comments explaining key steps
- Handle errors appropriately
- Show expected outputs

### 2. Templates (create 1-2)
Create reusable templates that developers can customize:
- Mark customization points with comments
- Include placeholder values
- Document required vs optional sections
- List variables that need replacement

${
  options?.includeScripts
    ? `
### 3. Helper Scripts
Create utility scripts for:
- Setup/initialization
- Validation/testing
- Common operations
Make scripts:
- Self-documenting
- Handle errors gracefully
- Include usage instructions
`
    : ""
}

${
  options?.includeReferences
    ? `
### 4. Reference Documentation
Create quick-reference docs covering:
- API methods/endpoints
- Configuration options
- Common patterns
`
    : ""
}

Create practical, high-quality examples that help developers succeed quickly.`;
  }

  /** Execute example generation (main entry point) */
  async execute(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();
    this.state.iteration++;

    try {
      const { skill, options } = input.context as {
        skill: SkillOutput;
        options?: {
          language?: string;
          framework?: string;
          includeScripts?: boolean;
          includeReferences?: boolean;
          exampleCount?: number;
        };
      };

      if (!skill) {
        throw new Error("Missing skill in context");
      }

      const examples = await this.generateExamples(skill, options);

      return {
        agentName: this.name,
        success: true,
        output: examples,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: this.state.totalTokens,
        },
        iterations: this.state.iteration,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      throw error;
    }
  }

  /** Generate a specific type of example */
  async generateSingleExample(
    skill: SkillOutput,
    exampleType: "happy-path" | "error-handling" | "edge-case" | "advanced",
    language: string,
  ): Promise<CodeExample> {
    const prompt = `Create a ${exampleType} example for this skill.

## Skill
Name: ${skill.frontmatter.name}
Description: ${skill.frontmatter.description}

## Example Type: ${exampleType}
${exampleType === "happy-path" ? "Show the ideal, successful workflow" : ""}
${exampleType === "error-handling" ? "Show how to handle common errors" : ""}
${exampleType === "edge-case" ? "Show handling of unusual but valid inputs" : ""}
${exampleType === "advanced" ? "Show complex usage with multiple features" : ""}

## Language: ${language}

Create a complete, runnable example with:
- All necessary imports
- Realistic data
- Proper error handling
- Inline comments
- Expected output`;

    return await this.callLLMStructured(prompt, CodeExampleSchema);
  }
}
