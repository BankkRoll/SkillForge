/**
 * SkillForge Skill Writer Agent
 *
 * Creates SKILL.md files with procedures, guardrails, and structure.
 * Transforms research output into actionable skill definitions.
 *
 * @module agents/skill-writer
 */

import { z } from "zod";
import {
  BaseAgent,
  type AgentInput,
  type AgentResult,
  type AgentEventHandlers,
} from "./base.js";
import type { ResearchOutput } from "./researcher.js";
import { SkillFrontmatterSchema } from "../schemas/index.js";

// ============================================================================
// SCHEMAS
// ============================================================================

/** Schema for complete skill output */
const SkillOutputSchema = z.object({
  frontmatter: SkillFrontmatterSchema,
  sections: z.object({
    title: z.string(),
    whenToUse: z.array(z.string()),
    whenNotToUse: z.array(z.string()),
    prerequisites: z.array(z.string()).optional(),
    procedure: z.array(
      z.object({
        step: z.number(),
        title: z.string(),
        description: z.string(),
        code: z.string().optional(),
        notes: z.array(z.string()).optional(),
      }),
    ),
    constraints: z.array(z.string()),
    guardrails: z.array(z.string()),
    outputFormat: z.object({
      description: z.string(),
      sections: z.array(z.string()),
    }),
    troubleshooting: z
      .array(
        z.object({
          issue: z.string(),
          solution: z.string(),
        }),
      )
      .optional(),
  }),
  resources: z
    .array(
      z.object({
        type: z.enum(["script", "reference", "example", "asset"]),
        filename: z.string(),
        description: z.string(),
        content: z.string().optional(),
      }),
    )
    .optional(),
});

export type SkillOutput = z.infer<typeof SkillOutputSchema>;

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SKILL_WRITER_SYSTEM_PROMPT = `You are the SkillForge Skill Writer, an expert at creating comprehensive AI skill definitions.

Your role is to:
1. Transform research into actionable skill procedures
2. Write clear, step-by-step instructions
3. Define constraints and guardrails
4. Structure output expectations
5. Create supporting resources

When writing skills:
- Use imperative voice ("Do this", "Check that")
- Be specific and unambiguous
- Include code snippets where helpful
- Add warnings for dangerous operations
- Set clear boundaries

Skill structure:
1. **When to use**: Clear triggers for skill activation
2. **When NOT to use**: Explicit boundaries
3. **Procedure**: Numbered steps with details
4. **Constraints**: Hard rules (NEVER do X)
5. **Guardrails**: Soft guidance (prefer Y over Z)
6. **Output format**: What the skill produces

Write skills that an AI agent can follow precisely and consistently.
Avoid vague instructions. Every step should be actionable.`;

// ============================================================================
// SKILL WRITER AGENT
// ============================================================================

/** Options for creating a skill writer agent */
export interface SkillWriterOptions {
  /** Model to use (inherits from gateway if not specified) */
  model?: string;
  /** Event handlers for lifecycle events */
  eventHandlers?: AgentEventHandlers;
}

/**
 * Skill writer agent that creates SKILL.md files.
 * Transforms research into complete skill definitions.
 */
export class SkillWriterAgent extends BaseAgent {
  constructor(options: SkillWriterOptions = {}) {
    super(
      {
        name: "skill-writer",
        description: "Creates SKILL.md files with procedures and guardrails",
        model: options.model,
        temperature: 0.4,
        maxTokens: 8192,
        systemPrompt: SKILL_WRITER_SYSTEM_PROMPT,
        maxIterations: 3,
      },
      options.eventHandlers || {},
    );
  }

  /** Write a skill from research output */
  async writeSkill(
    skillName: string,
    skillDescription: string,
    research: ResearchOutput,
    options?: {
      tools?: string[];
      model?: string;
      disableModelInvocation?: boolean;
    },
  ): Promise<SkillOutput> {
    const prompt = this.buildWritingPrompt(
      skillName,
      skillDescription,
      research,
      options,
    );

    const skill = await this.callLLMStructured(prompt, SkillOutputSchema, {
      schemaName: "skill_output",
      schemaDescription:
        "A complete skill definition ready to be written as SKILL.md",
    });

    this.setContext(`skill:${skillName}`, skill);

    return skill;
  }

