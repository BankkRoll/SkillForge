/**
 * SkillForge Quality Gates
 * Validates and lints generated skills, agents, and plugins
 */

import { readFile } from "fs/promises";
import { join, basename } from "path";
import { existsSync } from "fs";
import yaml from "yaml";

// ============================================================================
// TYPES
// ============================================================================

export interface LintIssue {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface LintResult {
  passed: boolean;
  score: number;
  issues: LintIssue[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
}

export interface QualityGate {
  name: string;
  description: string;
  check: (content: string, metadata?: Record<string, unknown>) => LintIssue[];
}

export interface QualityConfig {
  minScore?: number;
  failOnError?: boolean;
  failOnWarning?: boolean;
  enabledRules?: string[];
  disabledRules?: string[];
  customRules?: QualityGate[];
}

// ============================================================================
// SKILL QUALITY GATES
// ============================================================================

const SKILL_QUALITY_GATES: QualityGate[] = [
  {
    name: "has-frontmatter",
    description: "Skill must have YAML frontmatter",
    check: (content) => {
      if (!content.startsWith("---")) {
        return [
          {
            severity: "error",
            rule: "has-frontmatter",
            message: "Skill must start with YAML frontmatter (---)",
            suggestion: "Add YAML frontmatter at the beginning of the file",
          },
        ];
      }
      const endIndex = content.indexOf("---", 3);
      if (endIndex === -1) {
        return [
          {
            severity: "error",
            rule: "has-frontmatter",
            message: "YAML frontmatter must be closed with ---",
          },
        ];
      }
      return [];
    },
  },
  {
    name: "has-name",
    description: "Skill must have a name in frontmatter",
    check: (content) => {
      const frontmatter = extractFrontmatter(content);
      if (!frontmatter?.name) {
        return [
          {
            severity: "error",
            rule: "has-name",
            message: "Skill frontmatter must include a name field",
          },
        ];
      }
      return [];
    },
  },
  {
    name: "has-description",
    description: "Skill must have a description",
    check: (content) => {
      const frontmatter = extractFrontmatter(content);
      const description = frontmatter?.description;
      if (!description || typeof description !== "string") {
        return [
          {
            severity: "error",
            rule: "has-description",
            message: "Skill frontmatter must include a description field",
          },
        ];
      }
      if (description.length < 20) {
        return [
          {
            severity: "warning",
            rule: "has-description",
            message: "Description should be at least 20 characters",
            suggestion:
              "Provide a more detailed description of what this skill does",
          },
        ];
      }
      return [];
    },
  },
  {
    name: "has-procedure",
    description: "Skill must have a procedure section",
    check: (content) => {
      if (
        !content.includes("## Procedure") &&
        !content.includes("## procedure")
      ) {
        return [
          {
            severity: "error",
            rule: "has-procedure",
            message: "Skill must include a ## Procedure section",
            suggestion: "Add a procedure section with numbered steps",
          },
        ];
      }
      return [];
    },
  },
  {
    name: "has-when-to-use",
    description: "Skill should have a when to use section",
    check: (content) => {
      const hasWhenToUse = content.toLowerCase().includes("when to use");
      if (!hasWhenToUse) {
        return [
          {
            severity: "warning",
            rule: "has-when-to-use",
            message: 'Skill should include a "When to use" section',
            suggestion:
              "Add a section explaining when this skill should be invoked",
          },
        ];
      }
      return [];
    },
  },
  {
    name: "has-constraints",
    description: "Skill should have constraints or guardrails",
    check: (content) => {
      const hasConstraints =
        content.includes("## Constraints") ||
        content.includes("## Guardrails") ||
        content.includes("NEVER") ||
        content.includes("ALWAYS");

      if (!hasConstraints) {
        return [
          {
            severity: "warning",
            rule: "has-constraints",
            message: "Skill should include constraints or guardrails",
            suggestion: "Add a ## Constraints section with NEVER/ALWAYS rules",
          },
        ];
      }
      return [];
    },
  },
  {
    name: "procedure-has-steps",
    description: "Procedure should have numbered steps",
    check: (content) => {
      const procedureMatch = content.match(/## Procedure[\s\S]*?(?=##|$)/i);
      if (procedureMatch) {
        const procedure = procedureMatch[0];
        const hasNumberedSteps =
          /###\s*\d+\./.test(procedure) ||
          /^\d+\.\s+/m.test(procedure) ||
          /### Step \d+/i.test(procedure);

        if (!hasNumberedSteps) {
          return [
            {
              severity: "warning",
              rule: "procedure-has-steps",
              message: "Procedure should have numbered steps",
              suggestion: "Use ### 1. Step Title format for procedure steps",
            },
          ];
        }
      }
      return [];
    },
  },
  {
    name: "no-vague-instructions",
    description: "Avoid vague instructions",
    check: (content) => {
      const issues: LintIssue[] = [];
      const vaguePatterns = [
        {
          pattern: /\betc\.?\b/gi,
          message: 'Avoid using "etc." - be specific',
        },
        {
          pattern: /\band so on\b/gi,
          message: 'Avoid "and so on" - list all items',
        },
        {
          pattern: /\bas needed\b/gi,
          message: '"as needed" is vague - specify conditions',
        },
        {
          pattern: /\bas appropriate\b/gi,
          message: '"as appropriate" is vague - define criteria',
        },
        {
          pattern: /\bif necessary\b/gi,
          message: '"if necessary" is vague - specify when',
        },
      ];

      for (const { pattern, message } of vaguePatterns) {
        const matches = content.match(pattern);
        if (matches) {
          issues.push({
            severity: "info",
            rule: "no-vague-instructions",
            message,
            suggestion: "Be specific about what should be done and when",
          });
        }
      }

      return issues;
    },
  },
  {
    name: "has-output-format",
    description: "Skill should define output expectations",
    check: (content) => {
      const hasOutput =
        content.includes("## Output") ||
        content.includes("## Expected output") ||
        content.includes("## Output expectations");

      if (!hasOutput) {
        return [
          {
            severity: "info",
            rule: "has-output-format",
            message: "Consider adding an output format section",
            suggestion:
              "Add ## Output expectations to define what the skill produces",
          },
        ];
      }
      return [];
    },
  },
  {
    name: "name-is-kebab-case",
    description: "Skill name should be kebab-case",
    check: (content) => {
      const frontmatter = extractFrontmatter(content);
      const name = frontmatter?.name;
      if (name && typeof name === "string") {
        const isKebabCase = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name);
        if (!isKebabCase) {
          return [
            {
              severity: "warning",
              rule: "name-is-kebab-case",
              message: `Skill name "${name}" should be kebab-case`,
              suggestion: `Consider renaming to "${toKebabCase(name)}"`,
            },
          ];
        }
      }
      return [];
    },
  },
];

// ============================================================================
// AGENT QUALITY GATES
// ============================================================================

const AGENT_QUALITY_GATES: QualityGate[] = [
  {
    name: "has-frontmatter",
    description: "Agent must have YAML frontmatter",
    check: SKILL_QUALITY_GATES[0].check,
  },
  {
    name: "has-name",
    description: "Agent must have a name",
    check: SKILL_QUALITY_GATES[1].check,
  },
  {
    name: "has-description",
    description: "Agent must have a description",
    check: SKILL_QUALITY_GATES[2].check,
  },
  {
    name: "has-system-prompt",
    description: "Agent must have a system prompt",
    check: (content) => {
      if (
        !content.includes("## System Prompt") &&
        !content.includes("## system prompt")
      ) {
        return [
          {
            severity: "error",
            rule: "has-system-prompt",
            message: "Agent must include a ## System Prompt section",
          },
        ];
      }
      return [];
    },
  },
  {
    name: "has-capabilities",
    description: "Agent should list capabilities",
    check: (content) => {
      if (!content.includes("## Capabilities")) {
        return [
          {
            severity: "warning",
            rule: "has-capabilities",
            message: "Agent should include a ## Capabilities section",
          },
        ];
      }
      return [];
    },
  },
  {
    name: "has-constraints",
    description: "Agent should define constraints",
    check: (content) => {
      if (!content.includes("## Constraints")) {
        return [
          {
            severity: "warning",
            rule: "has-constraints",
            message: "Agent should include a ## Constraints section",
          },
        ];
      }
      return [];
    },
  },
  {
    name: "system-prompt-length",
    description: "System prompt should be detailed",
    check: (content) => {
      const promptMatch = content.match(/## System Prompt[\s\S]*?(?=##|$)/i);
      if (promptMatch) {
        const prompt = promptMatch[0].replace("## System Prompt", "").trim();
        if (prompt.length < 100) {
          return [
            {
              severity: "warning",
              rule: "system-prompt-length",
              message:
                "System prompt should be more detailed (at least 100 characters)",
            },
          ];
        }
      }
      return [];
    },
  },
];

// ============================================================================
// PLUGIN QUALITY GATES
// ============================================================================

const PLUGIN_QUALITY_GATES: QualityGate[] = [
  {
    name: "has-manifest",
    description: "Plugin must have a manifest.json",
    check: (_content, metadata) => {
      if (!metadata?.hasManifest) {
        return [
          {
            severity: "error",
            rule: "has-manifest",
            message: "Plugin must include a manifest.json file",
          },
        ];
      }
      return [];
    },
  },
  {
    name: "manifest-has-name",
    description: "Manifest must have a name",
    check: (content) => {
      try {
        const manifest = JSON.parse(content);
        if (!manifest.name) {
          return [
            {
              severity: "error",
              rule: "manifest-has-name",
              message: "Manifest must include a name field",
            },
          ];
        }
      } catch {
        return [
          {
            severity: "error",
            rule: "manifest-has-name",
            message: "Invalid JSON in manifest",
          },
        ];
      }
      return [];
    },
  },
  {
    name: "manifest-has-version",
    description: "Manifest must have a version",
    check: (content) => {
      try {
        const manifest = JSON.parse(content);
        if (!manifest.version) {
          return [
            {
              severity: "error",
              rule: "manifest-has-version",
              message: "Manifest must include a version field",
            },
          ];
        }
        if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
          return [
            {
              severity: "warning",
              rule: "manifest-has-version",
              message: "Version should follow semver (e.g., 1.0.0)",
            },
          ];
        }
      } catch {
        // Already caught by manifest-has-name
      }
      return [];
    },
  },
  {
    name: "has-readme",
    description: "Plugin should have a README",
    check: (_content, metadata) => {
      if (!metadata?.hasReadme) {
        return [
          {
            severity: "warning",
            rule: "has-readme",
            message: "Plugin should include a README.md file",
          },
        ];
      }
      return [];
    },
  },
];

// ============================================================================
// LINTER CLASS
// ============================================================================

export class QualityLinter {
  private config: Required<QualityConfig>;
  private gates: Map<string, QualityGate[]>;

