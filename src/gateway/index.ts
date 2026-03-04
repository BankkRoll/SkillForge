/**
 * SkillForge AI Gateway
 *
 * Pure AI SDK gateway abstraction - no provider-specific packages.
 * Uses gateway("provider/model") pattern for fully interchangeable models.
 * Supports web search via external APIs (Serper, Tavily).
 *
 * API Key Priority (when using getGateway() without explicit key):
 * 1. Explicit apiKey parameter
 * 2. SKILLFORGE_API_KEY environment variable
 * 3. AI_GATEWAY_API_KEY environment variable (legacy)
 * 4. System keychain (if keytar installed)
 * 5. Encrypted config file (~/.skillforge/credentials.enc)
 *
 * @example
 * ```typescript
 * // Using config system (recommended)
 * const gateway = getGateway();
 * const result = await gateway.generate('Hello, world!');
 *
 * // Or with explicit config
 * const gateway = new AIGateway({
 *   apiKey: 'your-api-key',
 *   defaultModel: 'anthropic/claude-sonnet-4',
 * });
 * ```
 *
 * @module gateway
 */

import { generateText, streamText, generateObject } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import type { z } from "zod";
import { getConfigManager } from "../config/index.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration options for the AI Gateway.
 * All models are configurable - no hardcoded values.
 */
export interface GatewayConfig {
  /** API key for the gateway service */
  apiKey?: string;
  /** Default model to use (e.g., 'anthropic/claude-sonnet-4', 'openai/gpt-4o') */
  defaultModel?: string;
  /** Fallback models if primary fails */
  fallbackModels?: string[];
  /** Provider priority order */
  providerOrder?: string[];
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/** Options for text generation */
export interface GenerateOptions {
  /** Model to use (overrides default) */
  model?: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature for randomness (0-1) */
  temperature?: number;
  /** System prompt to set context */
  systemPrompt?: string;
  /** Sequences that stop generation */
  stopSequences?: string[];
}

/** Options for streaming generation */
export interface StreamOptions extends GenerateOptions {
  /** Callback for each chunk */
  onChunk?: (chunk: string) => void;
  /** Callback for tool calls */
  onToolCall?: (name: string, args: unknown) => void;
  /** Callback when generation finishes */
  onFinish?: (text: string, usage: TokenUsage) => void;
}

/** Token usage statistics */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Options for web search */
export interface WebSearchOptions {
  /** Search provider preference */
  provider?: "serper" | "tavily" | "auto";
  /** Maximum search results */
  maxResults?: number;
  /** Maximum tokens for search response */
  maxTokens?: number;
  /** Filter results by recency */
  searchRecencyFilter?: "day" | "week" | "month" | "year";
  /** Filter results by domain */
  searchDomainFilter?: string[];
  /** Country for search localization */
  country?: string;
}

/** Result from web search generation */
export interface WebSearchResult {
  text: string;
  sources: Array<{
    title?: string;
    url?: string;
    snippet?: string;
  }>;
  usage: TokenUsage;
}

/** Result from text generation */
export interface GenerateResult {
  text: string;
  usage: TokenUsage;
  finishReason: string;
  model: string;
  cost?: string;
}

/** Result from structured generation */
export interface StructuredResult<T> {
  object: T;
  usage: TokenUsage;
  finishReason: string;
}

// ============================================================================
// AI GATEWAY CLASS
// ============================================================================

/**
 * AI Gateway for model-agnostic LLM interactions.
 * Provides a unified interface for text generation, structured output,
 * streaming, and web search across any supported provider.
 */
export class AIGateway {
  private gateway: ReturnType<typeof createGateway>;
  private config: Required<GatewayConfig>;

  constructor(config: GatewayConfig = {}) {
    // Resolve API key from config or environment
    // Priority: explicit > SKILLFORGE_API_KEY > AI_GATEWAY_API_KEY (legacy)
    const apiKey =
      config.apiKey ||
      process.env.SKILLFORGE_API_KEY ||
      process.env.AI_GATEWAY_API_KEY ||
      "";

    // Resolve default model from config or environment
    const defaultModel =
      config.defaultModel ||
      process.env.SKILLFORGE_DEFAULT_MODEL ||
      "anthropic/claude-sonnet-4";

    this.config = {
      apiKey,
      defaultModel,
      fallbackModels: config.fallbackModels || [],
      providerOrder: config.providerOrder || ["anthropic", "openai", "google"],
      maxRetries: config.maxRetries || 3,
      timeout: config.timeout || 120000,
    };

    this.gateway = createGateway({
      apiKey: this.config.apiKey,
    });
  }