  /** Build the writing prompt from inputs */
  private buildWritingPrompt(
    skillName: string,
    skillDescription: string,
    research: ResearchOutput,
    options?: {
      tools?: string[];
      model?: string;
      disableModelInvocation?: boolean;
    },
  ): string {
    return `Write a complete skill definition based on the research.

## Skill Information
Name: ${skillName}
Description: ${skillDescription}

## Research Findings

### Workflows
${research.workflows
  .map(
    (w) => `
**${w.name}**: ${w.description}
Steps: ${w.steps.join(" → ")}
Prerequisites: ${w.prerequisites.join(", ") || "None"}
`,
  )
  .join("\n")}

### Best Practices
${research.bestPractices
  .map(
    (bp) => `
- **${bp.category}**: ${bp.practice}
  Rationale: ${bp.rationale}
`,
  )
  .join("\n")}

### Pitfalls to Avoid
${research.pitfalls
  .map(
    (p) => `
- **${p.issue}**: ${p.description}
  Prevention: ${p.prevention}
`,
  )
  .join("\n")}

### Security Considerations
${research.security
  .map(
    (s) => `
- **[${s.severity.toUpperCase()}] ${s.concern}**: ${s.description}
  Mitigation: ${s.mitigation}
`,
  )
  .join("\n")}

### Terminology
${research.glossary.map((g) => `- **${g.term}**: ${g.definition}`).join("\n")}

${
  options?.tools
    ? `
## Allowed Tools
${options.tools.join(", ")}
`
    : ""
}

## Writing Instructions

1. **Frontmatter**: Create YAML frontmatter with:
   - name: ${skillName}
   - description: Concise but complete
   ${options?.tools ? `- allowed-tools: ${options.tools.join(", ")}` : ""}
   ${options?.model ? `- model: ${options.model}` : ""}
   ${options?.disableModelInvocation ? "- disable-model-invocation: true" : ""}

2. **When to Use**: List 3-5 clear scenarios
   - Be specific about triggers
   - Include keywords the user might say

3. **When NOT to Use**: List boundaries
   - What's out of scope
   - When other skills apply

4. **Procedure**: Write detailed steps
   - Number each step
   - Include substeps if complex
   - Add code snippets where helpful
   - Note potential issues at each step

5. **Constraints**: List hard rules
   - Use "NEVER" for critical restrictions
   - Use "ALWAYS" for mandatory actions
   - Focus on security and correctness

6. **Guardrails**: List soft guidance
   - Use "prefer" for recommendations
   - Use "avoid" for discouraged patterns
   - Include performance considerations

7. **Output Format**: Define expected outputs
   - What sections to include
   - How to format results
   - What information to provide

Write a comprehensive skill that leaves no ambiguity.`;
  }

