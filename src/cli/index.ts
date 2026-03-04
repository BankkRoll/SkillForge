#!/usr/bin/env node
/**
 * SkillForge CLI
 *
 * Advanced AI-powered skill, agent, and plugin generator.
 * Supports interactive and non-interactive modes with full customization.
 *
 * @module cli
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { input, select, confirm, password } from "@inquirer/prompts";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";

import { AIGateway, getGateway } from "../gateway/index.js";
import {
  SkillGenerationPipeline,
  type PipelineEvents,
  type PipelineOptions,
} from "../agents/index.js";
import {
  UnifiedGenerator,
  SkillGenerator,
  type GeneratedSkill,
} from "../generators/index.js";
import { AgentGenerator } from "../generators/agent.js";
import { PluginGenerator } from "../generators/plugin.js";
import { Crawler, type CrawlResult } from "../utils/crawler.js";
import { RepoAnalyzer } from "../utils/repo-analyzer.js";
import {
  QualityLinter,
  formatLintReport,
  type LintResult,
} from "../utils/quality-gates.js";
import { CheckpointManager } from "../utils/checkpoint.js";
import type { SkillGenerationRequest } from "../schemas/index.js";
import {
  getConfigManager,
  maskApiKey,
  validateApiKeyFormat,
  CONFIG_DIR,
  type SkillForgeConfig,
} from "../config/index.js";

// ============================================================================
// VERSION & CONSTANTS
// ============================================================================

const VERSION = "0.1.0";

/** Default model if none specified (can be overridden via config or CLI) */
const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get API key using the config manager's priority chain:
 * 1. CLI flag (--api-key)
 * 2. Environment variable (SKILLFORGE_API_KEY or AI_GATEWAY_API_KEY)
 * 3. System keychain (if keytar installed)
 * 4. Encrypted config file (~/.skillforge/credentials.enc)
 */
async function getApiKey(explicit?: string): Promise<string> {
  const configManager = getConfigManager();
  const result = await configManager.getApiKey(explicit);

  if (!result.key) {
    console.error(chalk.red("\n✗ No API key found.\n"));
    console.error(
      chalk.yellow("Configure your API key using one of these methods:\n"),
    );
    console.error(chalk.white("  1. Interactive setup:"));
    console.error(chalk.cyan("     skillforge config init\n"));
    console.error(chalk.white("  2. Set directly:"));
    console.error(chalk.cyan("     skillforge config set apiKey\n"));
    console.error(chalk.white("  3. Environment variable:"));
    console.error(chalk.cyan("     export SKILLFORGE_API_KEY=your-key-here\n"));
    console.error(chalk.white("  4. Pass via CLI flag:"));
    console.error(
      chalk.cyan("     skillforge build --api-key your-key-here\n"),
    );
    process.exit(1);
  }

  return result.key;
}

/**
 * Get default model using config priority chain
 */
async function getDefaultModel(explicit?: string): Promise<string> {
  const configManager = getConfigManager();
  return configManager.getDefaultModel(explicit);
}

/**
 * Plans directory for saving execution plans
 */
const PLANS_DIR = join(CONFIG_DIR, "plans");

/**
 * Save a plan to disk for inspection
 */
async function savePlan(plan: unknown, prompt: string): Promise<string> {
  await mkdir(PLANS_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = prompt
    .slice(0, 30)
    .replace(/[^a-zA-Z0-9]/g, "-")
    .toLowerCase();
  const filename = `${timestamp}-${slug}.json`;
  const filepath = join(PLANS_DIR, filename);

  await writeFile(
    filepath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        prompt,
        plan,
      },
      null,
      2,
    ),
  );

  return filepath;
}

/**
 * Create progress event handlers with enhanced observability
 * - Saves plans to ~/.skillforge/plans/
 * - Shows detailed step-by-step progress
 * - Real-time logging even without verbose mode
 */
function createProgressEvents(
  spinner: ReturnType<typeof ora>,
  options: { prompt?: string; verbose?: boolean } = {},
): PipelineEvents {
  let currentSkillIndex = 0;
  let totalSkills = 0;
  let currentStep = "";
  let planFilePath = "";

  const log = (message: string) => {
    spinner.stop();
    console.log(message);
    spinner.start(currentStep);
  };

  return {
    onPlanCreated: async (plan) => {
      totalSkills = plan.skills.length;

      // Save plan to disk
      try {
        planFilePath = await savePlan(plan, options.prompt || "unknown");
      } catch {
        // Ignore save errors
      }

      spinner.succeed(
        chalk.green(`Plan created: ${plan.skills.length} skills to generate`),
      );

      // Show plan details
      console.log(
        chalk.gray(
          "\n  ┌─ Execution Plan ─────────────────────────────────────",
        ),
      );
      for (let i = 0; i < plan.skills.length; i++) {
        const skill = plan.skills[i];
        const isLast = i === plan.skills.length - 1;
        const prefix = isLast ? "  └──" : "  ├──";
        console.log(chalk.gray(`${prefix} ${chalk.white(skill.name)}`));
        if (skill.description) {
          const descPrefix = isLast ? "      " : "  │   ";
          console.log(
            chalk.gray(
              `${descPrefix}${skill.description.slice(0, 60)}${skill.description.length > 60 ? "..." : ""}`,
            ),
          );
        }
      }

      if (planFilePath) {
        console.log(chalk.gray(`\n  📄 Plan saved: ${planFilePath}`));
      }
      console.log("");

      currentStep = "Starting skill generation...";
      spinner.start(currentStep);
    },

    onSkillStart: (name) => {
      currentSkillIndex++;
      currentStep = chalk.cyan(
        `[${currentSkillIndex}/${totalSkills}] ${name}: Researching...`,
      );
      spinner.text = currentStep;

      // Log skill start
      log(
        chalk.white(
          `\n  ▶ Starting: ${chalk.bold(name)} (${currentSkillIndex}/${totalSkills})`,
        ),
      );
    },

    onResearchComplete: (name, research) => {
      currentStep = chalk.cyan(
        `[${currentSkillIndex}/${totalSkills}] ${name}: Writing skill...`,
      );
      spinner.text = currentStep;

      // Show research summary
      if (research && research.workflows) {
        log(
          chalk.gray(
            `    ├─ Research: ${research.workflows.length} workflows found`,
          ),
        );
      } else {
        log(chalk.gray(`    ├─ Research: Complete`));
      }
    },

    onSkillWritten: (name) => {
      currentStep = chalk.cyan(
        `[${currentSkillIndex}/${totalSkills}] ${name}: Generating examples...`,
      );
      spinner.text = currentStep;
      log(chalk.gray(`    ├─ Skill written`));
    },

    onExamplesGenerated: (name, examples) => {
      currentStep = chalk.cyan(
        `[${currentSkillIndex}/${totalSkills}] ${name}: Running QA...`,
      );
      spinner.text = currentStep;

      const exampleCount = examples?.codeExamples?.length || 0;
      log(chalk.gray(`    ├─ Examples: ${exampleCount} generated`));
    },

    onQAComplete: (_name, qa) => {
      const scoreColor =
        qa.overallScore >= 80
          ? chalk.green
          : qa.overallScore >= 60
            ? chalk.yellow
            : chalk.red;
      const passIcon = qa.passed ? chalk.green("✓") : chalk.red("✗");

      log(
        chalk.gray(
          `    └─ QA: ${passIcon} Score ${scoreColor(qa.overallScore)}/100`,
        ),
      );

      // Show QA details if there are issues
      if (qa.issues && qa.issues.length > 0 && options.verbose) {
        for (const issue of qa.issues.slice(0, 3)) {
          log(chalk.gray(`       ⚠ ${issue.severity}: ${issue.description}`));
        }
      }
    },

    onSkillComplete: (name, passed) => {
      const status = passed
        ? chalk.green("✓ passed")
        : chalk.yellow("⚠ needs review");
      const progress = Math.round((currentSkillIndex / totalSkills) * 100);

      spinner.succeed(chalk.white(`  ${name}: ${status} [${progress}%]`));

      if (currentSkillIndex < totalSkills) {
        currentStep = "Continuing to next skill...";
        spinner.start(currentStep);
      }
    },

    onProgress: (current, _total, message) => {
      const progressBar = createProgressBar(current, 100);
      currentStep = chalk.cyan(`${progressBar} ${message}`);
      spinner.text = currentStep;
    },
  };
}

