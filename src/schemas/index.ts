/**
 * SkillForge Schemas
 * Zod schemas for validating skills, agents, plugins, and hooks
 */

import { z } from "zod";

// ============================================================================
// SKILL SCHEMA
// ============================================================================

export const SkillFrontmatterSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, "Name must be lowercase with hyphens")
    .max(64, "Name must be 64 characters or less"),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(500, "Description must be 500 characters or less"),

  // Display & Invocation
  "argument-hint": z.string().optional(),
  "disable-model-invocation": z.boolean().optional(),
  "user-invocable": z.boolean().optional(),

  // Execution Environment
  "allowed-tools": z.string().optional(), // Comma-separated or single tool
  model: z.enum(["sonnet", "opus", "haiku", "inherit"]).optional(),
  context: z.enum(["fork"]).optional(),
  agent: z.string().optional(),

  // Hooks
  hooks: z
    .record(
      z.array(
        z.object({
          matcher: z.string().optional(),
          hooks: z.array(
            z.object({
              type: z.enum(["command", "http", "prompt", "agent"]),
              command: z.string().optional(),
              url: z.string().optional(),
              prompt: z.string().optional(),
              timeout: z.number().optional(),
            }),
          ),
        }),
      ),
    )
    .optional(),

  // Metadata
  metadata: z
    .object({
      internal: z.boolean().optional(),
    })
    .optional(),

  // Additional fields
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  tags: z.array(z.string()).optional(),
  author: z.string().optional(),
});

export const SkillBodySchema = z.object({
  title: z.string().optional(),
  whenToUse: z.array(z.string()).optional(),
  whenNotToUse: z.array(z.string()).optional(),
  procedure: z
    .array(
      z.object({
        step: z.number(),
        title: z.string(),
        description: z.string(),
        code: z.string().optional(),
      }),
    )
    .optional(),
  constraints: z.array(z.string()).optional(),
  guardrails: z.array(z.string()).optional(),
  outputFormat: z.string().optional(),
  examples: z
    .array(
      z.object({
        title: z.string().optional(),
        input: z.string(),
        output: z.string(),
      }),
    )
    .optional(),
  resources: z
    .array(
      z.object({
        type: z.enum(["script", "reference", "example", "asset"]),
        path: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

export const SkillSchema = z.object({
  frontmatter: SkillFrontmatterSchema,
  body: SkillBodySchema,
  rawBody: z.string(), // The actual markdown content
});

export type Skill = z.infer<typeof SkillSchema>;
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
export type SkillBody = z.infer<typeof SkillBodySchema>;

// ============================================================================
// AGENT SCHEMA
// ============================================================================

export const AgentFrontmatterSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, "Name must be lowercase with hyphens"),
  description: z.string().min(10, "Description must be at least 10 characters"),

  // Tool Access
  tools: z.string().optional(), // Comma-separated tools
  disallowedTools: z.string().optional(),

  // Model
  model: z.enum(["sonnet", "opus", "haiku", "inherit"]).optional(),

  // Permission Mode
  permissionMode: z
    .enum(["default", "acceptEdits", "dontAsk", "bypassPermissions", "plan"])
    .optional(),

  // Limits
  maxTurns: z.number().min(1).max(100).optional(),

  // Skills Preloading
  skills: z.array(z.string()).optional(),

  // MCP Servers
  mcpServers: z
    .record(
      z.union([
        z.object({}), // Reference existing
        z.object({
          command: z.string(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string()).optional(),
        }),
      ]),
    )
    .optional(),

  // Hooks
  hooks: z.record(z.array(z.any())).optional(),

  // Persistent Memory
  memory: z.enum(["user", "project", "local"]).optional(),

  // Execution Mode
  background: z.boolean().optional(),
  isolation: z.enum(["worktree"]).optional(),
});

export const AgentSchema = z.object({
  frontmatter: AgentFrontmatterSchema,
  systemPrompt: z.string(),
});

export type Agent = z.infer<typeof AgentSchema>;
export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;

// ============================================================================
// PLUGIN SCHEMA
// ============================================================================

export const PluginManifestSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, "Name must be lowercase with hyphens"),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  description: z.string(),
  author: z
    .object({
      name: z.string(),
      email: z.string().email().optional(),
      url: z.string().url().optional(),
    })
    .optional(),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),

  // Component paths
  commands: z.union([z.string(), z.array(z.string())]).optional(),
  agents: z.union([z.string(), z.array(z.string())]).optional(),
  skills: z.union([z.string(), z.array(z.string())]).optional(),
  hooks: z
    .union([z.string(), z.array(z.string()), z.record(z.any())])
    .optional(),
  mcpServers: z
    .union([z.string(), z.array(z.string()), z.record(z.any())])
    .optional(),
  lspServers: z
    .union([z.string(), z.array(z.string()), z.record(z.any())])
    .optional(),
  outputStyles: z.union([z.string(), z.array(z.string())]).optional(),
});

export const PluginSchema = z.object({
  manifest: PluginManifestSchema,
  skills: z.array(SkillSchema).optional(),
  agents: z.array(AgentSchema).optional(),
  hooks: z.record(z.array(z.any())).optional(),
});