  constructor(config: QualityConfig = {}) {
    this.config = {
      minScore: config.minScore ?? 70,
      failOnError: config.failOnError ?? true,
      failOnWarning: config.failOnWarning ?? false,
      enabledRules: config.enabledRules ?? [],
      disabledRules: config.disabledRules ?? [],
      customRules: config.customRules ?? [],
    };

    this.gates = new Map([
      ["skill", [...SKILL_QUALITY_GATES, ...this.config.customRules]],
      ["agent", [...AGENT_QUALITY_GATES, ...this.config.customRules]],
      ["plugin", [...PLUGIN_QUALITY_GATES, ...this.config.customRules]],
    ]);
  }

  /**
   * Lint a skill file
   */
  lintSkill(content: string, filePath?: string): LintResult {
    return this.lint(content, "skill", filePath);
  }

  /**
   * Lint an agent file
   */
  lintAgent(content: string, filePath?: string): LintResult {
    return this.lint(content, "agent", filePath);
  }

  /**
   * Lint a plugin manifest
   */
  lintPlugin(content: string, metadata?: Record<string, unknown>): LintResult {
    return this.lint(content, "plugin", undefined, metadata);
  }

  /**
   * Run lint checks
   */
  private lint(
    content: string,
    type: "skill" | "agent" | "plugin",
    filePath?: string,
    metadata?: Record<string, unknown>,
  ): LintResult {
    const gates = this.gates.get(type) || [];
    const issues: LintIssue[] = [];

    for (const gate of gates) {
      // Check if rule is enabled/disabled
      if (this.config.disabledRules.includes(gate.name)) continue;
      if (
        this.config.enabledRules.length > 0 &&
        !this.config.enabledRules.includes(gate.name)
      ) {
        continue;
      }

      const gateIssues = gate.check(content, metadata);
      issues.push(
        ...gateIssues.map((issue) => ({
          ...issue,
          file: filePath,
        })),
      );
    }

    const summary = {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      infos: issues.filter((i) => i.severity === "info").length,
    };

    // Calculate score
    const maxScore = 100;
    const errorPenalty = 20;
    const warningPenalty = 5;
    const infoPenalty = 1;

    const deductions =
      summary.errors * errorPenalty +
      summary.warnings * warningPenalty +
      summary.infos * infoPenalty;

    const score = Math.max(0, maxScore - deductions);

    // Determine if passed
    const passed =
      (!this.config.failOnError || summary.errors === 0) &&
      (!this.config.failOnWarning || summary.warnings === 0) &&
      score >= this.config.minScore;

    return {
      passed,
      score,
      issues,
      summary,
    };
  }

