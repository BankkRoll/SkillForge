/**
 * SkillForge Base Agent
 *
 * Foundation for all specialized agents in the multi-agent system.
 * Provides common functionality for LLM interaction, state management,
 * and lifecycle events.
 *
 * @module agents/base
 */

import { z } from "zod";
import {
  AIGateway,
  getGateway,
  type TokenUsage,
  type WebSearchOptions,
  type WebSearchResult,
} from "../gateway/index.js";
import { nanoid } from "nanoid";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for an agent instance.
 * Model is optional and inherits from gateway default if not specified.
 */
export interface AgentConfig {
  /** Unique agent name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Model to use (optional - inherits from gateway) */
  model?: string;
  /** Temperature for generation (0-1) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** System prompt defining agent behavior */
  systemPrompt: string;
  /** Maximum iterations before stopping */
  maxIterations?: number;
}

/** A message in the agent's conversation history */
export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/** Current state of an agent */
export interface AgentState {
  messages: AgentMessage[];
  context: Map<string, unknown>;
  iteration: number;
  totalTokens: number;
  status: "idle" | "running" | "completed" | "failed";
  error?: string;
}

/** Input to an agent's execute method */
export interface AgentInput {
  content: string;
  context?: Record<string, unknown>;
  previousResults?: AgentResult[];
}

/** Result from an agent's execution */
export interface AgentResult {
  agentName: string;
  success: boolean;
  output: unknown;
  usage: TokenUsage;
  iterations: number;
  duration: number;
  error?: string;
}

/** Event handlers for agent lifecycle */
export interface AgentEventHandlers {
  onStart?: (agent: BaseAgent) => void;
  onIteration?: (agent: BaseAgent, iteration: number) => void;
  onMessage?: (agent: BaseAgent, message: AgentMessage) => void;
  onComplete?: (agent: BaseAgent, result: AgentResult) => void;
  onError?: (agent: BaseAgent, error: Error) => void;
}

// ============================================================================
// BASE AGENT CLASS
// ============================================================================

/**
 * Abstract base class for all SkillForge agents.
 * Provides common LLM interaction, state management, and lifecycle handling.
 *
 * @example
 * ```typescript
 * class MyAgent extends BaseAgent {
 *   async execute(input: AgentInput): Promise<AgentResult> {
 *     const response = await this.callLLM(input.content);
 *     return { agentName: this.name, success: true, output: response, ... };
 *   }
 * }
 * ```
 */
export abstract class BaseAgent {
  protected config: AgentConfig;
  protected gateway: AIGateway;
  protected state: AgentState;
  protected eventHandlers: AgentEventHandlers;

  constructor(config: AgentConfig, eventHandlers: AgentEventHandlers = {}) {
    this.config = {
      maxIterations: 5,
      temperature: 0.7,
      maxTokens: 4096,
      ...config,
    };

    this.gateway = getGateway();
    this.eventHandlers = eventHandlers;
    this.state = this.initializeState();
  }

  /** Initialize fresh agent state */
  protected initializeState(): AgentState {
    return {
      messages: [],
      context: new Map(),
      iteration: 0,
      totalTokens: 0,
      status: "idle",
    };
  }

  /** Reset state for new execution */
  reset(): void {
    this.state = this.initializeState();
  }

  /** Get agent name */
  get name(): string {
    return this.config.name;
  }

  /** Get agent description */
  get description(): string {
    return this.config.description;
  }

  /** Add message to conversation history */
  protected addMessage(
    role: AgentMessage["role"],
    content: string,
    metadata?: Record<string, unknown>,
  ): AgentMessage {
    const message: AgentMessage = {
      id: nanoid(),
      role,
      content,
      timestamp: Date.now(),
      metadata,
    };

    this.state.messages.push(message);
    this.eventHandlers.onMessage?.(this, message);

    return message;
  }

  /** Get a value from agent context */
  getContext<T>(key: string): T | undefined {
    return this.state.context.get(key) as T | undefined;
  }

  /** Set a value in agent context */
  setContext(key: string, value: unknown): void {
    this.state.context.set(key, value);
  }

  /** Build messages array for LLM call */
  protected buildMessages(): Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> {
    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [{ role: "system", content: this.config.systemPrompt }];

    for (const msg of this.state.messages) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    return messages;
  }