export type Plugin = z.infer<typeof PluginSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// ============================================================================
// HOOKS SCHEMA
// ============================================================================

export const HookEventSchema = z.enum([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "TeammateIdle",
  "TaskCompleted",
  "ConfigChange",
  "PreCompact",
  "SessionEnd",
]);

export const HookHandlerSchema = z.object({
  type: z.enum(["command", "http", "prompt", "agent"]),
  command: z.string().optional(),
  url: z.string().url().optional(),
  prompt: z.string().optional(),
  timeout: z.number().optional(),
  async: z.boolean().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
  headers: z.record(z.string()).optional(),
  allowedEnvVars: z.array(z.string()).optional(),
  model: z.string().optional(),
});

export const HookMatcherSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(HookHandlerSchema),
});

export const HooksConfigSchema = z.object({
  hooks: z.record(HookEventSchema, z.array(HookMatcherSchema)),
});

export type HookEvent = z.infer<typeof HookEventSchema>;
export type HookHandler = z.infer<typeof HookHandlerSchema>;
export type HookMatcher = z.infer<typeof HookMatcherSchema>;
export type HooksConfig = z.infer<typeof HooksConfigSchema>;

// ============================================================================
// GENERATION REQUEST SCHEMAS
// ============================================================================

export const SkillGenerationRequestSchema = z.object({
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  target: z
    .object({
      domain: z.string().optional(),
      product: z.string().optional(),
      framework: z.string().optional(),
      runtime: z.string().optional(),
      language: z.string().optional(),
    })
    .optional(),
  scope: z
    .object({
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .optional(),
  sources: z
    .array(
      z.object({
        type: z.enum(["url", "repo", "file", "openapi"]),
        path: z.string(),
      }),
    )
    .optional(),
  options: z
    .object({
      generateExamples: z.boolean().optional(),
      generateScripts: z.boolean().optional(),
      generateReferences: z.boolean().optional(),
      strict: z.boolean().optional(),
      /** Enable web search for up-to-date research (default: true) */
      useWebSearch: z.boolean().optional(),
      /** Maximum number of web search results (default: 10) */
      maxSearchResults: z.number().min(1).max(50).optional(),
    })
    .optional(),
});

export const AgentGenerationRequestSchema = z.object({
  prompt: z.string().min(10),
  role: z.string().optional(),
  tools: z.array(z.string()).optional(),
  model: z.enum(["sonnet", "opus", "haiku", "inherit"]).optional(),
  options: z
    .object({
      withMemory: z.boolean().optional(),
      withHooks: z.boolean().optional(),
    })
    .optional(),
});

export const PluginGenerationRequestSchema = z.object({
  prompt: z.string().min(10),
  name: z.string().optional(),
  components: z
    .object({
      skills: z.boolean().optional(),
      agents: z.boolean().optional(),
      hooks: z.boolean().optional(),
      mcpServers: z.boolean().optional(),
    })
    .optional(),
  sources: z
    .array(
      z.object({
        type: z.enum(["url", "repo", "file", "openapi"]),
        path: z.string(),
      }),
    )
    .optional(),
});

export type SkillGenerationRequest = z.infer<
  typeof SkillGenerationRequestSchema
>;
export type AgentGenerationRequest = z.infer<
  typeof AgentGenerationRequestSchema
>;
export type PluginGenerationRequest = z.infer<
  typeof PluginGenerationRequestSchema
>;

// ============================================================================
// CONFIG SCHEMA
// ============================================================================

export const SkillForgeConfigSchema = z.object({
  // AI Gateway settings
  gateway: z
    .object({
      defaultModel: z.string().default("anthropic/claude-sonnet-4"),
      fallbackModels: z.array(z.string()).optional(),
      apiKey: z.string().optional(),
      providerOrder: z.array(z.string()).optional(),
    })
    .optional(),

  // Generation settings
  generation: z
    .object({
      maxIterations: z.number().min(1).max(10).default(3),
      qualityThreshold: z.number().min(0).max(1).default(0.8),
      timeoutMs: z.number().default(300000), // 5 minutes
    })
    .optional(),

  // Web Search settings
  webSearch: z
    .object({
      /** Enable web search for research (default: true) */
      enabled: z.boolean().default(true),
      /** Maximum search results per query (default: 10) */
      maxResults: z.number().min(1).max(50).default(10),
      /** Preferred search provider: 'serper' | 'tavily' (auto-detected from env) */
      provider: z.enum(["serper", "tavily", "auto"]).default("auto"),
      /** Search recency filter */
      recencyFilter: z.enum(["day", "week", "month", "year", "any"]).optional(),
    })
    .optional(),

  // Output settings
  output: z
    .object({
      directory: z.string().default("./generated"),
      format: z
        .enum(["claude-plugin", "skills-sh", "generic"])
        .default("claude-plugin"),
    })
    .optional(),

  // Packs (framework presets)
  packs: z.array(z.string()).optional(),
});

export type SkillForgeConfig = z.infer<typeof SkillForgeConfigSchema>;
