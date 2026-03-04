/**
 * SkillForge Researcher Agent
 *
 * Gathers context, patterns, best practices, and domain knowledge.
 * Uses web search to get up-to-date information when enabled.
 *
 * @module agents/researcher
 */

import { z } from "zod";
import {
  BaseAgent,
  type AgentInput,
  type AgentResult,
  type AgentEventHandlers,
} from "./base.js";
import type { WebSearchResult } from "../gateway/index.js";

// ============================================================================
// SCHEMAS
// ============================================================================

/** Schema for individual research findings */
const ResearchFindingSchema = z.object({
  topic: z.string(),
  summary: z.string(),
  details: z.array(z.string()),
  sources: z.array(z.string()).optional(),
  confidence: z.enum(["high", "medium", "low"]),
});

/** Schema for complete research output */
const ResearchOutputSchema = z.object({
  skillName: z.string(),
  domain: z.string(),

  workflows: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      steps: z.array(z.string()),
      prerequisites: z.array(z.string()),
      outputs: z.array(z.string()),
    }),
  ),

  bestPractices: z.array(
    z.object({
      category: z.string(),
      practice: z.string(),
      rationale: z.string(),
      examples: z.array(z.string()).optional(),
    }),
  ),

  pitfalls: z.array(
    z.object({
      issue: z.string(),
      description: z.string(),
      prevention: z.string(),
      recovery: z.string().optional(),
    }),
  ),

  security: z.array(
    z.object({
      concern: z.string(),
      description: z.string(),
      mitigation: z.string(),
      severity: z.enum(["critical", "high", "medium", "low"]),
    }),
  ),

  glossary: z.array(
    z.object({
      term: z.string(),
      definition: z.string(),
      context: z.string().optional(),
    }),
  ),

  filePatterns: z
    .object({
      structure: z.string().optional(),
      namingConventions: z.array(z.string()).optional(),
      importPatterns: z.array(z.string()).optional(),
    })
    .optional(),

  additionalFindings: z.array(ResearchFindingSchema).optional(),

  webSources: z
    .array(
      z.object({
        title: z.string().optional(),
        url: z.string().optional(),
        snippet: z.string().optional(),
      }),
    )
    .optional(),
});

export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const RESEARCHER_SYSTEM_PROMPT = `You are the SkillForge Researcher, an expert at gathering domain knowledge and best practices.

Your role is to:
1. Research the specified topic/domain thoroughly
2. Identify canonical workflows and procedures
3. Document best practices and patterns
4. Catalog common pitfalls and security concerns
5. Build a glossary of key terminology

When researching:
- Focus on practical, actionable knowledge
- Identify the "right way" to do things
- Note common mistakes developers make
- Consider security implications
- Think about edge cases and failure modes
- Use the most up-to-date information available
- Cite sources when providing specific recommendations

For framework/product-specific research:
- Document file structure conventions
- Note naming patterns
- Identify import/export patterns
- Catalog configuration options
- Check for the latest version requirements
- Note any breaking changes or deprecations

Output comprehensive research that will enable:
- Writing accurate skill procedures
- Creating realistic examples
- Setting appropriate guardrails
- Avoiding common mistakes

Be thorough and precise. Quality research enables quality skills.
When web search results are provided, prioritize that information for current best practices.`;

// ============================================================================
// RESEARCHER AGENT
// ============================================================================

/** Options for creating a researcher agent */
export interface ResearcherOptions {
  /** Model to use (inherits from gateway if not specified) */
  model?: string;
  /** Event handlers for lifecycle events */
  eventHandlers?: AgentEventHandlers;
}

/**
 * Researcher agent that gathers domain knowledge and best practices.
 * Can use web search for up-to-date information.
 */
export class ResearcherAgent extends BaseAgent {
  constructor(options: ResearcherOptions = {}) {
    super(
      {
        name: "researcher",
        description:
          "Gathers context, patterns, and best practices for skill generation",
        model: options.model,
        temperature: 0.3,
        maxTokens: 8192,
        systemPrompt: RESEARCHER_SYSTEM_PROMPT,
        maxIterations: 5,
      },
      options.eventHandlers || {},
    );
  }

