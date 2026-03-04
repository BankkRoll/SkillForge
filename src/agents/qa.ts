/**
 * SkillForge QA Agent
 *
 * Reviews skills for quality, completeness, security, and consistency.
 * Provides detailed scoring and actionable improvement recommendations.
 *
 * @module agents/qa
 */

import { z } from "zod";
import {
  BaseAgent,
  type AgentInput,
  type AgentResult,
  type AgentEventHandlers,
} from "./base.js";
import type { SkillOutput } from "./skill-writer.js";
import type { ExamplesOutput } from "./example-generator.js";

// ============================================================================
// SCHEMAS
// ============================================================================

/** Schema for an issue found during review */
const IssueSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  category: z.enum([
    "completeness",
    "clarity",
    "security",
    "consistency",
    "accuracy",
    "structure",
    "examples",
  ]),
  location: z.string(),
  description: z.string(),
  suggestion: z.string(),
  autoFixable: z.boolean(),
});

/** Schema for complete QA results */
const QAResultSchema = z.object({
  skillName: z.string(),
  overallScore: z.number().min(0).max(100),
  passed: z.boolean(),
  summary: z.string(),

  scores: z.object({
    completeness: z.number().min(0).max(100),
    clarity: z.number().min(0).max(100),
    security: z.number().min(0).max(100),
    consistency: z.number().min(0).max(100),
    accuracy: z.number().min(0).max(100),
    examples: z.number().min(0).max(100),
  }),

  issues: z.array(IssueSchema),

  strengths: z.array(z.string()),

  recommendations: z.array(
    z.object({
      priority: z.enum(["required", "recommended", "optional"]),
      action: z.string(),
      rationale: z.string(),
    }),
  ),
});

export type Issue = z.infer<typeof IssueSchema>;
export type QAResult = z.infer<typeof QAResultSchema>;

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const QA_SYSTEM_PROMPT = `You are the SkillForge QA Agent, an expert reviewer ensuring skill quality.

Your role is to:
1. Review skills for completeness and accuracy
2. Check for security issues and vulnerabilities
3. Verify clarity and actionability
4. Ensure consistency in structure and style
5. Validate examples work correctly

Review criteria:

**Completeness (0-100)**
- All required sections present
- Procedures cover the full workflow
- Edge cases addressed
- Prerequisites documented

**Clarity (0-100)**
- Instructions are unambiguous
- Steps are actionable
- Technical terms explained
- Examples illustrate concepts

**Security (0-100)**
- No exposed secrets or credentials
- Input validation mentioned
- Dangerous operations warned
- Secure patterns used

**Consistency (0-100)**
- Uniform formatting
- Consistent terminology
- Proper YAML frontmatter
- Standard section structure

**Accuracy (0-100)**
- Technically correct information
- Valid code examples
- Correct API usage
- Up-to-date patterns

**Examples (0-100)**
- Runnable code
- Realistic scenarios
- Error handling shown
- Good coverage

Pass threshold: 80% overall score with no critical issues.

Be constructive and specific. Every issue should have an actionable fix.`;

// ============================================================================
// QA AGENT
// ============================================================================

/** Options for creating a QA agent */
export interface QAOptions {
  /** Model to use (inherits from gateway if not specified) */
  model?: string;
  /** Event handlers for lifecycle events */
  eventHandlers?: AgentEventHandlers;
}

/**
 * QA agent that reviews skills for quality.
 * Provides detailed scoring and improvement recommendations.
 */
export class QAAgent extends BaseAgent {
  constructor(options: QAOptions = {}) {
    super(
      {
        name: "qa",
        description: "Reviews skills for quality, completeness, and security",
        model: options.model,
        temperature: 0.2,
        maxTokens: 8192,
        systemPrompt: QA_SYSTEM_PROMPT,
        maxIterations: 3,
      },
      options.eventHandlers || {},
    );
  }

  /** Review a skill for quality */
  async reviewSkill(
    skill: SkillOutput,
    markdown: string,
    examples?: ExamplesOutput,
  ): Promise<QAResult> {
    const prompt = this.buildReviewPrompt(skill, markdown, examples);

    const result = await this.callLLMStructured(prompt, QAResultSchema, {
      schemaName: "qa_result",
      schemaDescription: "Quality review results for a skill",
    });

    this.setContext(`qa:${skill.frontmatter.name}`, result);

    return result;
  }