  /** Call LLM for text generation */
  protected async callLLM(prompt: string): Promise<string> {
    this.addMessage("user", prompt);

    const result = await this.gateway.generate(prompt, {
      model: this.config.model,
      systemPrompt: this.config.systemPrompt,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });

    this.state.totalTokens += result.usage.totalTokens;
    this.addMessage("assistant", result.text);

    return result.text;
  }

  /** Call LLM with structured output using Zod schema */
  protected async callLLMStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: { schemaName?: string; schemaDescription?: string },
  ): Promise<T> {
    this.addMessage("user", prompt);

    const result = await this.gateway.generateStructured(prompt, schema, {
      model: this.config.model,
      systemPrompt: this.config.systemPrompt,
      temperature: this.config.temperature ?? 0.2,
      maxTokens: this.config.maxTokens,
      ...options,
    });

    this.state.totalTokens += result.usage.totalTokens;
    this.addMessage("assistant", JSON.stringify(result.object, null, 2));

    return result.object;
  }

  /** Call LLM with web search for up-to-date information */
  protected async callLLMWithWebSearch(
    prompt: string,
    options?: WebSearchOptions,
  ): Promise<WebSearchResult> {
    this.addMessage("user", `[Web Search Query] ${prompt}`);

    const result = await this.gateway.generateWithWebSearch(prompt, {
      model: this.config.model,
      systemPrompt: this.config.systemPrompt,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      ...options,
    });

    this.state.totalTokens += result.usage.totalTokens;
    this.addMessage("assistant", result.text, {
      sources: result.sources,
      type: "web_search_result",
    });

    return result;
  }

  /** Research a topic with web search and return structured output */
  protected async researchWithWebSearch<T>(
    topic: string,
    schema: z.ZodSchema<T>,
    options?: WebSearchOptions,
  ): Promise<{ object: T; sources: WebSearchResult["sources"] }> {
    this.addMessage("user", `[Research Query] ${topic}`);

    const result = await this.gateway.research(topic, schema, {
      model: this.config.model,
      systemPrompt: this.config.systemPrompt,
      temperature: this.config.temperature ?? 0.2,
      maxTokens: this.config.maxTokens,
      ...options,
    });

    this.state.totalTokens += result.usage.totalTokens;
    this.addMessage("assistant", JSON.stringify(result.object, null, 2), {
      sources: result.sources,
      type: "research_result",
    });

    return {
      object: result.object,
      sources: result.sources,
    };
  }

  /** Main execution method - must be implemented by subclasses */
  abstract execute(input: AgentInput): Promise<AgentResult>;

  /** Run the agent with error handling and lifecycle events */
  async run(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();
    this.state.status = "running";
    this.eventHandlers.onStart?.(this);

    try {
      const result = await this.execute(input);
      this.state.status = "completed";
      this.eventHandlers.onComplete?.(this, result);
      return result;
    } catch (error) {
      this.state.status = "failed";
      this.state.error = error instanceof Error ? error.message : String(error);

      const result: AgentResult = {
        agentName: this.name,
        success: false,
        output: null,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: this.state.totalTokens,
        },
        iterations: this.state.iteration,
        duration: Date.now() - startTime,
        error: this.state.error,
      };

      this.eventHandlers.onError?.(this, error as Error);
      return result;
    }
  }

  /** Get current agent state */
  getState(): AgentState {
    return { ...this.state };
  }

  /** Get message history */
  getMessages(): AgentMessage[] {
    return [...this.state.messages];
  }
}

// ============================================================================
// AGENT REGISTRY
// ============================================================================

/**
 * Registry for managing agent instances.
 * Allows registering and retrieving agents by name.
 */
export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();

  /** Register an agent */
  register(agent: BaseAgent): void {
    this.agents.set(agent.name, agent);
  }

  /** Get an agent by name */
  get(name: string): BaseAgent | undefined {
    return this.agents.get(name);
  }

  /** Get all registered agents */
  getAll(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  /** Check if an agent is registered */
  has(name: string): boolean {
    return this.agents.has(name);
  }

  /** Remove an agent from the registry */
  remove(name: string): boolean {
    return this.agents.delete(name);
  }
}

/** Default agent registry instance */
export const agentRegistry = new AgentRegistry();