  /**
   * Lint a file from disk
   */
  async lintFile(filePath: string): Promise<LintResult> {
    const content = await readFile(filePath, "utf-8");
    const name = basename(filePath).toLowerCase();

    if (name === "skill.md") {
      return this.lintSkill(content, filePath);
    } else if (name === "agent.md") {
      return this.lintAgent(content, filePath);
    } else if (name === "manifest.json") {
      return this.lintPlugin(content);
    }

    // Default to skill linting for .md files
    if (filePath.endsWith(".md")) {
      return this.lintSkill(content, filePath);
    }

    throw new Error(`Unknown file type: ${filePath}`);
  }

  /**
   * Lint a directory of files
   */
  async lintDirectory(dirPath: string): Promise<Map<string, LintResult>> {
    const results = new Map<string, LintResult>();

    // Check for skill
    const skillPath = join(dirPath, "SKILL.md");
    if (existsSync(skillPath)) {
      results.set(skillPath, await this.lintFile(skillPath));
    }

    // Check for agent
    const agentPath = join(dirPath, "agent.md");
    if (existsSync(agentPath)) {
      results.set(agentPath, await this.lintFile(agentPath));
    }

    // Check for manifest
    const manifestPath = join(dirPath, "manifest.json");
    if (existsSync(manifestPath)) {
      results.set(manifestPath, await this.lintFile(manifestPath));
    }

    return results;
  }