  /** Build the review prompt from inputs */
  private buildReviewPrompt(
    skill: SkillOutput,
    markdown: string,
    examples?: ExamplesOutput,
  ): string {
    return `Review this skill thoroughly.

## Skill Metadata
Name: ${skill.frontmatter.name}
Description: ${skill.frontmatter.description}

## SKILL.md Content
\`\`\`markdown
${markdown}
\`\`\`

## Structured Skill Data
${JSON.stringify(skill, null, 2)}

${
  examples
    ? `
## Examples
${JSON.stringify(examples, null, 2)}
`
    : ""
}

## Review Instructions

### 1. Completeness Check
- Are all required sections present?
- Does the procedure cover the full workflow?
- Are edge cases addressed?
- Are prerequisites clear?

### 2. Clarity Check
- Are instructions unambiguous?
- Can each step be followed exactly?
- Are technical terms explained?
- Do examples clarify concepts?

### 3. Security Check
- Any exposed secrets or credentials?
- Is input validation mentioned?
- Are dangerous operations warned about?
- Are secure patterns recommended?

### 4. Consistency Check
- Is formatting uniform?
- Is terminology consistent?
- Is YAML frontmatter valid?
- Does structure follow standards?

### 5. Accuracy Check
- Is information technically correct?
- Are code examples valid?
- Is API usage correct?
- Are patterns current?

### 6. Examples Check (if provided)
- Would code examples run?
- Are scenarios realistic?
- Is error handling shown?
- Is coverage sufficient?

Provide:
1. Overall score (0-100)
2. Individual category scores
3. Specific issues with locations and fixes
4. Strengths to highlight
5. Prioritized recommendations

Be thorough but constructive.`;
  }

  /** Execute QA review (main entry point) */
  async execute(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();
    this.state.iteration++;

    try {
      const { skill, markdown, examples } = input.context as {
        skill: SkillOutput;
        markdown: string;
        examples?: ExamplesOutput;
      };

      if (!skill || !markdown) {
        throw new Error("Missing skill or markdown in context");
      }

      const result = await this.reviewSkill(skill, markdown, examples);

      return {
        agentName: this.name,
        success: true,
        output: result,
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

  /** Quick security-only review */
  async securityReview(skill: SkillOutput, markdown: string): Promise<Issue[]> {
    const prompt = `Perform a security-focused review of this skill.

## Skill
Name: ${skill.frontmatter.name}

## Content
${markdown}

## Security Review Focus

Check for:
1. **Secrets exposure**: Any hardcoded credentials, API keys, tokens
2. **Injection vulnerabilities**: SQL, command, XSS risks
3. **Unsafe operations**: File deletion, network requests, exec calls
4. **Missing validation**: Input sanitization, boundary checks
5. **Insecure defaults**: Disabled security features, permissive settings
6. **Data exposure**: Logging sensitive data, error messages with internals

For each issue found:
- Identify the exact location
- Describe the security risk
- Provide a specific fix

Only report genuine security concerns.`;

    const IssuesArraySchema = z.array(IssueSchema);
    const issues = await this.callLLMStructured(prompt, IssuesArraySchema);

    return issues.filter((i) => i.category === "security");
  }

  /** Check if skill passes quality gates */
  checkQualityGates(
    result: QAResult,
    threshold: number = 80,
  ): {
    passed: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];

    if (result.overallScore < threshold) {
      reasons.push(
        `Overall score ${result.overallScore} below threshold ${threshold}`,
      );
    }

    const criticalIssues = result.issues.filter(
      (i) => i.severity === "critical",
    );
    if (criticalIssues.length > 0) {
      reasons.push(`${criticalIssues.length} critical issue(s) found`);
    }

    const minCategoryScore = 60;
    for (const [category, score] of Object.entries(result.scores)) {
      if (score < minCategoryScore) {
        reasons.push(
          `${category} score ${score} below minimum ${minCategoryScore}`,
        );
      }
    }

    return {
      passed: reasons.length === 0,
      reasons,
    };
  }
}