  /** Convert skill output to SKILL.md content */
  skillToMarkdown(skill: SkillOutput): string {
    const { frontmatter, sections, resources } = skill;

    const yamlLines = ["---"];
    yamlLines.push(`name: ${frontmatter.name}`);
    yamlLines.push(`description: ${frontmatter.description}`);

    if (frontmatter["argument-hint"]) {
      yamlLines.push(`argument-hint: "${frontmatter["argument-hint"]}"`);
    }
    if (frontmatter["disable-model-invocation"]) {
      yamlLines.push("disable-model-invocation: true");
    }
    if (frontmatter["user-invocable"] === false) {
      yamlLines.push("user-invocable: false");
    }
    if (frontmatter["allowed-tools"]) {
      yamlLines.push(`allowed-tools: ${frontmatter["allowed-tools"]}`);
    }
    if (frontmatter.model) {
      yamlLines.push(`model: ${frontmatter.model}`);
    }
    if (frontmatter.context) {
      yamlLines.push(`context: ${frontmatter.context}`);
    }
    if (frontmatter.agent) {
      yamlLines.push(`agent: ${frontmatter.agent}`);
    }
    if (frontmatter.version) {
      yamlLines.push(`version: ${frontmatter.version}`);
    }
    if (frontmatter.tags?.length) {
      yamlLines.push(`tags: [${frontmatter.tags.join(", ")}]`);
    }

    yamlLines.push("---");

    const mdLines: string[] = [];

    mdLines.push(`# ${sections.title}`);
    mdLines.push("");

    mdLines.push("## When to use this skill");
    sections.whenToUse.forEach((item) => mdLines.push(`- ${item}`));
    mdLines.push("");

    mdLines.push("## When NOT to use this skill");
    sections.whenNotToUse.forEach((item) => mdLines.push(`- ${item}`));
    mdLines.push("");

    if (sections.prerequisites?.length) {
      mdLines.push("## Prerequisites");
      sections.prerequisites.forEach((item) => mdLines.push(`- ${item}`));
      mdLines.push("");
    }

    mdLines.push("## Procedure");
    sections.procedure.forEach((step) => {
      mdLines.push(`### ${step.step}. ${step.title}`);
      mdLines.push(step.description);
      if (step.code) {
        mdLines.push("");
        mdLines.push("```");
        mdLines.push(step.code);
        mdLines.push("```");
      }
      if (step.notes?.length) {
        mdLines.push("");
        step.notes.forEach((note) => mdLines.push(`> ${note}`));
      }
      mdLines.push("");
    });

    mdLines.push("## Constraints");
    sections.constraints.forEach((item) => mdLines.push(`- ${item}`));
    mdLines.push("");

    mdLines.push("## Guardrails");
    sections.guardrails.forEach((item) => mdLines.push(`- ${item}`));
    mdLines.push("");

    mdLines.push("## Output expectations");
    mdLines.push(sections.outputFormat.description);
    mdLines.push("");
    mdLines.push("Include these sections:");
    sections.outputFormat.sections.forEach((s) => mdLines.push(`- ${s}`));
    mdLines.push("");

    if (sections.troubleshooting?.length) {
      mdLines.push("## Troubleshooting");
      sections.troubleshooting.forEach((t) => {
        mdLines.push(`### ${t.issue}`);
        mdLines.push(t.solution);
        mdLines.push("");
      });
    }

    if (resources?.length) {
      mdLines.push("## Included resources");
      resources.forEach((r) => {
        mdLines.push(
          `- ${r.type}: ./${r.type}s/${r.filename} - ${r.description}`,
        );
      });
      mdLines.push("");
    }

    return yamlLines.join("\n") + "\n\n" + mdLines.join("\n");
  }

  /** Execute skill writing (main entry point) */
  async execute(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();
    this.state.iteration++;

    try {
      const { skillName, skillDescription, research, options } =
        input.context as {
          skillName: string;
          skillDescription: string;
          research: ResearchOutput;
          options?: {
            tools?: string[];
            model?: string;
            disableModelInvocation?: boolean;
          };
        };

      if (!skillName || !skillDescription || !research) {
        throw new Error(
          "Missing required context: skillName, skillDescription, research",
        );
      }

      const skill = await this.writeSkill(
        skillName,
        skillDescription,
        research,
        options,
      );

      return {
        agentName: this.name,
        success: true,
        output: {
          skill,
          markdown: this.skillToMarkdown(skill),
        },
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

  /** Refine a skill based on QA feedback */
  async refineSkill(
    skill: SkillOutput,
    feedback: string,
  ): Promise<SkillOutput> {
    const prompt = `Refine this skill based on feedback.

## Current Skill
${JSON.stringify(skill, null, 2)}

## Feedback
${feedback}

## Instructions
Update the skill to address the feedback while maintaining:
- Clear procedures
- Appropriate constraints
- Consistent structure

Output the refined skill.`;

    return await this.callLLMStructured(prompt, SkillOutputSchema);
  }
}