  /** Research a specific skill topic */
  async research(
    skillName: string,
    skillDescription: string,
    context?: {
      domain?: string;
      framework?: string;
      language?: string;
      additionalContext?: string;
    },
    options?: {
      useWebSearch?: boolean;
      maxSearchResults?: number;
    },
  ): Promise<ResearchOutput> {
    const useWebSearch = options?.useWebSearch ?? true;

    let webSearchContext = "";
    let webSources: WebSearchResult["sources"] = [];

    if (useWebSearch) {
      try {
        const searchQuery = this.buildSearchQuery(
          skillName,
          skillDescription,
          context,
        );
        const searchResult = await this.callLLMWithWebSearch(searchQuery, {
          maxResults: options?.maxSearchResults ?? 10,
        });

        if (searchResult.sources.length > 0) {
          webSources = searchResult.sources;
          webSearchContext = `

## Current Information from Web Search
${searchResult.text}

### Sources
${searchResult.sources.map((s, i) => `[${i + 1}] ${s.title || "Source"}: ${s.url || "N/A"}`).join("\n")}
`;
        }
      } catch {
        // Web search failed, continue without it
      }
    }

    const prompt = this.buildResearchPrompt(
      skillName,
      skillDescription,
      context,
      webSearchContext,
    );

    const research = await this.callLLMStructured(
      prompt,
      ResearchOutputSchema,
      {
        schemaName: "research_output",
        schemaDescription:
          "Comprehensive research findings for skill generation",
      },
    );

    if (webSources.length > 0) {
      research.webSources = webSources;
    }

    this.setContext(`research:${skillName}`, research);

    return research;
  }

  /** Build a search query for web search */
  private buildSearchQuery(
    skillName: string,
    skillDescription: string,
    context?: {
      domain?: string;
      framework?: string;
      language?: string;
    },
  ): string {
    const parts = [skillName, skillDescription];

    if (context?.framework) {
      parts.push(`${context.framework} best practices`);
    }
    if (context?.language) {
      parts.push(context.language);
    }
    if (context?.domain) {
      parts.push(context.domain);
    }

    return parts.join(" ").slice(0, 200);
  }

  /** Build the research prompt from inputs */
  private buildResearchPrompt(
    skillName: string,
    skillDescription: string,
    context?: {
      domain?: string;
      framework?: string;
      language?: string;
      additionalContext?: string;
    },
    webSearchContext?: string,
  ): string {
    let prompt = `Research the following skill topic thoroughly:

## Skill
Name: ${skillName}
Description: ${skillDescription}
`;

    if (context) {
      prompt += `
## Context
`;
      if (context.domain) prompt += `- Domain: ${context.domain}\n`;
      if (context.framework) prompt += `- Framework: ${context.framework}\n`;
      if (context.language) prompt += `- Language: ${context.language}\n`;
      if (context.additionalContext) {
        prompt += `
## Additional Context
${context.additionalContext}
`;
      }
    }

    if (webSearchContext) {
      prompt += webSearchContext;
    }

    prompt += `
## Research Instructions

1. **Workflows**: Identify the main workflows this skill should cover
   - What are the step-by-step procedures?
   - What prerequisites are needed?
   - What outputs are produced?

2. **Best Practices**: Document established best practices
   - What are the recommended patterns?
   - What conventions should be followed?
   - What makes implementations "good"?

3. **Pitfalls**: Catalog common mistakes and issues
   - What do developers often get wrong?
   - What are the subtle bugs?
   - How can these be prevented?

4. **Security**: Note security considerations
   - What are the security risks?
   - How should sensitive data be handled?
   - What validations are needed?

5. **Glossary**: Define key terminology
   - What terms are specific to this domain?
   - What concepts need explanation?

6. **File Patterns** (if applicable):
   - What file structure is expected?
   - What naming conventions apply?
   - What import patterns are used?

Provide comprehensive, accurate research that will enable creating a high-quality skill.`;

    return prompt;
  }

  /** Execute research (main entry point) */
  async execute(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();
    this.state.iteration++;

    try {
      const {
        skillName,
        skillDescription,
        context,
        useWebSearch,
        maxSearchResults,
      } = input.context as {
        skillName: string;
        skillDescription: string;
        context?: Record<string, string>;
        useWebSearch?: boolean;
        maxSearchResults?: number;
      };

      if (!skillName || !skillDescription) {
        throw new Error("Missing skillName or skillDescription in context");
      }

      const research = await this.research(
        skillName,
        skillDescription,
        context,
        { useWebSearch, maxSearchResults },
      );

      return {
        agentName: this.name,
        success: true,
        output: research,
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

  /** Research from external source content */
  async researchFromSource(
    skillName: string,
    sourceContent: string,
    sourceType: "docs" | "api" | "tutorial" | "readme",
  ): Promise<ResearchOutput> {
    const prompt = `Extract research findings from the following ${sourceType} content.

## Skill
Name: ${skillName}

## Source Content
${sourceContent.slice(0, 50000)} ${sourceContent.length > 50000 ? "... (truncated)" : ""}

## Instructions
Analyze this content and extract:
1. Workflows and procedures documented
2. Best practices mentioned or implied
3. Common pitfalls warned about
4. Security considerations
5. Key terminology

Focus on practical, actionable information for the skill.`;

    return await this.callLLMStructured(prompt, ResearchOutputSchema);
  }
}