  /**
   * Get the model instance from model string.
   * Uses type assertion to handle AI SDK version compatibility.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getModel(model?: string): any {
    const modelId = model || this.config.defaultModel;
    return this.gateway(modelId);
  }

  /**
   * Get the model string (for reporting)
   */
  private getModelId(model?: string): string {
    return model || this.config.defaultModel;
  }

  /**
   * Generate text (non-streaming)
   */
  async generate(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<GenerateResult> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const result = await generateText({
      model: this.getModel(options.model),
      messages,
      temperature: options.temperature,
      stopSequences: options.stopSequences,
      maxRetries: this.config.maxRetries,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = result.usage as any;
    return {
      text: result.text,
      usage: {
        inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
        outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      },
      finishReason: result.finishReason,
      model: this.getModelId(options.model),
    };
  }

  /**
   * Generate text with streaming
   */
  async *stream(
    prompt: string,
    options: StreamOptions = {},
  ): AsyncGenerator<string, GenerateResult> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = streamText({
      model: this.getModel(options.model),
      messages,
      temperature: options.temperature,
      stopSequences: options.stopSequences,
      maxRetries: this.config.maxRetries,
      onChunk: ({ chunk }: { chunk: { type: string; textDelta?: string } }) => {
        if (chunk.type === "text-delta" && options.onChunk && chunk.textDelta) {
          options.onChunk(chunk.textDelta);
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onFinish: async ({ text, usage }: { text: string; usage: any }) => {
        if (options.onFinish) {
          options.onFinish(text, {
            inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
            outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
            totalTokens: usage.totalTokens ?? 0,
          });
        }
      },
    });

    let fullText = "";
    for await (const chunk of result.textStream) {
      fullText += chunk;
      yield chunk;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = (await result.usage) as any;
    const finishReason = await result.finishReason;

    return {
      text: fullText,
      usage: {
        inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
        outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      },
      finishReason,
      model: this.getModelId(options.model),
    };
  }

  /**
   * Generate structured object with Zod schema validation
   */
  async generateStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options: GenerateOptions & {
      schemaName?: string;
      schemaDescription?: string;
    } = {},
  ): Promise<StructuredResult<T>> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const result = await generateObject({
      model: this.getModel(options.model),
      messages,
      schema,
      temperature: options.temperature ?? 0.2,
      maxRetries: this.config.maxRetries,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = result.usage as any;
    return {
      object: result.object as T,
      usage: {
        inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
        outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      },
      finishReason: result.finishReason,
    };
  }

  /**
   * Generate an array of structured objects
   */
  async generateArray<T>(
    prompt: string,
    elementSchema: z.ZodSchema<T>,
    options: GenerateOptions = {},
  ): Promise<StructuredResult<T[]>> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    // Use generateObject with array schema wrapped
    const { z } = await import("zod");
    const arraySchema = z.array(elementSchema);

    const result = await generateObject({
      model: this.getModel(options.model),
      messages,
      schema: arraySchema,
      temperature: options.temperature ?? 0.2,
      maxRetries: this.config.maxRetries,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = result.usage as any;
    return {
      object: result.object as T[],
      usage: {
        inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
        outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      },
      finishReason: result.finishReason,
    };
  }

  /**
   * Generate a choice from options using enum schema
   */
  async generateChoice<T extends string>(
    prompt: string,
    choices: readonly T[],
    options: GenerateOptions = {},
  ): Promise<StructuredResult<T>> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const { z } = await import("zod");
    const choiceSchema = z.object({
      choice: z.enum(choices as [T, ...T[]]),
    });

    const result = await generateObject({
      model: this.getModel(options.model),
      messages,
      schema: choiceSchema,
      temperature: options.temperature ?? 0.1,
      maxRetries: this.config.maxRetries,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = result.usage as any;
    return {
      object: result.object.choice as T,
      usage: {
        inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
        outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      },
      finishReason: result.finishReason,
    };
  }

  /**
   * Generate with web search using external search API.
   * Searches first, then uses results as context for generation.
   */
  async generateWithWebSearch(
    prompt: string,
    options: GenerateOptions & WebSearchOptions = {},
  ): Promise<WebSearchResult> {
    const searchQuery = prompt.slice(0, 200);
    const searchResults = await this.performWebSearch(searchQuery, options);

    const searchContext =
      searchResults.length > 0
        ? `\n\nRelevant information from web search:\n${searchResults
            .map(
              (r, i) =>
                `[${i + 1}] ${r.title || "Source"}\n${r.snippet || ""}\nURL: ${r.url || "N/A"}`,
            )
            .join("\n\n")}`
        : "";

    const messages: Array<{ role: "system" | "user"; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt + searchContext });

    const result = await generateText({
      model: this.getModel(options.model),
      messages,
      temperature: options.temperature,
      maxRetries: this.config.maxRetries,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = result.usage as any;
    return {
      text: result.text,
      sources: searchResults,
      usage: {
        inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
        outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      },
    };
  }

  /**
   * Perform web search using available search APIs.
   * Uses config manager to resolve API keys with priority:
   * 1. Environment variable
   * 2. System keychain
   * 3. Config file
   */
  private async performWebSearch(
    query: string,
    options: WebSearchOptions = {},
  ): Promise<WebSearchResult["sources"]> {
    const configManager = getConfigManager();

    // Try Serper first
    const serperKey = await configManager.getSerperApiKey();
    if (
      serperKey &&
      (options.provider === "serper" ||
        options.provider === "auto" ||
        !options.provider)
    ) {
      try {
        const response = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": serperKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q: query,
            num: options.maxResults ?? 10,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            organic?: Array<{ title: string; link: string; snippet: string }>;
          };
          return (data.organic || []).map((r) => ({
            title: r.title,
            url: r.link,
            snippet: r.snippet,
          }));
        }
      } catch (e) {
        console.warn("Serper search failed:", e);
      }
    }

    // Try Tavily as fallback
    const tavilyKey = await configManager.getTavilyApiKey();
    if (
      tavilyKey &&
      (options.provider === "tavily" ||
        options.provider === "auto" ||
        !options.provider)
    ) {
      try {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: tavilyKey,
            query,
            max_results: options.maxResults ?? 10,
            search_depth: "advanced",
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            results?: Array<{ title: string; url: string; content: string }>;
          };
          return (data.results || []).map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
          }));
        }
      } catch (e) {
        console.warn("Tavily search failed:", e);
      }
    }

    return [];
  }

