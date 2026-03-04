/**
 * SkillForge Templates
 * Template engine and pre-built templates for skills, agents, and plugins
 */

import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ============================================================================
// TYPES
// ============================================================================

export interface TemplateData {
  [key: string]: unknown;
}

export interface TemplateOptions {
  strict?: boolean;
  helpers?: Record<string, TemplateHelper>;
}

export type TemplateHelper = (...args: unknown[]) => string;

// ============================================================================
// BUILT-IN TEMPLATES
// ============================================================================

export const SKILL_TEMPLATE = `---
name: {{name}}
description: {{description}}
{{#if argumentHint}}argument-hint: "{{argumentHint}}"{{/if}}
{{#if allowedTools}}allowed-tools: {{allowedTools}}{{/if}}
{{#if model}}model: {{model}}{{/if}}
{{#if tags}}tags: [{{tags}}]{{/if}}
version: 1.0.0
---

# {{title}}

{{description}}

## When to use this skill

{{#each whenToUse}}
- {{this}}
{{/each}}

## When NOT to use this skill

{{#each whenNotToUse}}
- {{this}}
{{/each}}

## Procedure

{{#each procedure}}
### {{step}}. {{title}}

{{description}}

{{#if code}}
\`\`\`{{language}}
{{code}}
\`\`\`
{{/if}}

{{/each}}

## Constraints

{{#each constraints}}
- {{this}}
{{/each}}

## Guardrails

{{#each guardrails}}
- {{this}}
{{/each}}

## Output expectations

{{outputDescription}}

Include these sections:
{{#each outputSections}}
- {{this}}
{{/each}}
`;

export const AGENT_TEMPLATE = `---
name: {{name}}
description: {{description}}
{{#if model}}model: {{model}}{{/if}}
{{#if tools}}tools: [{{tools}}]{{/if}}
version: 1.0.0
---

# {{title}}

{{description}}

## System Prompt

{{systemPrompt}}

## Capabilities

{{#each capabilities}}
- {{this}}
{{/each}}

## Constraints

{{#each constraints}}
- {{this}}
{{/each}}

## Communication

**Style:** {{communicationStyle}}

**Tone:** {{communicationTone}}

### Guidelines

{{#each communicationGuidelines}}
- {{this}}
{{/each}}
`;

export const PLUGIN_MANIFEST_TEMPLATE = `{
  "name": "{{name}}",
  "version": "{{version}}",
  "description": "{{description}}",
  "author": "{{author}}",
  "license": "MIT",
  "skills": [{{#each skills}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}],
  "agents": [{{#each agents}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}]
}`;

// ============================================================================
// TEMPLATE ENGINE
// ============================================================================

/**
 * Simple Handlebars-like template engine
 */
export class TemplateEngine {
  private helpers: Map<string, TemplateHelper> = new Map();

  constructor(options?: TemplateOptions) {
    // Register built-in helpers
    this.registerHelper("if", (condition, options) => {
      return condition ? String(options) : "";
    });

    this.registerHelper("unless", (condition, options) => {
      return !condition ? String(options) : "";
    });

    this.registerHelper("each", (array, template) => {
      if (!Array.isArray(array)) return "";
      return array
        .map((item, index) => {
          const context = typeof item === "object" ? item : { this: item };
          return this.render(String(template), {
            ...context,
            "@index": index,
            "@first": index === 0,
            "@last": index === array.length - 1,
          });
        })
        .join("");
    });

    // Register custom helpers
    if (options?.helpers) {
      for (const [name, fn] of Object.entries(options.helpers)) {
        this.registerHelper(name, fn);
      }
    }
  }

  /**
   * Register a helper function
   */
  registerHelper(name: string, fn: TemplateHelper): void {
    this.helpers.set(name, fn);
  }

  /**
   * Render a template with data
   */
  render(template: string, data: TemplateData): string {
    let result = template;

    // Handle block helpers: {{#helper}}...{{/helper}}
    result = this.processBlockHelpers(result, data);

    // Handle simple variables: {{variable}}
    result = this.processVariables(result, data);

    return result;
  }

