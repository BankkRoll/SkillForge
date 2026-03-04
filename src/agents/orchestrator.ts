/**
 * SkillForge Orchestrator Agent
 *
 * Coordinates the multi-agent pipeline for skill generation.
 * Analyzes requests, creates execution plans, and manages task flow.
 *
 * @module agents/orchestrator
 */

import { z } from "zod";
import {
  BaseAgent,
  type AgentInput,
  type AgentResult,
  type AgentEventHandlers,
} from "./base.js";
import type { SkillGenerationRequest } from "../schemas/index.js";

// ============================================================================
// SCHEMAS
// ============================================================================

/** Schema for a task in the execution plan */
const TaskSchema = z.object({
  id: z.string(),
  type: z.enum(["research", "write", "example", "review", "refine"]),
  description: z.string(),
  agentName: z.string(),
  dependencies: z.array(z.string()),
  priority: z.enum(["high", "medium", "low"]),
  estimatedComplexity: z.enum(["simple", "moderate", "complex"]),
});

/** Schema for the full execution plan */
const PlanSchema = z.object({
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      scope: z.string(),
    }),
  ),
  tasks: z.array(TaskSchema),
  totalEstimatedSteps: z.number(),
  reasoning: z.string(),
});

export type Task = z.infer<typeof TaskSchema>;
export type Plan = z.infer<typeof PlanSchema>;

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const ORCHESTRATOR_SYSTEM_PROMPT = `You are the SkillForge Orchestrator, a master planner for AI skill generation.

Your role is to:
1. Analyze user requests and break them into specific skills
2. Create a detailed execution plan with tasks
3. Assign tasks to specialized agents
4. Ensure skills are focused and well-scoped

When decomposing a request:
- Split broad topics into 3-8 focused skills
- Each skill should handle ONE specific workflow or capability
- Skills should be independent but complementary
- Consider the target framework, language, and domain

Available agents:
- researcher: Gathers context, patterns, best practices
- skill-writer: Creates SKILL.md with procedures and guardrails
- example-generator: Creates code examples and templates
- qa: Reviews quality, completeness, security concerns

Output a structured plan with:
- List of skills to generate
- Tasks with dependencies
- Priority ordering

Be thorough but practical. A good skill is better than many mediocre ones.`;

// ============================================================================
// ORCHESTRATOR AGENT
// ============================================================================

/** Options for creating an orchestrator */
export interface OrchestratorOptions {
  /** Model to use (inherits from gateway if not specified) */
  model?: string;
  /** Event handlers for lifecycle events */
  eventHandlers?: AgentEventHandlers;
}

/**
 * Orchestrator agent that coordinates the skill generation pipeline.
 * Creates execution plans and manages the flow between specialized agents.
 */
export class OrchestratorAgent extends BaseAgent {
  constructor(options: OrchestratorOptions = {}) {
    super(
      {
        name: "orchestrator",
        description: "Coordinates the multi-agent skill generation pipeline",
        model: options.model, // Uses gateway default if not specified
        temperature: 0.3,
        maxTokens: 4096,
        systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
        maxIterations: 3,
      },
      options.eventHandlers || {},
    );
  }

  /** Create execution plan from user request */
  async createPlan(request: SkillGenerationRequest): Promise<Plan> {
    const prompt = this.buildPlanningPrompt(request);

    const plan = await this.callLLMStructured(prompt, PlanSchema, {
      schemaName: "execution_plan",
      schemaDescription: "A detailed plan for generating skills",
    });

    return plan;
  }

  /** Build the planning prompt from request */
  private buildPlanningPrompt(request: SkillGenerationRequest): string {
    let prompt = `Create an execution plan for the following skill generation request:

## User Request
${request.prompt}
`;

    if (request.target) {
      prompt += `
## Target Environment
- Domain: ${request.target.domain || "general"}
- Product/Service: ${request.target.product || "any"}
- Framework: ${request.target.framework || "any"}
- Runtime: ${request.target.runtime || "any"}
- Language: ${request.target.language || "any"}
`;
    }

    if (request.scope) {
      if (request.scope.include?.length) {
        prompt += `
## Must Include
${request.scope.include.map((s) => `- ${s}`).join("\n")}
`;
      }
      if (request.scope.exclude?.length) {
        prompt += `
## Must Exclude
${request.scope.exclude.map((s) => `- ${s}`).join("\n")}
`;
      }
    }

    if (request.sources?.length) {
      prompt += `
## Sources to Reference
${request.sources.map((s) => `- ${s.type}: ${s.path}`).join("\n")}
`;
    }

    prompt += `
## Instructions
1. Analyze the request and identify distinct skills needed
2. For each skill, define its scope and boundaries
3. Create tasks for research, writing, examples, and review
4. Set dependencies (research before write, write before review)
5. Assign priorities based on user's core needs

Output a complete execution plan.`;

    return prompt;
  }

  /** Execute the orchestration (main entry point) */
  async execute(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();
    this.state.iteration++;

    try {
      const request = input.context?.request as SkillGenerationRequest;
      if (!request) {
        throw new Error("No skill generation request provided");
      }

      const plan = await this.createPlan(request);

      this.setContext("plan", plan);
      this.setContext("request", request);

      return {
        agentName: this.name,
        success: true,
        output: plan,
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

  /** Refine plan based on feedback */
  async refinePlan(feedback: string): Promise<Plan> {
    const currentPlan = this.getContext<Plan>("plan");
    if (!currentPlan) {
      throw new Error("No existing plan to refine");
    }

    const prompt = `Refine the execution plan based on feedback.

## Current Plan
${JSON.stringify(currentPlan, null, 2)}

## Feedback
${feedback}

## Instructions
Update the plan to address the feedback while maintaining coherence.
Output the refined plan.`;

    const refinedPlan = await this.callLLMStructured(prompt, PlanSchema);
    this.setContext("plan", refinedPlan);

    return refinedPlan;
  }
}