/**
 * Create a simple text progress bar
 */
function createProgressBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(empty));
  return `[${bar}] ${percent}%`;
}

// ============================================================================
// COMMANDS
// ============================================================================

async function buildCommand(options: {
  prompt?: string;
  output?: string;
  domain?: string;
  framework?: string;
  language?: string;
  model?: string;
  apiKey?: string;
  parallel?: boolean;
  examples?: boolean;
  skipQa?: boolean;
  verbose?: boolean;
  interactive?: boolean;
  webSearch?: boolean;
  maxSearchResults?: number;
}): Promise<void> {
  console.log(chalk.bold.cyan("\n🔨 SkillForge Build\n"));

  // Get prompt
  let prompt = options.prompt;
  if (!prompt) {
    if (options.interactive !== false) {
      prompt = await input({
        message: "What skills do you want to generate?",
        validate: (value) => value.length > 0 || "Please enter a prompt",
      });
    } else {
      console.error(
        chalk.red("Error: --prompt is required in non-interactive mode"),
      );
      process.exit(1);
    }
  }

  // Get output directory
  const outputDir = resolve(options.output || "./output");

  // Build request
  const request: SkillGenerationRequest = {
    prompt,
    target: {
      domain: options.domain,
      framework: options.framework,
      language: options.language,
    },
    options: {
      generateExamples: options.examples !== false,
    },
  };

  // Initialize gateway with configured model
  const apiKey = await getApiKey(options.apiKey);
  const model = await getDefaultModel(options.model);

  // Initialize the gateway with configured model
  getGateway({
    apiKey,
    defaultModel: model,
  });

  // Create pipeline with model configuration
  const pipelineOptions: PipelineOptions = {
    generateExamples: options.examples !== false,
    runQA: !options.skipQa, // Skip QA for faster/cheaper generation
    parallel: options.parallel || false,
    qualityThreshold: 70,
    useWebSearch: options.webSearch !== false,
    maxSearchResults: options.maxSearchResults ?? 10,
    model,
  };

  // Create skill generator for immediate file writing
  const skillGenerator = new SkillGenerator({
    outputDir,
    overwrite: true,
    createExamples: options.examples !== false,
    verbose: options.verbose,
  });

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // Track written skills
  const writtenSkills: GeneratedSkill[] = [];
  let totalFiles = 0;

  const spinner = ora("Initializing...").start();
  const baseEvents = createProgressEvents(spinner, {
    prompt,
    verbose: options.verbose,
  });

  // Add onSkillReady to write files immediately
  const events: PipelineEvents = {
    ...baseEvents,
    onSkillReady: async (skillData) => {
      // Write skill files immediately as each skill completes
      try {
        const generated = await skillGenerator.generateSkill(
          skillData.skill,
          skillData.markdown,
          skillData.examples,
        );
        writtenSkills.push(generated);
        totalFiles += generated.files.length;

        // Log the write
        spinner.stop();
        console.log(chalk.green(`    📁 Written: ${generated.path}`));
        spinner.start();
      } catch (error) {
        spinner.stop();
        console.log(
          chalk.red(
            `    ⚠ Failed to write: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        spinner.start();
      }
    },
  };

  const pipeline = new SkillGenerationPipeline(
    {
      onStart: (agent) => {
        if (options.verbose) {
          console.log(chalk.gray(`  Agent started: ${agent.name}`));
        }
      },
      onComplete: (agent, result) => {
        if (options.verbose) {
          console.log(
            chalk.gray(
              `  Agent complete: ${agent.name} (${result.duration}ms)`,
            ),
          );
        }
      },
    },
    events,
    pipelineOptions,
  );

  try {
    spinner.text = "Creating execution plan...";
    const result = await pipeline.run(request);

    spinner.stop();

    if (result.success) {
      console.log(chalk.green("\n✓ Generation complete!"));
      console.log(chalk.white(`  Skills: ${result.skills.length}`));
      console.log(
        chalk.white(`  Tokens: ${result.totalTokens.toLocaleString()}`),
      );
      console.log(
        chalk.white(`  Duration: ${(result.totalDuration / 1000).toFixed(1)}s`),
      );

      // Files already written incrementally, just show summary
      console.log(chalk.green(`\n✓ Files written to ${outputDir}`));
      console.log(chalk.white(`  Total files: ${totalFiles}`));

      // List generated skills
      console.log(chalk.cyan("\nGenerated skills:"));
      for (const skill of writtenSkills) {
        const status = skill.success ? chalk.green("✓") : chalk.red("✗");
        console.log(`  ${status} ${skill.name}`);
        if (options.verbose && skill.files.length) {
          for (const file of skill.files) {
            console.log(chalk.gray(`      ${file}`));
          }
        }
      }
    } else {
      console.log(chalk.red("\n✗ Generation failed"));
      for (const error of result.errors) {
        console.log(chalk.red(`  - ${error}`));
      }
      // Still show any skills that were written before failure
      if (writtenSkills.length > 0) {
        console.log(
          chalk.yellow(
            `\n  ${writtenSkills.length} skills were written before failure:`,
          ),
        );
        for (const skill of writtenSkills) {
          console.log(chalk.yellow(`    - ${skill.name}`));
        }
      }
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(chalk.red("Generation failed"));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    // Still show any skills that were written before failure
    if (writtenSkills.length > 0) {
      console.log(
        chalk.yellow(
          `\n${writtenSkills.length} skills were written before failure:`,
        ),
      );
      for (const skill of writtenSkills) {
        console.log(chalk.yellow(`  - ${skill.name}`));
      }
    }
    process.exit(1);
  }
}

async function agentCommand(options: {
  prompt?: string;
  output?: string;
  name?: string;
  model?: string;
  apiKey?: string;
  verbose?: boolean;
  interactive?: boolean;
}): Promise<void> {
  console.log(chalk.bold.cyan("\n🤖 SkillForge Agent Generator\n"));

  // Get prompt
  let prompt = options.prompt;
  if (!prompt) {
    if (options.interactive !== false) {
      prompt = await input({
        message: "Describe the agent you want to create:",
        validate: (value) => value.length > 0 || "Please enter a description",
      });
    } else {
      console.error(
        chalk.red("Error: --prompt is required in non-interactive mode"),
      );
      process.exit(1);
    }
  }

  const outputDir = resolve(options.output || "./output/agents");
  const apiKey = await getApiKey(options.apiKey);
  const model = await getDefaultModel(options.model);

  const gateway = getGateway({
    apiKey,
    defaultModel: model,
  });

  const spinner = ora("Generating agent...").start();

  try {
    const generator = new AgentGenerator(
      { outputDir, verbose: options.verbose },
      gateway,
    );
    const result = await generator.generateFromPrompt(prompt);

    spinner.succeed(chalk.green("Agent generated!"));
    console.log(chalk.white(`\n  Name: ${result.name}`));
    console.log(chalk.white(`  Path: ${result.path}`));
    console.log(chalk.cyan("\n  Files:"));
    for (const file of result.files) {
      console.log(chalk.gray(`    ${file}`));
    }
  } catch (error) {
    spinner.fail(chalk.red("Generation failed"));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

async function pluginCommand(options: {
  prompt?: string;
  output?: string;
  name?: string;
  model?: string;
  apiKey?: string;
  verbose?: boolean;
  interactive?: boolean;
}): Promise<void> {
  console.log(chalk.bold.cyan("\n📦 SkillForge Plugin Generator\n"));

  // Get prompt
  let prompt = options.prompt;
  if (!prompt) {
    if (options.interactive !== false) {
      prompt = await input({
        message: "Describe the plugin you want to create:",
        validate: (value) => value.length > 0 || "Please enter a description",
      });
    } else {
      console.error(
        chalk.red("Error: --prompt is required in non-interactive mode"),
      );
      process.exit(1);
    }
  }

  const outputDir = resolve(options.output || "./output/plugins");
  const apiKey = await getApiKey(options.apiKey);
  const model = await getDefaultModel(options.model);

  const gateway = getGateway({
    apiKey,
    defaultModel: model,
  });

  const spinner = ora("Generating plugin...").start();

  try {
    const generator = new PluginGenerator(
      { outputDir, verbose: options.verbose },
      gateway,
    );
    const result = await generator.generateFromPrompt(prompt);

    spinner.succeed(chalk.green("Plugin generated!"));
    console.log(chalk.white(`\n  Name: ${result.name}`));
    console.log(chalk.white(`  Path: ${result.path}`));
    console.log(chalk.cyan("\n  Files:"));
    for (const file of result.files) {
      console.log(chalk.gray(`    ${file}`));
    }
  } catch (error) {
    spinner.fail(chalk.red("Generation failed"));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

async function interactiveCommand(): Promise<void> {
  console.log(chalk.bold.cyan("\n✨ SkillForge Interactive Mode\n"));

  const configManager = getConfigManager();
  const config = await configManager.getConfig();

  const mode = await select({
    message: "What do you want to create?",
    choices: [
      { value: "skills", name: "🔧 Skills - Generate SKILL.md files" },
      { value: "agent", name: "🤖 Agent - Create an AI agent definition" },
      { value: "plugin", name: "📦 Plugin - Build a complete plugin package" },
    ],
  });

  const prompt = await input({
    message:
      mode === "skills"
        ? "Describe the skills you want to generate:"
        : mode === "agent"
          ? "Describe the agent you want to create:"
          : "Describe the plugin you want to build:",
    validate: (value) => value.length > 0 || "Please enter a description",
  });

  // Target options for skills
  let domain: string | undefined;
  let framework: string | undefined;
  let language: string | undefined;

  if (mode === "skills") {
    const addTarget = await confirm({
      message: "Do you want to specify target framework/language?",
      default: false,
    });

    if (addTarget) {
      domain =
        (await input({
          message: "Domain (e.g., web, mobile, backend):",
          default: "",
        })) || undefined;
      framework =
        (await input({
          message: "Framework (e.g., React, Django):",
          default: "",
        })) || undefined;
      language =
        (await input({
          message: "Language (e.g., TypeScript, Python):",
          default: "",
        })) || undefined;
    }
  }

  const outputDir = await input({
    message: "Output directory:",
    default: "./output",
  });

  // Model selection
  const customizeModel = await confirm({
    message: "Customize AI model?",
    default: false,
  });

  let model: string | undefined;
  if (customizeModel) {
    model = await select({
      message: "Select AI model:",
      choices: [
        {
          value: "anthropic/claude-sonnet-4",
          name: "Claude Sonnet 4 (Anthropic)",
        },
        { value: "anthropic/claude-opus-4", name: "Claude Opus 4 (Anthropic)" },
        {
          value: "anthropic/claude-haiku",
          name: "Claude Haiku (Anthropic - Fast)",
        },
        { value: "openai/gpt-4o", name: "GPT-4o (OpenAI)" },
        { value: "openai/gpt-4o-mini", name: "GPT-4o Mini (OpenAI - Fast)" },
        { value: "google/gemini-pro", name: "Gemini Pro (Google)" },
        { value: "custom", name: "Enter custom model..." },
      ],
    });

    if (model === "custom") {
      model = await input({
        message: "Enter model ID (provider/model):",
        default: config.defaultModel || DEFAULT_MODEL,
        validate: (v) =>
          v.includes("/") || "Model must be in format: provider/model",
      });
    }
  }

  const generateExamples = await confirm({
    message: "Generate code examples?",
    default: true,
  });

  const useWebSearch = await confirm({
    message: "Use web search for up-to-date research?",
    default: true,
  });

  const verbose = await confirm({
    message: "Verbose output?",
    default: false,
  });

  console.log("");

  // Run the appropriate command
  switch (mode) {
    case "skills":
      await buildCommand({
        prompt,
        output: outputDir,
        domain,
        framework,
        language,
        model,
        examples: generateExamples,
        webSearch: useWebSearch,
        verbose,
        interactive: false,
      });
      break;
    case "agent":
      await agentCommand({
        prompt,
        output: outputDir,
        model,
        verbose,
        interactive: false,
      });
      break;
    case "plugin":
      await pluginCommand({
        prompt,
        output: outputDir,
        model,
        verbose,
        interactive: false,
      });
      break;
  }
}

async function crawlCommand(options: {
  url?: string;
  output?: string;
  depth?: number;
  maxPages?: number;
  js?: boolean;
  verbose?: boolean;
  generateSkills?: boolean;
  model?: string;
}): Promise<void> {
  console.log(chalk.bold.cyan("\n🌐 SkillForge URL Crawler\n"));

  // Get URL
  let url = options.url;
  if (!url) {
    url = await input({
      message: "Enter the URL to crawl:",
      validate: (value) => {
        try {
          new URL(value);
          return true;
        } catch {
          return "Please enter a valid URL";
        }
      },
    });
  }

  const spinner = ora("Crawling URL...").start();

  try {
    const crawler = new Crawler({
      maxDepth: options.depth ?? 1,
      extractLinks: true,
      includeImages: false,
    });

    let result: CrawlResult;

    if (options.js) {
      spinner.text = "Crawling with JavaScript rendering...";
      result = await crawler.crawlWithPlaywright(url);
    } else {
      result = await crawler.crawl(url);
    }

    if (!result.success) {
      spinner.fail(chalk.red(`Crawl failed: ${result.error}`));
      process.exit(1);
    }

    spinner.succeed(chalk.green("Crawl complete!"));

    console.log(chalk.white(`\n  Title: ${result.title}`));
    console.log(chalk.white(`  URL: ${result.url}`));
    if (result.description) {
      console.log(
        chalk.white(`  Description: ${result.description.slice(0, 100)}...`),
      );
    }
    console.log(
      chalk.white(`  Content length: ${result.markdown.length} characters`),
    );
    console.log(chalk.white(`  Links found: ${result.links.length}`));

    // Save output
    if (options.output) {
      const outputDir = resolve(options.output);
      await mkdir(outputDir, { recursive: true });

      // Save markdown
      const mdPath = join(outputDir, "content.md");
      await writeFile(mdPath, result.markdown, "utf-8");
      console.log(chalk.green(`\n✓ Content saved to ${mdPath}`));

      // Save metadata
      const metaPath = join(outputDir, "metadata.json");
      await writeFile(
        metaPath,
        JSON.stringify(
          {
            url: result.url,
            title: result.title,
            description: result.description,
            metadata: result.metadata,
            links: result.links,
            crawledAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf-8",
      );
      console.log(chalk.green(`✓ Metadata saved to ${metaPath}`));
    }

    // Generate skills from content
    if (options.generateSkills) {
      console.log(
        chalk.cyan("\n🔨 Generating skills from crawled content...\n"),
      );

      const apiKey = await getApiKey();
      const model = await getDefaultModel(options.model);
      // Initialize gateway with model for pipeline
      new AIGateway({
        apiKey,
        defaultModel: model,
      });

      const prompt = `Generate skills based on the following documentation/content from ${url}:

Title: ${result.title}
Description: ${result.description || "N/A"}

Content:
${result.markdown.slice(0, 50000)}

Create comprehensive skills that cover the main functionality and workflows described in this documentation.`;

      const request: SkillGenerationRequest = {
        prompt,
        sources: [{ type: "url", path: url }],
      };

      const skillSpinner = ora("Generating skills...").start();
      const pipeline = new SkillGenerationPipeline(
        {},
        createProgressEvents(skillSpinner, {
          prompt,
          verbose: options.verbose,
        }),
      );

      try {
        const pipelineResult = await pipeline.run(request);

        if (pipelineResult.success) {
          const outputDir = resolve(options.output || "./output");
          const generator = new UnifiedGenerator({
            outputDir,
            verbose: options.verbose,
          });
          await generator.generateFromPipeline(pipelineResult);

          skillSpinner.succeed(
            chalk.green(`Generated ${pipelineResult.skills.length} skills!`),
          );
        } else {
          skillSpinner.fail(chalk.red("Skill generation failed"));
        }
      } catch (error) {
        skillSpinner.fail(chalk.red("Skill generation failed"));
        if (options.verbose) {
          console.error(error);
        }
      }
    }
  } catch (error) {
    spinner.fail(chalk.red("Crawl failed"));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

async function analyzeCommand(options: {
  path?: string;
  output?: string;
  patterns?: boolean;
  dependencies?: boolean;
  verbose?: boolean;
  generateSkills?: boolean;
  model?: string;
}): Promise<void> {
  console.log(chalk.bold.cyan("\n📊 SkillForge Repository Analyzer\n"));

  // Get path
  let repoPath = options.path;
  if (!repoPath) {
    repoPath = await input({
      message: "Enter the repository path:",
      default: ".",
      validate: (value) => existsSync(resolve(value)) || "Path does not exist",
    });
  }

  const spinner = ora("Analyzing repository...").start();

  try {
    const analyzer = new RepoAnalyzer({
      extractPatterns: options.patterns !== false,
      analyzeDependencies: options.dependencies !== false,
    });

    const result = await analyzer.analyze(repoPath);

    spinner.succeed(chalk.green("Analysis complete!"));

    // Display summary
    console.log(chalk.cyan("\n📋 Summary"));
    console.log(chalk.white(`  Total Files: ${result.summary.totalFiles}`));
    console.log(
      chalk.white(
        `  Total Lines: ${result.summary.totalLines.toLocaleString()}`,
      ),
    );
    console.log(
      chalk.white(`  Primary Language: ${result.summary.primaryLanguage}`),
    );
    console.log(chalk.white(`  Codebase Size: ${result.summary.codebaseSize}`));
    console.log(chalk.white(`  Project Type: ${result.structure.type}`));

    // Languages
    console.log(chalk.cyan("\n📝 Languages"));
    const sortedLangs = Object.entries(result.languages)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    for (const [lang, count] of sortedLangs) {
      const bar = "█".repeat(
        Math.min(20, Math.round((count / result.summary.totalFiles) * 20)),
      );
      console.log(chalk.white(`  ${lang.padEnd(15)} ${bar} ${count}`));
    }

    // Frameworks
    if (result.frameworks.length > 0) {
      console.log(chalk.cyan("\n🔧 Frameworks Detected"));
      for (const framework of result.frameworks) {
        console.log(chalk.white(`  • ${framework}`));
      }
    }

    // Patterns summary
    if (result.patterns.length > 0) {
      console.log(chalk.cyan("\n🔍 Code Patterns"));
      const patternsByType = result.patterns.reduce(
        (acc, p) => {
          acc[p.type] = (acc[p.type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      for (const [type, count] of Object.entries(patternsByType)) {
        console.log(chalk.white(`  ${type}: ${count}`));
      }
    }

    // Save report
    if (options.output) {
      const outputDir = resolve(options.output);
      await mkdir(outputDir, { recursive: true });

      // Save full report
      const reportPath = join(outputDir, "analysis-report.md");
      const report = analyzer.generateReport(result);
      await writeFile(reportPath, report, "utf-8");
      console.log(chalk.green(`\n✓ Report saved to ${reportPath}`));

      // Save JSON data
      const dataPath = join(outputDir, "analysis-data.json");
      await writeFile(dataPath, JSON.stringify(result, null, 2), "utf-8");
      console.log(chalk.green(`✓ Data saved to ${dataPath}`));
    }

    // Generate skills from analysis
    if (options.generateSkills) {
      console.log(chalk.cyan("\n🔨 Generating skills from analysis...\n"));

      const apiKey = await getApiKey();
      const model = await getDefaultModel(options.model);
      // Initialize gateway with model for pipeline
      new AIGateway({
        apiKey,
        defaultModel: model,
      });

      const prompt = `Generate skills for working with this codebase:

## Summary
- Primary Language: ${result.summary.primaryLanguage}
- Frameworks: ${result.frameworks.join(", ") || "None detected"}
- Project Type: ${result.structure.type}
- Total Files: ${result.summary.totalFiles}

## Code Patterns Found
${result.patterns
  .slice(0, 50)
  .map((p) => `- ${p.type}: ${p.name} (${p.file})`)
  .join("\n")}

## Key Dependencies
${result.dependencies
  .filter((d) => d.type === "production")
  .slice(0, 20)
  .map((d) => `- ${d.name}`)
  .join("\n")}

Create skills that help developers work effectively with this codebase, including common workflows, best practices, and patterns specific to the technologies used.`;

      const request: SkillGenerationRequest = {
        prompt,
        target: {
          language: result.summary.primaryLanguage,
          framework: result.frameworks[0],
        },
      };

      const skillSpinner = ora("Generating skills...").start();
      const pipeline = new SkillGenerationPipeline(
        {},
        createProgressEvents(skillSpinner, {
          prompt,
          verbose: options.verbose,
        }),
      );

      try {
        const pipelineResult = await pipeline.run(request);

        if (pipelineResult.success) {
          const outputDir = resolve(options.output || "./output");
          const generator = new UnifiedGenerator({
            outputDir,
            verbose: options.verbose,
          });
          await generator.generateFromPipeline(pipelineResult);

          skillSpinner.succeed(
            chalk.green(`Generated ${pipelineResult.skills.length} skills!`),
          );
        } else {
          skillSpinner.fail(chalk.red("Skill generation failed"));
        }
      } catch (error) {
        skillSpinner.fail(chalk.red("Skill generation failed"));
        if (options.verbose) {
          console.error(error);
        }
      }
    }
  } catch (error) {
    spinner.fail(chalk.red("Analysis failed"));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

async function lintCommand(options: {
  path?: string;
  verbose?: boolean;
  fix?: boolean;
}): Promise<void> {
  console.log(chalk.bold.cyan("\n🔍 SkillForge Quality Linter\n"));

  // Get path
  let targetPath = options.path;
  if (!targetPath) {
    targetPath = await input({
      message: "Enter the file or directory path to lint:",
      default: ".",
      validate: (value) => existsSync(resolve(value)) || "Path does not exist",
    });
  }

  const spinner = ora("Linting...").start();

  try {
    const linter = new QualityLinter({
      failOnError: true,
      failOnWarning: false,
    });

    const resolvedPath = resolve(targetPath);
    let results: Map<string, LintResult>;

    // Check if it's a file or directory
    const stats = await import("fs").then(
      (fs) =>
        new Promise<import("fs").Stats>((resolve, reject) =>
          fs.stat(resolvedPath, (err, stats) =>
            err ? reject(err) : resolve(stats),
          ),
        ),
    );

    if (stats.isDirectory()) {
      results = await linter.lintDirectory(resolvedPath);
    } else {
      const result = await linter.lintFile(resolvedPath);
      results = new Map([[resolvedPath, result]]);
    }

    spinner.stop();

    let allPassed = true;
    let totalErrors = 0;
    let totalWarnings = 0;

    for (const [filePath, result] of results) {
      console.log(chalk.cyan(`\n📄 ${filePath}`));
      console.log(formatLintReport(result, options.verbose));

      if (!result.passed) allPassed = false;
      totalErrors += result.summary.errors;
      totalWarnings += result.summary.warnings;
    }

    // Summary
    console.log(chalk.cyan("\n📊 Summary"));
    console.log(chalk.white(`  Files checked: ${results.size}`));
    console.log(chalk.white(`  Total errors: ${totalErrors}`));
    console.log(chalk.white(`  Total warnings: ${totalWarnings}`));

    if (allPassed) {
      console.log(chalk.green("\n✓ All quality checks passed!"));
    } else {
      console.log(chalk.red("\n✗ Some quality checks failed"));
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(chalk.red("Linting failed"));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

async function checkpointCommand(action: string, id?: string): Promise<void> {
  const manager = new CheckpointManager();

  switch (action) {
    case "list": {
      const checkpoints = await manager.list();

      if (checkpoints.length === 0) {
        console.log(chalk.yellow("No checkpoints found."));
        return;
      }

      console.log(chalk.bold.cyan("\n📋 Checkpoints\n"));
      console.log(
        chalk.gray(
          "ID".padEnd(30) +
            "Status".padEnd(15) +
            "Progress".padEnd(12) +
            "Created",
        ),
      );
      console.log(chalk.gray("-".repeat(80)));

      for (const cp of checkpoints) {
        const statusColor =
          cp.status === "completed"
            ? chalk.green
            : cp.status === "failed"
              ? chalk.red
              : cp.status === "paused"
                ? chalk.yellow
                : chalk.cyan;

        console.log(
          cp.id.padEnd(30) +
            statusColor(cp.status.padEnd(15)) +
            `${cp.percentComplete}%`.padEnd(12) +
            new Date(cp.createdAt).toLocaleString(),
        );
      }
      break;
    }

    case "show": {
      if (!id) {
        console.error(chalk.red("Usage: skillforge checkpoint show <id>"));
        process.exit(1);
      }

      const checkpoint = await manager.load(id);
      if (!checkpoint) {
        console.error(chalk.red(`Checkpoint not found: ${id}`));
        process.exit(1);
      }

      console.log(chalk.bold.cyan("\n📋 Checkpoint Details\n"));
      console.log(chalk.white(`ID: ${checkpoint.id}`));
      console.log(chalk.white(`Status: ${checkpoint.status}`));
      console.log(
        chalk.white(`Progress: ${checkpoint.progress.percentComplete}%`),
      );
      console.log(
        chalk.white(`Current Step: ${checkpoint.progress.currentStep}`),
      );
      console.log(chalk.white(`Created: ${checkpoint.createdAt}`));
      console.log(chalk.white(`Updated: ${checkpoint.updatedAt}`));
      console.log(
        chalk.white(`Tokens Used: ${checkpoint.metrics.totalTokens}`),
      );
      console.log(chalk.white(`API Calls: ${checkpoint.metrics.apiCalls}`));

      if (checkpoint.state.skills?.length) {
        console.log(chalk.cyan("\nSkills:"));
        for (const skill of checkpoint.state.skills) {
          const icon =
            skill.status === "completed"
              ? chalk.green("✓")
              : skill.status === "failed"
                ? chalk.red("✗")
                : skill.status === "in_progress"
                  ? chalk.cyan("→")
                  : chalk.gray("○");
          console.log(`  ${icon} ${skill.name} (${skill.status})`);
        }
      }

      if (checkpoint.state.errors?.length) {
        console.log(chalk.red("\nErrors:"));
        for (const error of checkpoint.state.errors) {
          console.log(chalk.red(`  - ${error}`));
        }
      }
      break;
    }

    case "resume": {
      let checkpoint;

      if (id) {
        checkpoint = await manager.load(id);
      } else {
        checkpoint = await manager.getResumable();
      }

      if (!checkpoint) {
        console.log(chalk.yellow("No resumable checkpoint found."));
        return;
      }

      console.log(chalk.cyan(`\nResuming checkpoint: ${checkpoint.id}`));
      console.log(
        chalk.white(`Progress: ${checkpoint.progress.percentComplete}%`),
      );
      console.log(
        chalk.white(`Current step: ${checkpoint.progress.currentStep}`),
      );

      // TODO: Actually resume the pipeline
      console.log(chalk.yellow("\nResume functionality not yet implemented."));
      break;
    }

    case "delete": {
      if (!id) {
        console.error(chalk.red("Usage: skillforge checkpoint delete <id>"));
        process.exit(1);
      }

      const deleted = await manager.delete(id);
      if (deleted) {
        console.log(chalk.green(`Checkpoint deleted: ${id}`));
      } else {
        console.error(chalk.red(`Checkpoint not found: ${id}`));
        process.exit(1);
      }
      break;
    }

    case "clean": {
      const checkpoints = await manager.list();
      let deleted = 0;

      for (const cp of checkpoints) {
        if (cp.status === "completed" || cp.status === "failed") {
          await manager.delete(cp.id);
          deleted++;
        }
      }

      console.log(
        chalk.green(`Cleaned up ${deleted} completed/failed checkpoints.`),
      );
      break;
    }

    default:
      console.error(chalk.red(`Unknown action: ${action}`));
      console.log(
        chalk.yellow("Available actions: list, show, resume, delete, clean"),
      );
      process.exit(1);
  }
}

async function configCommand(
  action: string,
  key?: string,
  value?: string,
  options: { keychain?: boolean } = {},
): Promise<void> {
  const configManager = getConfigManager();

  switch (action) {
    case "init": {
      console.log(chalk.bold.cyan("\n⚙️  SkillForge Configuration Setup\n"));

      // Check if keychain is available
      const keychainAvailable = await configManager.isKeychainAvailable();
      if (keychainAvailable) {
        console.log(
          chalk.green("✓ System keychain available for secure storage\n"),
        );
      } else {
        console.log(
          chalk.yellow(
            "ℹ Keychain not available - using encrypted file storage",
          ),
        );
        console.log(
          chalk.gray(
            "  Install 'keytar' for system keychain support: npm install keytar\n",
          ),
        );
      }

      // API Key
      const existingKey = await configManager.getApiKey();
      if (existingKey.key) {
        const replace = await confirm({
          message: `API key already configured (${maskApiKey(existingKey.key)}). Replace it?`,
          default: false,
        });
        if (!replace) {
          console.log(chalk.gray("Keeping existing API key.\n"));
        } else {
          const apiKey = await password({
            message: "Enter your AI Gateway API key:",
            mask: "*",
            validate: (v) => {
              if (!v) return "API key is required";
              if (!validateApiKeyFormat(v)) return "Invalid API key format";
              return true;
            },
          });
          const useKeychain =
            keychainAvailable &&
            (await confirm({
              message: "Store in system keychain (more secure)?",
              default: true,
            }));
          await configManager.set("apiKey", apiKey, useKeychain);
          console.log(chalk.green("✓ API key saved securely\n"));
        }
      } else {
        const apiKey = await password({
          message: "Enter your AI Gateway API key:",
          mask: "*",
          validate: (v) => {
            if (!v) return "API key is required";
            if (!validateApiKeyFormat(v)) return "Invalid API key format";
            return true;
          },
        });
        const useKeychain =
          keychainAvailable &&
          (await confirm({
            message: "Store in system keychain (more secure)?",
            default: true,
          }));
        await configManager.set("apiKey", apiKey, useKeychain);
        console.log(chalk.green("✓ API key saved securely\n"));
      }

      // Default model
      const model = await select({
        message: "Select default AI model:",
        choices: [
          {
            value: "anthropic/claude-sonnet-4",
            name: "Claude Sonnet 4 (Recommended)",
          },
          {
            value: "anthropic/claude-opus-4",
            name: "Claude Opus 4 (Most capable)",
          },
          { value: "anthropic/claude-haiku", name: "Claude Haiku (Fast)" },
          { value: "openai/gpt-4o", name: "GPT-4o (OpenAI)" },
          { value: "openai/gpt-4o-mini", name: "GPT-4o Mini (OpenAI - Fast)" },
          { value: "google/gemini-pro", name: "Gemini Pro (Google)" },
        ],
      });
      await configManager.set("defaultModel", model);
      console.log(chalk.green(`✓ Default model set to ${model}\n`));

      // Web search
      const useWebSearch = await confirm({
        message: "Enable web search for up-to-date research?",
        default: true,
      });
      await configManager.set("useWebSearch", useWebSearch);

      if (useWebSearch) {
        const hasSerperKey = await confirm({
          message: "Do you have a Serper API key for web search?",
          default: false,
        });
        if (hasSerperKey) {
          const serperKey = await password({
            message: "Enter your Serper API key:",
            mask: "*",
          });
          if (serperKey) {
            await configManager.set(
              "serperApiKey",
              serperKey,
              keychainAvailable,
            );
            console.log(chalk.green("✓ Serper API key saved\n"));
          }
        }
      }

      console.log(chalk.bold.green("\n✓ Configuration complete!\n"));
      console.log(
        chalk.white("Run 'skillforge config show' to view your configuration."),
      );
      console.log(
        chalk.white(
          "Run 'skillforge build --prompt \"...\"' to generate skills.\n",
        ),
      );
      break;
    }

    case "get": {
      if (!key) {
        console.error(chalk.red("Usage: skillforge config get <key>"));
        process.exit(1);
      }
      const value = await configManager.get(key as keyof SkillForgeConfig);
      if (value === undefined) {
        console.log(chalk.yellow("(not set)"));
      } else {
        // Mask sensitive values
        const sensitiveKeys = ["apiKey", "serperApiKey", "tavilyApiKey"];
        if (sensitiveKeys.includes(key) && typeof value === "string") {
          console.log(maskApiKey(value));
        } else {
          console.log(value);
        }
      }
      break;
    }

    case "set": {
      if (!key) {
        console.error(chalk.red("Usage: skillforge config set <key> [value]"));
        console.error(chalk.yellow("\nAvailable keys:"));
        console.error(
          "  apiKey         - AI Gateway API key (will prompt for secure input)",
        );
        console.error(
          "  defaultModel   - Default model (e.g., anthropic/claude-sonnet-4)",
        );
        console.error("  outputDir      - Default output directory");
        console.error("  useWebSearch   - Enable web search (true/false)");
        console.error("  serperApiKey   - Serper API key for web search");
        console.error("  tavilyApiKey   - Tavily API key for web search");
        process.exit(1);
      }

      const sensitiveKeys = ["apiKey", "serperApiKey", "tavilyApiKey"];
      let finalValue: string | boolean = value || "";

      if (sensitiveKeys.includes(key)) {
        // Prompt for sensitive values with masked input
        if (!value) {
          finalValue = await password({
            message: `Enter ${key}:`,
            mask: "*",
            validate: (v) => v.length > 0 || "Value is required",
          });
        } else {
          finalValue = value;
        }
      } else if (key === "useWebSearch" || key === "verbose") {
        // Boolean values
        finalValue = value === "true" || value === "1" || value === "yes";
      } else if (!value) {
        // Prompt for non-sensitive values
        finalValue = await input({
          message: `Enter ${key}:`,
          validate: (v) => v.length > 0 || "Value is required",
        });
      }

      const useKeychain = options.keychain && sensitiveKeys.includes(key);
      await configManager.set(
        key as keyof SkillForgeConfig,
        finalValue,
        useKeychain,
      );

      if (sensitiveKeys.includes(key) && typeof finalValue === "string") {
        console.log(chalk.green(`✓ ${key} set to ${maskApiKey(finalValue)}`));
      } else {
        console.log(chalk.green(`✓ ${key} set to ${finalValue}`));
      }
      break;
    }

    case "show":
    case "list": {
      console.log(chalk.bold.cyan("\n⚙️  SkillForge Configuration\n"));

      const sources = await configManager.getAllWithSources();

      if (sources.length === 0) {
        console.log(chalk.yellow("No configuration found."));
        console.log(
          chalk.white(
            "\nRun 'skillforge config init' to set up configuration.",
          ),
        );
      } else {
        console.log(
          chalk.gray("KEY".padEnd(20) + "VALUE".padEnd(40) + "SOURCE"),
        );
        console.log(chalk.gray("-".repeat(70)));

        for (const source of sources) {
          const sourceColor =
            source.source === "env"
              ? chalk.yellow
              : source.source === "keychain"
                ? chalk.green
                : source.source === "flag"
                  ? chalk.cyan
                  : source.source === "file"
                    ? chalk.white
                    : chalk.gray;

          console.log(
            chalk.white(source.key.padEnd(20)) +
              (source.value || chalk.gray("(not set)")).toString().padEnd(40) +
              sourceColor(source.source),
          );
        }

        console.log(chalk.gray("\n-".repeat(70)));
        console.log(
          chalk.gray(
            "Sources: env=environment, keychain=system keychain, file=config file, flag=CLI flag",
          ),
        );
      }
      console.log("");
      break;
    }

    case "delete":
    case "unset": {
      if (!key) {
        console.error(chalk.red("Usage: skillforge config delete <key>"));
        process.exit(1);
      }
      await configManager.delete(key as keyof SkillForgeConfig);
      console.log(chalk.green(`✓ ${key} deleted`));
      break;
    }

    case "path": {
      console.log(CONFIG_DIR);
      break;
    }

    default:
      console.error(chalk.red(`Unknown action: ${action}`));
      console.log(chalk.yellow("\nAvailable actions:"));
      console.log("  init           - Interactive setup wizard");
      console.log("  set <key>      - Set a configuration value");
      console.log("  get <key>      - Get a configuration value");
      console.log("  show           - Show all configuration with sources");
      console.log("  delete <key>   - Delete a configuration value");
      console.log("  path           - Show configuration directory path");
      process.exit(1);
  }
}

// ============================================================================
// MAIN CLI
// ============================================================================

const program = new Command();

program
  .name("skillforge")
  .description(
    "AI-powered skill, agent, and plugin generator for Claude Code and 40+ AI coding agents",
  )
  .version(VERSION);

// Build command (default)
program
  .command("build")
  .description("Generate skills from a prompt")
  .option("-p, --prompt <prompt>", "The prompt describing skills to generate")
  .option("-o, --output <dir>", "Output directory", "./output")
  .option("-d, --domain <domain>", "Target domain (e.g., web, mobile, backend)")
  .option(
    "-f, --framework <framework>",
    "Target framework (e.g., React, Django)",
  )
  .option(
    "-l, --language <language>",
    "Target language (e.g., TypeScript, Python)",
  )
  .option("-m, --model <model>", "AI model to use")
  .option("-k, --api-key <key>", "API key (overrides config)")
  .option("--parallel", "Process skills in parallel")
  .option("--no-examples", "Skip generating code examples (faster)")
  .option("--skip-qa", "Skip QA review step (faster, cheaper)")
  .option(
    "--no-web-search",
    "Disable web search for research (uses model knowledge only)",
  )
  .option(
    "--max-search-results <number>",
    "Maximum web search results per query",
    "10",
  )
  .option("-v, --verbose", "Verbose output")
  .option("--no-interactive", "Disable interactive prompts")
  .action((opts) =>
    buildCommand({
      ...opts,
      maxSearchResults: opts.maxSearchResults
        ? parseInt(opts.maxSearchResults, 10)
        : undefined,
    }),
  );

// Agent command
program
  .command("agent")
  .description("Generate an AI agent definition")
  .option("-p, --prompt <prompt>", "The prompt describing the agent")
  .option("-o, --output <dir>", "Output directory", "./output/agents")
  .option("-n, --name <name>", "Agent name")
  .option("-m, --model <model>", "AI model to use")
  .option("-k, --api-key <key>", "API key (overrides config)")
  .option("-v, --verbose", "Verbose output")
  .option("--no-interactive", "Disable interactive prompts")
  .action(agentCommand);

// Plugin command
program
  .command("plugin")
  .description("Generate a complete plugin package")
  .option("-p, --prompt <prompt>", "The prompt describing the plugin")
  .option("-o, --output <dir>", "Output directory", "./output/plugins")
  .option("-n, --name <name>", "Plugin name")
  .option("-m, --model <model>", "AI model to use")
  .option("-k, --api-key <key>", "API key (overrides config)")
  .option("-v, --verbose", "Verbose output")
  .option("--no-interactive", "Disable interactive prompts")
  .action(pluginCommand);

// Interactive mode
program
  .command("interactive")
  .alias("i")
  .description("Interactive mode with guided prompts")
  .action(interactiveCommand);

// Crawl command
program
  .command("crawl")
  .description("Crawl a URL and extract content for skill generation")
  .option("-u, --url <url>", "URL to crawl")
  .option("-o, --output <dir>", "Output directory for crawled content")
  .option("-d, --depth <number>", "Maximum crawl depth", "1")
  .option("--max-pages <number>", "Maximum pages to crawl", "10")
  .option("--js", "Use Playwright for JavaScript-rendered content")
  .option("-v, --verbose", "Verbose output")
  .option("--generate-skills", "Generate skills from crawled content")
  .option("-m, --model <model>", "AI model to use", DEFAULT_MODEL)
  .action((opts) =>
    crawlCommand({
      ...opts,
      depth: parseInt(opts.depth, 10),
      maxPages: parseInt(opts.maxPages, 10),
    }),
  );

// Analyze command
program
  .command("analyze")
  .description("Analyze a repository and extract patterns")
  .option("-p, --path <path>", "Repository path to analyze")
  .option("-o, --output <dir>", "Output directory for analysis report")
  .option("--no-patterns", "Skip pattern extraction")
  .option("--no-dependencies", "Skip dependency analysis")
  .option("-v, --verbose", "Verbose output")
  .option("--generate-skills", "Generate skills from analysis")
  .option("-m, --model <model>", "AI model to use", DEFAULT_MODEL)
  .action(analyzeCommand);

// Lint command
program
  .command("lint")
  .description("Lint and validate generated skills, agents, or plugins")
  .option("-p, --path <path>", "File or directory path to lint")
  .option("-v, --verbose", "Show detailed lint output")
  .option("--fix", "Attempt to fix issues automatically")
  .action(lintCommand);

// Checkpoint command
program
  .command("checkpoint <action> [id]")
  .description(
    "Manage generation checkpoints (list, show, resume, delete, clean)",
  )
  .action(checkpointCommand);

// Config command
program
  .command("config <action> [key] [value]")
  .description("Manage configuration (init, set, get, show, delete, path)")
  .option("--keychain", "Store sensitive values in system keychain")
  .action((action, key, value, options) =>
    configCommand(action, key, value, options),
  );

// Default to interactive if no command
program.action(interactiveCommand);

// Parse and run
program.parse();