  /**
   * Process block helpers like {{#if}}, {{#each}}
   */
  private processBlockHelpers(template: string, data: TemplateData): string {
    // Match {{#helper arg}}content{{/helper}}
    const blockPattern = /\{\{#(\w+)\s*([^}]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

    return template.replace(blockPattern, (match, helper, args, content) => {
      const helperFn = this.helpers.get(helper);
      if (!helperFn) return match;

      // Resolve the argument
      const argValue = this.resolveValue(args.trim(), data);

      // Call the helper
      return helperFn(argValue, content);
    });
  }

  /**
   * Process simple variables like {{variable}}
   */
  private processVariables(template: string, data: TemplateData): string {
    // Match {{variable}} or {{object.property}}
    const varPattern = /\{\{([^#/][^}]*)\}\}/g;

    return template.replace(varPattern, (_match, path) => {
      const value = this.resolveValue(path.trim(), data);

      if (value === undefined || value === null) {
        return "";
      }

      if (typeof value === "object") {
        return JSON.stringify(value);
      }

      return String(value);
    });
  }

  /**
   * Resolve a value from data using dot notation
   */
  private resolveValue(path: string, data: TemplateData): unknown {
    // Handle array index notation: array.[0]
    const parts = path.split(".").map((p) => {
      const match = p.match(/^\[(\d+)\]$/);
      return match ? parseInt(match[1], 10) : p;
    });

    let value: unknown = data;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }

      if (typeof part === "number") {
        value = (value as unknown[])[part];
      } else {
        value = (value as Record<string, unknown>)[part];
      }
    }

    return value;
  }
}

// ============================================================================
// TEMPLATE LOADING
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a template file
 */
export async function loadTemplate(
  name: "skill" | "agent" | "plugin",
): Promise<string> {
  const templates: Record<string, string> = {
    skill: SKILL_TEMPLATE,
    agent: AGENT_TEMPLATE,
    plugin: PLUGIN_MANIFEST_TEMPLATE,
  };

  return templates[name] || "";
}

/**
 * Load a template from file
 */
export async function loadTemplateFile(filename: string): Promise<string> {
  const filePath = join(__dirname, filename);
  return readFile(filePath, "utf-8");
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

const defaultEngine = new TemplateEngine();

/**
 * Render a skill template
 */
export function renderSkillTemplate(data: TemplateData): string {
  return defaultEngine.render(SKILL_TEMPLATE, data);
}

/**
 * Render an agent template
 */
export function renderAgentTemplate(data: TemplateData): string {
  return defaultEngine.render(AGENT_TEMPLATE, data);
}

/**
 * Render a plugin manifest template
 */
export function renderPluginTemplate(data: TemplateData): string {
  return defaultEngine.render(PLUGIN_MANIFEST_TEMPLATE, data);
}

/**
 * Render any template with data
 */
export function render(template: string, data: TemplateData): string {
  return defaultEngine.render(template, data);
}

/**
 * Create a new template engine with custom options
 */
export function createEngine(options?: TemplateOptions): TemplateEngine {
  return new TemplateEngine(options);
}

// ============================================================================
// STARTER TEMPLATES
// ============================================================================

/**
 * Get a minimal skill starter
 */
export function getSkillStarter(name: string, description: string): string {
  return `---
name: ${name}
description: ${description}
version: 1.0.0
---

# ${name}

${description}

## When to use this skill

- TODO: Add use cases

## When NOT to use this skill

- TODO: Add exclusions

## Procedure

### 1. First Step

TODO: Describe the first step.

### 2. Second Step

TODO: Describe the second step.

## Constraints

- NEVER TODO: Add critical constraints
- ALWAYS TODO: Add mandatory actions

## Guardrails

- Prefer TODO: Add preferences
- Avoid TODO: Add discouraged patterns

## Output expectations

TODO: Describe expected outputs

Include these sections:
- TODO: Define output sections
`;
}

/**
 * Get a minimal agent starter
 */
export function getAgentStarter(name: string, description: string): string {
  return `---
name: ${name}
description: ${description}
version: 1.0.0
---

# ${name}

${description}

## System Prompt

You are ${name}, an AI assistant that ${description.toLowerCase()}.

TODO: Expand the system prompt with detailed instructions.

## Capabilities

- TODO: Add capabilities

## Constraints

- TODO: Add constraints

## Communication

**Style:** Professional and helpful

**Tone:** Clear and concise

### Guidelines

- TODO: Add communication guidelines
`;
}

/**
 * Get a minimal plugin starter
 */
export function getPluginStarter(
  name: string,
  description: string,
): Record<string, unknown> {
  return {
    name,
    version: "1.0.0",
    description,
    author: "",
    license: "MIT",
    skills: [],
    agents: [],
    hooks: [],
    settings: [],
  };
}
