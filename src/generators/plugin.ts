/**
 * SkillForge Plugin Generator
 * Creates full plugin packages with manifest, skills, agents, and hooks
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { z } from "zod";
import type { AIGateway } from "../gateway/index.js";
import { AgentGenerator, type AgentDefinition } from "./agent.js";
import type { SkillOutput } from "../agents/skill-writer.js";
import type { ExamplesOutput } from "../agents/example-generator.js";

// ============================================================================
// TYPES
// ============================================================================

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  engines?: {
    claudeCode?: string;
    node?: string;
  };
  skills?: string[];
  agents?: string[];
  hooks?: HookDefinition[];
  settings?: PluginSetting[];
  dependencies?: Record<string, string>;
}

export interface HookDefinition {
  event: "PreToolCall" | "PostToolCall" | "Notification" | "Stop" | "Custom";
  name: string;
  description: string;
  command?: string;
  script?: string;
  conditions?: Record<string, unknown>;
}

export interface PluginSetting {
  key: string;
  type: "string" | "boolean" | "number" | "select";
  label: string;
  description?: string;
  default?: unknown;
  options?: Array<{ label: string; value: unknown }>;
  required?: boolean;
}

export interface PluginGeneratorOptions {
  outputDir: string;
  overwrite?: boolean;
  includeExamples?: boolean;
  includeTests?: boolean;
  generateHooks?: boolean;
  verbose?: boolean;
}

export interface PluginDefinition {
  manifest: PluginManifest;
  skills?: Array<{
    skill: SkillOutput;
    markdown: string;
    examples?: ExamplesOutput;
  }>;
  agents?: AgentDefinition[];
  hooks?: HookDefinition[];
  readme?: string;
}

export interface GeneratedPlugin {
  name: string;
  path: string;
  files: string[];
  success: boolean;
  error?: string;
}

// ============================================================================
// PLUGIN SCHEMA FOR LLM OUTPUT
// ============================================================================

const PluginOutputSchema = z.object({
  manifest: z.object({
    name: z.string(),
    version: z.string(),
    description: z.string(),
    author: z.string().optional(),
    license: z.string().optional(),
    homepage: z.string().optional(),
    repository: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    engines: z
      .object({
        claudeCode: z.string().optional(),
        node: z.string().optional(),
      })
      .optional(),
  }),
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      purpose: z.string(),
    }),
  ),
  agents: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      purpose: z.string(),
    }),
  ),
  hooks: z
    .array(
      z.object({
        event: z.enum([
          "PreToolCall",
          "PostToolCall",
          "Notification",
          "Stop",
          "Custom",
        ]),
        name: z.string(),
        description: z.string(),
        purpose: z.string(),
      }),
    )
    .optional(),
  settings: z
    .array(
      z.object({
        key: z.string(),
        type: z.enum(["string", "boolean", "number", "select"]),
        label: z.string(),
        description: z.string().optional(),
        default: z.unknown().optional(),
        required: z.boolean().optional(),
      }),
    )
    .optional(),
  readme: z.string(),
});

export type PluginOutput = z.infer<typeof PluginOutputSchema>;

// ============================================================================
// PLUGIN GENERATOR
// ============================================================================

export class PluginGenerator {
  private options: Required<PluginGeneratorOptions>;
  private gateway?: AIGateway;
  private agentGenerator: AgentGenerator;

  constructor(options: PluginGeneratorOptions, gateway?: AIGateway) {
    this.options = {
      outputDir: options.outputDir,
      overwrite: options.overwrite ?? false,
      includeExamples: options.includeExamples ?? true,
      includeTests: options.includeTests ?? true,
      generateHooks: options.generateHooks ?? true,
      verbose: options.verbose ?? false,
    };
    this.gateway = gateway;

    this.agentGenerator = new AgentGenerator(
      {
        outputDir: join(options.outputDir, "agents"),
        overwrite: options.overwrite,
        includeExamples: options.includeExamples,
        verbose: options.verbose,
      },
      gateway,
    );
  }

  /**
   * Generate a plugin from a prompt using AI
   */
  async generateFromPrompt(
    prompt: string,
    context?: {
      domain?: string;
      framework?: string;
      targetPlatform?: string;
    },
  ): Promise<GeneratedPlugin> {
    if (!this.gateway) {
      throw new Error("AI Gateway required for prompt-based generation");
    }

    // Build the generation prompt
    const generationPrompt = this.buildGenerationPrompt(prompt, context);

    // Generate plugin structure using AI
    const result = await this.gateway.generateStructured(
      generationPrompt,
      PluginOutputSchema,
      {
        systemPrompt: PLUGIN_GENERATION_SYSTEM_PROMPT,
        temperature: 0.4,
      },
    );

    // Create the plugin structure from the AI output
    return this.generatePluginStructure(result.object);
  }

  /**
   * Generate a plugin from a full definition
   */
  async generatePlugin(definition: PluginDefinition): Promise<GeneratedPlugin> {
    const pluginName = this.sanitizeName(definition.manifest.name);
    const pluginDir = join(this.options.outputDir, pluginName);
    const files: string[] = [];

    // Check if directory exists
    if (existsSync(pluginDir) && !this.options.overwrite) {
      throw new Error(`Plugin directory already exists: ${pluginDir}`);
    }

    // Create plugin directory structure
    await mkdir(pluginDir, { recursive: true });
    await mkdir(join(pluginDir, "skills"), { recursive: true });
    await mkdir(join(pluginDir, "agents"), { recursive: true });

    // Write manifest.json
    const manifestPath = join(pluginDir, "manifest.json");
    const manifestContent = JSON.stringify(definition.manifest, null, 2);
    await writeFile(manifestPath, manifestContent, "utf-8");
    files.push("manifest.json");

    // Write skills
    if (definition.skills?.length) {
      for (const skillDef of definition.skills) {
        const skillDir = join(
          pluginDir,
          "skills",
          this.sanitizeName(skillDef.skill.frontmatter.name),
        );
        await mkdir(skillDir, { recursive: true });

        // SKILL.md
        const skillMdPath = join(skillDir, "SKILL.md");
        await writeFile(skillMdPath, skillDef.markdown, "utf-8");
        files.push(
          `skills/${this.sanitizeName(skillDef.skill.frontmatter.name)}/SKILL.md`,
        );

        // Examples
        if (
          this.options.includeExamples &&
          skillDef.examples?.codeExamples?.length
        ) {
          const examplesDir = join(skillDir, "examples");
          await mkdir(examplesDir, { recursive: true });

          for (const example of skillDef.examples.codeExamples) {
            const examplePath = join(examplesDir, example.filename);
            await writeFile(examplePath, example.code, "utf-8");
            files.push(
              `skills/${this.sanitizeName(skillDef.skill.frontmatter.name)}/examples/${example.filename}`,
            );
          }
        }
      }
    }

    // Write agents
    if (definition.agents?.length) {
      for (const agentDef of definition.agents) {
        const agentDir = join(
          pluginDir,
          "agents",
          this.sanitizeName(agentDef.name),
        );
        await mkdir(agentDir, { recursive: true });

        const agentMd = this.agentGenerator.definitionToMarkdown(agentDef);
        const agentMdPath = join(agentDir, "agent.md");
        await writeFile(agentMdPath, agentMd, "utf-8");
        files.push(`agents/${this.sanitizeName(agentDef.name)}/agent.md`);
      }
    }

    // Write hooks
    if (this.options.generateHooks && definition.hooks?.length) {
      await mkdir(join(pluginDir, "hooks"), { recursive: true });

      const hooksConfig = this.generateHooksConfig(definition.hooks);
      const hooksPath = join(pluginDir, "hooks", "hooks.json");
      await writeFile(hooksPath, JSON.stringify(hooksConfig, null, 2), "utf-8");
      files.push("hooks/hooks.json");

      // Generate hook scripts
      for (const hook of definition.hooks) {
        if (hook.script) {
          const scriptPath = join(
            pluginDir,
            "hooks",
            `${this.sanitizeName(hook.name)}.sh`,
          );
          await writeFile(scriptPath, hook.script, "utf-8");
          files.push(`hooks/${this.sanitizeName(hook.name)}.sh`);
        }
      }
    }

    // Write README.md
    const readmePath = join(pluginDir, "README.md");
    const readme = definition.readme || this.generateReadme(definition);
    await writeFile(readmePath, readme, "utf-8");
    files.push("README.md");

    // Write package.json (for Node.js-based plugins)
    const packageJsonPath = join(pluginDir, "package.json");
    const packageJson = this.generatePackageJson(definition.manifest);
    await writeFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2),
      "utf-8",
    );
    files.push("package.json");

    // Write tests if requested
    if (this.options.includeTests) {
      await mkdir(join(pluginDir, "tests"), { recursive: true });

      const testContent = this.generateTestFile(definition);
      const testPath = join(pluginDir, "tests", "plugin.test.js");
      await writeFile(testPath, testContent, "utf-8");
      files.push("tests/plugin.test.js");
    }

    if (this.options.verbose) {
      console.log(
        `Generated plugin: ${definition.manifest.name} (${files.length} files)`,
      );
    }

    return {
      name: definition.manifest.name,
      path: pluginDir,
      files,
      success: true,
    };
  }

  /**
   * Generate plugin structure from AI output (scaffolding)
   */
  private async generatePluginStructure(
    output: PluginOutput,
  ): Promise<GeneratedPlugin> {
    const pluginName = this.sanitizeName(output.manifest.name);
    const pluginDir = join(this.options.outputDir, pluginName);
    const files: string[] = [];

    // Check if directory exists
    if (existsSync(pluginDir) && !this.options.overwrite) {
      throw new Error(`Plugin directory already exists: ${pluginDir}`);
    }

    // Create directory structure
    await mkdir(pluginDir, { recursive: true });
    await mkdir(join(pluginDir, "skills"), { recursive: true });
    await mkdir(join(pluginDir, "agents"), { recursive: true });

    // Write manifest.json
    const manifest: PluginManifest = {
      ...output.manifest,
      skills: output.skills.map((s) => s.name),
      agents: output.agents.map((a) => a.name),
      settings: output.settings as PluginSetting[] | undefined,
    };

    const manifestPath = join(pluginDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    files.push("manifest.json");

    // Create skill placeholders
    for (const skill of output.skills) {
      const skillDir = join(pluginDir, "skills", this.sanitizeName(skill.name));
      await mkdir(skillDir, { recursive: true });

      const skillMd = this.generateSkillPlaceholder(skill);
      const skillMdPath = join(skillDir, "SKILL.md");
      await writeFile(skillMdPath, skillMd, "utf-8");
      files.push(`skills/${this.sanitizeName(skill.name)}/SKILL.md`);
    }

    // Create agent placeholders
    for (const agent of output.agents) {
      const agentDir = join(pluginDir, "agents", this.sanitizeName(agent.name));
      await mkdir(agentDir, { recursive: true });

      const agentMd = this.generateAgentPlaceholder(agent);
      const agentMdPath = join(agentDir, "agent.md");
      await writeFile(agentMdPath, agentMd, "utf-8");
      files.push(`agents/${this.sanitizeName(agent.name)}/agent.md`);
    }

    // Create hooks if present
    if (this.options.generateHooks && output.hooks?.length) {
      await mkdir(join(pluginDir, "hooks"), { recursive: true });

      const hooks: HookDefinition[] = output.hooks.map((h) => ({
        event: h.event,
        name: h.name,
        description: h.description,
        command: `./hooks/${this.sanitizeName(h.name)}.sh`,
      }));

      const hooksConfig = this.generateHooksConfig(hooks);
      const hooksPath = join(pluginDir, "hooks", "hooks.json");
      await writeFile(hooksPath, JSON.stringify(hooksConfig, null, 2), "utf-8");
      files.push("hooks/hooks.json");

      // Create placeholder scripts
      for (const hook of output.hooks) {
        const scriptContent = this.generateHookScript(hook);
        const scriptPath = join(
          pluginDir,
          "hooks",
          `${this.sanitizeName(hook.name)}.sh`,
        );
        await writeFile(scriptPath, scriptContent, "utf-8");
        files.push(`hooks/${this.sanitizeName(hook.name)}.sh`);
      }
    }

    // Write README.md
    const readmePath = join(pluginDir, "README.md");
    await writeFile(readmePath, output.readme, "utf-8");
    files.push("README.md");

    // Write package.json
    const packageJsonPath = join(pluginDir, "package.json");
    const packageJson = this.generatePackageJson(manifest);
    await writeFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2),
      "utf-8",
    );
    files.push("package.json");

    return {
      name: output.manifest.name,
      path: pluginDir,
      files,
      success: true,
    };
  }

  /**
   * Build prompt for AI plugin generation
   */
  private buildGenerationPrompt(
    prompt: string,
    context?: {
      domain?: string;
      framework?: string;
      targetPlatform?: string;
    },
  ): string {
    let fullPrompt = `Create a comprehensive plugin package for the following request:

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
      if (context.targetPlatform)
        fullPrompt += `- Target Platform: ${context.targetPlatform}\n`;
    }

    fullPrompt += `
## Instructions
Create a complete plugin definition with:
1. A clear manifest with name, version, description
2. List of skills this plugin should provide (name, description, purpose)
3. List of agents this plugin should include (name, description, purpose)
4. Any hooks that would be useful (pre/post tool calls, notifications)
5. Settings the user can configure
6. A comprehensive README

Design the plugin to be cohesive, well-organized, and useful.`;

    return fullPrompt;
  }

  /**
   * Generate a skill placeholder markdown
   */
  private generateSkillPlaceholder(skill: {
    name: string;
    description: string;
    purpose: string;
  }): string {
    return `---
name: ${skill.name}
description: ${skill.description}
---

# ${skill.name}

${skill.description}

## Purpose

${skill.purpose}

## When to use this skill

- TODO: Add use cases

## When NOT to use this skill

- TODO: Add exclusions

## Procedure

### 1. TODO: First Step

Description of the first step.

### 2. TODO: Second Step

Description of the second step.

## Constraints

- TODO: Add constraints

## Guardrails

- TODO: Add guardrails

## Output expectations

TODO: Define expected outputs

Include these sections:
- TODO: Define output sections
`;
  }

  /**
   * Generate an agent placeholder markdown
   */
  private generateAgentPlaceholder(agent: {
    name: string;
    description: string;
    purpose: string;
  }): string {
    return `---
name: ${agent.name}
description: ${agent.description}
---

# ${agent.name}

${agent.description}

## System Prompt

You are ${agent.name}, an AI assistant that ${agent.purpose}.

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
   * Generate hooks configuration
   */
  private generateHooksConfig(
    hooks: HookDefinition[],
  ): Record<string, unknown> {
    const config: Record<string, unknown> = {};

    for (const hook of hooks) {
      const hookKey = hook.event.toLowerCase();

      if (!config[hookKey]) {
        config[hookKey] = [];
      }

      (config[hookKey] as unknown[]).push({
        name: hook.name,
        description: hook.description,
        command: hook.command,
        conditions: hook.conditions || {},
      });
    }

    return config;
  }

  /**
   * Generate a hook script placeholder
   */
  private generateHookScript(hook: {
    event: string;
    name: string;
    description: string;
    purpose: string;
  }): string {
    return `#!/usr/bin/env bash
#
# ${hook.name}
# ${hook.description}
#
# Event: ${hook.event}
# Purpose: ${hook.purpose}
#

set -e

# Read input from stdin (JSON)
INPUT=$(cat)

# TODO: Implement hook logic
# Example: Parse input JSON
# TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Output result (JSON)
echo '{"status": "success"}'
`;
  }

  /**
   * Generate README.md for a plugin
   */
  private generateReadme(definition: PluginDefinition): string {
    const lines: string[] = [];

    lines.push(`# ${definition.manifest.name}`);
    lines.push("");
    lines.push(definition.manifest.description);
    lines.push("");

    // Badges
    lines.push(
      `![Version](https://img.shields.io/badge/version-${definition.manifest.version}-blue)`,
    );
    if (definition.manifest.license) {
      lines.push(
        `![License](https://img.shields.io/badge/license-${definition.manifest.license}-green)`,
      );
    }
    lines.push("");

    // Installation
    lines.push("## Installation");
    lines.push("");
    lines.push("```bash");
    lines.push(
      `# Clone or download this plugin to your Claude Code plugins directory`,
    );
    lines.push(
      `cp -r ${this.sanitizeName(definition.manifest.name)} ~/.claude/plugins/`,
    );
    lines.push("```");
    lines.push("");

    // Skills
    if (definition.skills?.length) {
      lines.push("## Skills");
      lines.push("");
      for (const skill of definition.skills) {
        lines.push(`### ${skill.skill.frontmatter.name}`);
        lines.push("");
        lines.push(skill.skill.frontmatter.description);
        lines.push("");
        lines.push("```");
        lines.push(`/${skill.skill.frontmatter.name}`);
        lines.push("```");
        lines.push("");
      }
    }

    // Agents
    if (definition.agents?.length) {
      lines.push("## Agents");
      lines.push("");
      for (const agent of definition.agents) {
        lines.push(`### ${agent.name}`);
        lines.push("");
        lines.push(agent.description);
        lines.push("");
      }
    }

    // Hooks
    if (definition.hooks?.length) {
      lines.push("## Hooks");
      lines.push("");
      for (const hook of definition.hooks) {
        lines.push(`- **${hook.name}** (${hook.event}): ${hook.description}`);
      }
      lines.push("");
    }

    // Configuration
    if (definition.manifest.settings?.length) {
      lines.push("## Configuration");
      lines.push("");
      lines.push("| Setting | Type | Description | Default |");
      lines.push("|---------|------|-------------|---------|");
      for (const setting of definition.manifest.settings) {
        lines.push(
          `| ${setting.key} | ${setting.type} | ${setting.description || ""} | ${setting.default ?? ""} |`,
        );
      }
      lines.push("");
    }

    // Author
    if (definition.manifest.author) {
      lines.push("## Author");
      lines.push("");
      lines.push(definition.manifest.author);
      lines.push("");
    }

    // License
    if (definition.manifest.license) {
      lines.push("## License");
      lines.push("");
      lines.push(definition.manifest.license);
      lines.push("");
    }

    lines.push("---");
    lines.push("*Generated by SkillForge*");

    return lines.join("\n");
  }

  /**
   * Generate package.json for a plugin
   */
  private generatePackageJson(
    manifest: PluginManifest,
  ): Record<string, unknown> {
    return {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      license: manifest.license || "MIT",
      homepage: manifest.homepage,
      repository: manifest.repository,
      keywords: [
        ...(manifest.keywords || []),
        "claude-code",
        "plugin",
        "skillforge",
      ],
      engines: manifest.engines,
      main: "index.js",
      type: "module",
      scripts: {
        test: "node --test tests/",
        lint: 'echo "No linting configured"',
      },
      dependencies: manifest.dependencies || {},
    };
  }

  /**
   * Generate test file for a plugin
   */
  private generateTestFile(definition: PluginDefinition): string {
    return `/**
 * Tests for ${definition.manifest.name} plugin
 * Generated by SkillForge
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(__dirname, '..');

describe('${definition.manifest.name} Plugin', () => {
  it('should have a valid manifest.json', async () => {
    const manifestPath = join(pluginDir, 'manifest.json');
    const content = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);

    assert.ok(manifest.name, 'Manifest should have a name');
    assert.ok(manifest.version, 'Manifest should have a version');
    assert.ok(manifest.description, 'Manifest should have a description');
  });

${
  definition.skills
    ?.map(
      (skill) => `
  it('should have ${skill.skill.frontmatter.name} skill', async () => {
    const skillPath = join(pluginDir, 'skills', '${this.sanitizeName(skill.skill.frontmatter.name)}', 'SKILL.md');
    const content = await readFile(skillPath, 'utf-8');

    assert.ok(content.includes('---'), 'Skill should have frontmatter');
    assert.ok(content.includes('## Procedure'), 'Skill should have procedure section');
  });
`,
    )
    .join("") || ""
}

${
  definition.agents
    ?.map(
      (agent) => `
  it('should have ${agent.name} agent', async () => {
    const agentPath = join(pluginDir, 'agents', '${this.sanitizeName(agent.name)}', 'agent.md');
    const content = await readFile(agentPath, 'utf-8');

    assert.ok(content.includes('---'), 'Agent should have frontmatter');
    assert.ok(content.includes('## System Prompt'), 'Agent should have system prompt');
  });
`,
    )
    .join("") || ""
}
});
`;
  }

  /**
   * Sanitize name for filesystem
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
// SYSTEM PROMPT FOR PLUGIN GENERATION
// ============================================================================

const PLUGIN_GENERATION_SYSTEM_PROMPT = `You are an expert at designing AI agent plugins. Your task is to create comprehensive plugin packages.

When creating a plugin:
1. Give it a clear, memorable name
2. Write a compelling description
3. Design cohesive skills that work together
4. Create agents that complement the skills
5. Add hooks where they'd be genuinely useful
6. Define useful user-configurable settings

Best practices:
- Keep the plugin focused on a specific domain or use case
- Skills should be atomic and composable
- Agents should have clear roles
- Hooks should add value without being intrusive
- Settings should be minimal but useful

Output a complete, well-structured plugin definition.`;

// ============================================================================
// STANDALONE FUNCTIONS
// ============================================================================

/**
 * Generate a plugin from a prompt
 */
export async function generatePluginFromPrompt(
  prompt: string,
  gateway: AIGateway,
  options: PluginGeneratorOptions,
  context?: {
    domain?: string;
    framework?: string;
    targetPlatform?: string;
  },
): Promise<GeneratedPlugin> {
  const generator = new PluginGenerator(options, gateway);
  return generator.generateFromPrompt(prompt, context);
}

/**
 * Generate a plugin from a definition
 */
export async function generatePlugin(
  definition: PluginDefinition,
  options: PluginGeneratorOptions,
): Promise<GeneratedPlugin> {
  const generator = new PluginGenerator(options);
  return generator.generatePlugin(definition);
}