  /**
   * Add a custom quality gate
   */
  addGate(type: "skill" | "agent" | "plugin", gate: QualityGate): void {
    const gates = this.gates.get(type) || [];
    gates.push(gate);
    this.gates.set(type, gates);
  }

  /**
   * Get available rules
   */
  getRules(
    type: "skill" | "agent" | "plugin",
  ): Array<{ name: string; description: string }> {
    const gates = this.gates.get(type) || [];
    return gates.map((g) => ({ name: g.name, description: g.description }));
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.startsWith("---")) return null;

  const endIndex = content.indexOf("---", 3);
  if (endIndex === -1) return null;

  const frontmatterStr = content.slice(3, endIndex).trim();

  try {
    return yaml.parse(frontmatterStr);
  } catch {
    return null;
  }
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

// ============================================================================
// STANDALONE FUNCTIONS
// ============================================================================

/**
 * Quick lint a skill
 */
export function lintSkill(content: string, config?: QualityConfig): LintResult {
  const linter = new QualityLinter(config);
  return linter.lintSkill(content);
}

/**
 * Quick lint an agent
 */
export function lintAgent(content: string, config?: QualityConfig): LintResult {
  const linter = new QualityLinter(config);
  return linter.lintAgent(content);
}

/**
 * Quick lint a plugin manifest
 */
export function lintPlugin(
  content: string,
  config?: QualityConfig,
): LintResult {
  const linter = new QualityLinter(config);
  return linter.lintPlugin(content);
}

/**
 * Format lint results as a report
 */
export function formatLintReport(
  result: LintResult,
  verbose: boolean = false,
): string {
  const lines: string[] = [];

  const statusIcon = result.passed ? "✓" : "✗";
  const statusText = result.passed ? "PASSED" : "FAILED";

  lines.push(
    `${statusIcon} Quality Check: ${statusText} (Score: ${result.score}/100)`,
  );
  lines.push("");

  if (result.summary.errors > 0) {
    lines.push(`Errors: ${result.summary.errors}`);
  }
  if (result.summary.warnings > 0) {
    lines.push(`Warnings: ${result.summary.warnings}`);
  }
  if (result.summary.infos > 0 && verbose) {
    lines.push(`Info: ${result.summary.infos}`);
  }

  if (result.issues.length > 0) {
    lines.push("");
    lines.push("Issues:");

    for (const issue of result.issues) {
      if (issue.severity === "info" && !verbose) continue;

      const icon =
        issue.severity === "error"
          ? "✗"
          : issue.severity === "warning"
            ? "⚠"
            : "ℹ";

      lines.push(`  ${icon} [${issue.rule}] ${issue.message}`);
      if (issue.suggestion && verbose) {
        lines.push(`    → ${issue.suggestion}`);
      }
    }
  }

  return lines.join("\n");
}
