/**
 * SkillForge Skill Generator
 * Creates SKILL.md files and folder structures from pipeline output
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { PipelineResult } from "../agents/index.js";
import type { SkillOutput } from "../agents/skill-writer.js";
import type {
  ExamplesOutput,
  CodeExample,
} from "../agents/example-generator.js";

// ============================================================================
// TYPES
// ============================================================================

export interface SkillGeneratorOptions {
  outputDir: string;
  overwrite?: boolean;
  createExamples?: boolean;
  createScripts?: boolean;
  createReferences?: boolean;
  verbose?: boolean;
}

export interface GeneratedSkill {
  name: string;
  path: string;
  files: string[];
  success: boolean;
  error?: string;
}

export interface GenerationResult {
  skills: GeneratedSkill[];
  totalFiles: number;
  outputDir: string;
  success: boolean;
  errors: string[];
}

// ============================================================================
// SKILL GENERATOR
// ============================================================================

export class SkillGenerator {
  private options: Required<SkillGeneratorOptions>;

  constructor(options: SkillGeneratorOptions) {
    this.options = {
      outputDir: options.outputDir,
      overwrite: options.overwrite ?? false,
      createExamples: options.createExamples ?? true,
      createScripts: options.createScripts ?? true,
      createReferences: options.createReferences ?? true,
      verbose: options.verbose ?? false,
    };
  }

  /**
   * Generate all skills from pipeline result
   */
  async generateFromPipeline(
    result: PipelineResult,
  ): Promise<GenerationResult> {
    const generatedSkills: GeneratedSkill[] = [];
    const errors: string[] = [];
    let totalFiles = 0;

    // Create base output directory
    await mkdir(this.options.outputDir, { recursive: true });

    for (const skillResult of result.skills) {
      if (!skillResult.passed && !this.options.overwrite) {
        errors.push(`Skipping ${skillResult.name}: QA not passed`);
        continue;
      }

      try {
        const generated = await this.generateSkill(
          skillResult.skill,
          skillResult.markdown,
          skillResult.examples,
        );

        generatedSkills.push(generated);
        totalFiles += generated.files.length;

        if (this.options.verbose) {
          console.log(
            `Generated skill: ${skillResult.name} (${generated.files.length} files)`,
          );
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to generate ${skillResult.name}: ${errorMsg}`);
        generatedSkills.push({
          name: skillResult.name,
          path: "",
          files: [],
          success: false,
          error: errorMsg,
        });
      }
    }

    return {
      skills: generatedSkills,
      totalFiles,
      outputDir: this.options.outputDir,
      success: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate a single skill with its folder structure
   */
  async generateSkill(
    skill: SkillOutput,
    markdown: string,
    examples?: ExamplesOutput,
  ): Promise<GeneratedSkill> {
    const skillName = this.sanitizeName(skill.frontmatter.name);
    const skillDir = join(this.options.outputDir, skillName);
    const files: string[] = [];

    // Check if directory exists
    if (existsSync(skillDir) && !this.options.overwrite) {
      throw new Error(`Skill directory already exists: ${skillDir}`);
    }

    // Create skill directory structure
    await mkdir(skillDir, { recursive: true });

    // Write SKILL.md
    const skillMdPath = join(skillDir, "SKILL.md");
    await writeFile(skillMdPath, markdown, "utf-8");
    files.push("SKILL.md");

    // Create subdirectories and files
    if (this.options.createExamples && examples?.codeExamples?.length) {
      const examplesDir = join(skillDir, "examples");
      await mkdir(examplesDir, { recursive: true });

      for (const example of examples.codeExamples) {
        const examplePath = join(examplesDir, example.filename);
        await writeFile(examplePath, this.formatExample(example), "utf-8");
        files.push(`examples/${example.filename}`);
      }
    }

    // Templates
    if (examples?.templates?.length) {
      const templatesDir = join(skillDir, "templates");
      await mkdir(templatesDir, { recursive: true });

      for (const template of examples.templates) {
        const templatePath = join(templatesDir, template.filename);
        await writeFile(templatePath, template.content, "utf-8");
        files.push(`templates/${template.filename}`);
      }
    }

    // Scripts
    if (this.options.createScripts && examples?.scripts?.length) {
      const scriptsDir = join(skillDir, "scripts");
      await mkdir(scriptsDir, { recursive: true });

      for (const script of examples.scripts) {
        const scriptPath = join(scriptsDir, script.filename);
        const content = this.formatScript(script);
        await writeFile(scriptPath, content, "utf-8");
        files.push(`scripts/${script.filename}`);
      }
    }

    // References
    if (this.options.createReferences && examples?.references?.length) {
      const refsDir = join(skillDir, "references");
      await mkdir(refsDir, { recursive: true });

      for (const ref of examples.references) {
        const refPath = join(refsDir, ref.filename);
        const content = this.formatReference(ref);
        await writeFile(refPath, content, "utf-8");
        files.push(`references/${ref.filename}`);
      }
    }

    // Resources from skill output
    if (skill.resources?.length) {
      for (const resource of skill.resources) {
        const resourceDir = join(skillDir, `${resource.type}s`);
        await mkdir(resourceDir, { recursive: true });

        if (resource.content) {
          const resourcePath = join(resourceDir, resource.filename);
          await writeFile(resourcePath, resource.content, "utf-8");
          files.push(`${resource.type}s/${resource.filename}`);
        }
      }
    }

    // Create README.md for the skill
    const readmePath = join(skillDir, "README.md");
    const readme = this.generateReadme(skill, examples);
    await writeFile(readmePath, readme, "utf-8");
    files.push("README.md");

    return {
      name: skill.frontmatter.name,
      path: skillDir,
      files,
      success: true,
    };
  }

  /**
   * Format a code example with header comments
   */
  private formatExample(example: CodeExample): string {
    const lines: string[] = [];
    const commentStyle = this.getCommentStyle(example.language);

    // Header
    lines.push(`${commentStyle.start}`);
    lines.push(`${commentStyle.line} ${example.description}`);
    if (example.inputs?.length) {
      lines.push(`${commentStyle.line}`);
      lines.push(`${commentStyle.line} Inputs:`);
      for (const input of example.inputs) {
        lines.push(
          `${commentStyle.line}   - ${input.name}: ${input.description}`,
        );
        lines.push(`${commentStyle.line}     Example: ${input.example}`);
      }
    }
    if (example.expectedOutput) {
      lines.push(`${commentStyle.line}`);
      lines.push(
        `${commentStyle.line} Expected Output: ${example.expectedOutput}`,
      );
    }
    if (example.notes?.length) {
      lines.push(`${commentStyle.line}`);
      lines.push(`${commentStyle.line} Notes:`);
      for (const note of example.notes) {
        lines.push(`${commentStyle.line}   - ${note}`);
      }
    }
    lines.push(`${commentStyle.end}`);
    lines.push("");

    // Code
    lines.push(example.code);

    return lines.join("\n");
  }

  /**
   * Format a script with usage header
   */
  private formatScript(script: {
    filename: string;
    description: string;
    language: string;
    content: string;
    usage: string;
  }): string {
    const lines: string[] = [];

    // Shebang for bash/python
    if (script.language === "bash") {
      lines.push("#!/usr/bin/env bash");
    } else if (script.language === "python") {
      lines.push("#!/usr/bin/env python3");
    }

    const commentStyle = this.getCommentStyle(script.language);

    lines.push(`${commentStyle.start}`);
    lines.push(`${commentStyle.line} ${script.description}`);
    lines.push(`${commentStyle.line}`);
    lines.push(`${commentStyle.line} Usage: ${script.usage}`);
    lines.push(`${commentStyle.end}`);
    lines.push("");
    lines.push(script.content);

    return lines.join("\n");
  }

  /**
   * Format a reference document as markdown
   */
  private formatReference(ref: {
    filename: string;
    title: string;
    content: string;
    sections: Array<{ heading: string; content: string }>;
  }): string {
    const lines: string[] = [];

    lines.push(`# ${ref.title}`);
    lines.push("");
    lines.push(ref.content);
    lines.push("");

    for (const section of ref.sections) {
      lines.push(`## ${section.heading}`);
      lines.push("");
      lines.push(section.content);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Generate README.md for a skill
   */
  private generateReadme(
    skill: SkillOutput,
    examples?: ExamplesOutput,
  ): string {
    const lines: string[] = [];

    lines.push(`# ${skill.frontmatter.name}`);
    lines.push("");
    lines.push(skill.frontmatter.description);
    lines.push("");

    // Tags
    if (skill.frontmatter.tags?.length) {
      lines.push(`**Tags:** ${skill.frontmatter.tags.join(", ")}`);
      lines.push("");
    }

    // Version
    if (skill.frontmatter.version) {
      lines.push(`**Version:** ${skill.frontmatter.version}`);
      lines.push("");
    }

    // When to use
    lines.push("## When to Use");
    lines.push("");
    for (const item of skill.sections.whenToUse) {
      lines.push(`- ${item}`);
    }
    lines.push("");

    // Quick start
    lines.push("## Quick Start");
    lines.push("");
    lines.push("```");
    lines.push(`# Invoke this skill`);
    lines.push(`/${skill.frontmatter.name}`);
    lines.push("```");
    lines.push("");

    // Procedure overview
    lines.push("## Procedure Overview");
    lines.push("");
    for (const step of skill.sections.procedure) {
      lines.push(
        `${step.step}. **${step.title}**: ${step.description.slice(0, 100)}...`,
      );
    }
    lines.push("");

    // Files
    lines.push("## Included Files");
    lines.push("");
    lines.push("- `SKILL.md` - Main skill definition");

    if (examples?.codeExamples?.length) {
      lines.push(
        `- \`examples/\` - ${examples.codeExamples.length} code examples`,
      );
    }
    if (examples?.templates?.length) {
      lines.push(`- \`templates/\` - ${examples.templates.length} templates`);
    }
    if (examples?.scripts?.length) {
      lines.push(`- \`scripts/\` - ${examples.scripts.length} helper scripts`);
    }
    if (examples?.references?.length) {
      lines.push(
        `- \`references/\` - ${examples.references.length} reference documents`,
      );
    }
    lines.push("");

    // Generated by
    lines.push("---");
    lines.push("*Generated by SkillForge*");

    return lines.join("\n");
  }

  /**
   * Get comment style for a language
   */
  private getCommentStyle(language: string): {
    start: string;
    line: string;
    end: string;
  } {
    const styles: Record<string, { start: string; line: string; end: string }> =
      {
        javascript: { start: "/**", line: " *", end: " */" },
        typescript: { start: "/**", line: " *", end: " */" },
        python: { start: '"""', line: "", end: '"""' },
        bash: { start: "#", line: "#", end: "#" },
        ruby: { start: "#", line: "#", end: "#" },
        go: { start: "/*", line: " *", end: " */" },
        rust: { start: "///", line: "///", end: "///" },
        java: { start: "/**", line: " *", end: " */" },
        csharp: { start: "///", line: "///", end: "///" },
        php: { start: "/**", line: " *", end: " */" },
      };

    return styles[language.toLowerCase()] || styles.javascript;
  }

  /**
   * Sanitize skill name for filesystem
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
// STANDALONE FUNCTIONS
// ============================================================================

/**
 * Generate skills from pipeline result
 */
export async function generateSkills(
  result: PipelineResult,
  options: SkillGeneratorOptions,
): Promise<GenerationResult> {
  const generator = new SkillGenerator(options);
  return generator.generateFromPipeline(result);
}

/**
 * Generate a single skill from skill output
 */
export async function generateSingleSkill(
  skill: SkillOutput,
  markdown: string,
  outputDir: string,
  examples?: ExamplesOutput,
): Promise<GeneratedSkill> {
  const generator = new SkillGenerator({ outputDir });
  return generator.generateSkill(skill, markdown, examples);
}