  /**
   * Research a topic using web search and return structured findings
   */
  async research<T>(
    topic: string,
    schema: z.ZodSchema<T>,
    options: GenerateOptions & WebSearchOptions = {},
  ): Promise<StructuredResult<T> & { sources: WebSearchResult["sources"] }> {
    const searchResult = await this.generateWithWebSearch(
      `Research the following topic thoroughly and gather current information:\n\n${topic}\n\nProvide comprehensive findings with specific details, best practices, and up-to-date information.`,
      {
        ...options,
        systemPrompt:
          options.systemPrompt ||
          "You are a research assistant. Use the provided web search results to give detailed, accurate findings. Include specific examples, code patterns, and best practices where applicable.",
      },
    );

    const structuredResult = await this.generateStructured(
      `Based on the following research findings, structure the information according to the requested format:\n\n${searchResult.text}`,
      schema,
      {
        ...options,
        temperature: 0.2,
      },
    );

    return {
      ...structuredResult,
      sources: searchResult.sources,
    };
  }

  /**
   * Update configuration dynamically
   */
  setConfig(config: Partial<GatewayConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.apiKey) {
      this.gateway = createGateway({
        apiKey: config.apiKey,
      });
    }
  }

  /**
   * Get current default model
   */
  getDefaultModel(): string {
    return this.config.defaultModel;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<GatewayConfig> {
    return { ...this.config };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let defaultGateway: AIGateway | null = null;

/**
 * Get or create the default gateway instance
 */
export function getGateway(config?: GatewayConfig): AIGateway {
  if (!defaultGateway || config) {
    defaultGateway = new AIGateway(config);
  }
  return defaultGateway;
}

/**
 * Reset the default gateway instance
 */
export function resetGateway(): void {
  defaultGateway = null;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick generate text with default settings
 */
export async function generate(
  prompt: string,
  options?: GenerateOptions,
): Promise<string> {
  const gateway = getGateway();
  const result = await gateway.generate(prompt, options);
  return result.text;
}

/**
 * Quick generate structured object
 */
export async function generateObjectQuick<T>(
  prompt: string,
  schema: z.ZodSchema<T>,
  options?: GenerateOptions,
): Promise<T> {
  const gateway = getGateway();
  const result = await gateway.generateStructured(prompt, schema, options);
  return result.object;
}

/**
 * Quick stream text
 */
export function streamResponse(
  prompt: string,
  options?: StreamOptions,
): AsyncGenerator<string, GenerateResult> {
  const gateway = getGateway();
  return gateway.stream(prompt, options);
}

export default AIGateway;
