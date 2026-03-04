/**
 * SkillForge Checkpoint System
 * Enables resumable sessions for long-running generation tasks
 */

import { readFile, writeFile, mkdir, readdir, unlink } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { createHash } from "crypto";

// ============================================================================
// TYPES
// ============================================================================

export interface CheckpointData {
  id: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  status: "in_progress" | "completed" | "failed" | "paused";
  request: Record<string, unknown>;
  progress: {
    currentStep: string;
    completedSteps: string[];
    totalSteps: number;
    percentComplete: number;
  };
  state: {
    plan?: Record<string, unknown>;
    research?: Record<string, unknown>;
    skills?: Array<{
      name: string;
      status: "pending" | "in_progress" | "completed" | "failed";
      data?: Record<string, unknown>;
    }>;
    errors?: string[];
  };
  metrics: {
    startTime: number;
    lastUpdateTime: number;
    totalTokens: number;
    apiCalls: number;
  };
  options: Record<string, unknown>;
}

export interface CheckpointManagerOptions {
  checkpointDir?: string;
  maxCheckpoints?: number;
  autoSaveInterval?: number;
  verbose?: boolean;
}

export interface CheckpointSummary {
  id: string;
  status: CheckpointData["status"];
  createdAt: string;
  percentComplete: number;
  request: string;
}

// ============================================================================
// CHECKPOINT MANAGER
// ============================================================================

export class CheckpointManager {
  private options: Required<CheckpointManagerOptions>;
  private currentCheckpoint: CheckpointData | null = null;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: CheckpointManagerOptions = {}) {
    this.options = {
      checkpointDir:
        options.checkpointDir ??
        join(process.cwd(), ".skillforge", "checkpoints"),
      maxCheckpoints: options.maxCheckpoints ?? 10,
      autoSaveInterval: options.autoSaveInterval ?? 30000, // 30 seconds
      verbose: options.verbose ?? false,
    };
  }

  /**
   * Create a new checkpoint
   */
  async create(
    request: Record<string, unknown>,
    options: Record<string, unknown> = {},
  ): Promise<string> {
    await this.ensureDir();

    const id = this.generateId(request);
    const now = new Date().toISOString();

    this.currentCheckpoint = {
      id,
      version: "1.0.0",
      createdAt: now,
      updatedAt: now,
      status: "in_progress",
      request,
      progress: {
        currentStep: "initializing",
        completedSteps: [],
        totalSteps: 0,
        percentComplete: 0,
      },
      state: {
        skills: [],
        errors: [],
      },
      metrics: {
        startTime: Date.now(),
        lastUpdateTime: Date.now(),
        totalTokens: 0,
        apiCalls: 0,
      },
      options,
    };

    await this.save();
    this.startAutoSave();

    if (this.options.verbose) {
      console.log(`Checkpoint created: ${id}`);
    }

    return id;
  }

  /**
   * Load an existing checkpoint
   */
  async load(id: string): Promise<CheckpointData | null> {
    const filePath = this.getFilePath(id);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = await readFile(filePath, "utf-8");
      this.currentCheckpoint = JSON.parse(content);
      this.startAutoSave();

      if (this.options.verbose) {
        console.log(`Checkpoint loaded: ${id}`);
      }

      return this.currentCheckpoint;
    } catch (error) {
      console.error(`Failed to load checkpoint ${id}:`, error);
      return null;
    }
  }

  /**
   * Save current checkpoint
   */
  async save(): Promise<void> {
    if (!this.currentCheckpoint) return;

    this.currentCheckpoint.updatedAt = new Date().toISOString();
    this.currentCheckpoint.metrics.lastUpdateTime = Date.now();

    const filePath = this.getFilePath(this.currentCheckpoint.id);
    await writeFile(filePath, JSON.stringify(this.currentCheckpoint, null, 2));

    if (this.options.verbose) {
      console.log(`Checkpoint saved: ${this.currentCheckpoint.id}`);
    }

    await this.cleanupOldCheckpoints();
  }

  /**
   * Update checkpoint progress
   */
  async updateProgress(
    currentStep: string,
    percentComplete: number,
    additionalData?: Partial<CheckpointData["state"]>,
  ): Promise<void> {
    if (!this.currentCheckpoint) return;

    const { progress, state } = this.currentCheckpoint;

    // Add current step to completed if not already there
    if (
      !progress.completedSteps.includes(progress.currentStep) &&
      progress.currentStep !== "initializing"
    ) {
      progress.completedSteps.push(progress.currentStep);
    }

    progress.currentStep = currentStep;
    progress.percentComplete = percentComplete;

    if (additionalData) {
      Object.assign(state, additionalData);
    }

    // Don't save on every update - auto-save will handle it
    // But save if we've made significant progress
    if (percentComplete % 10 === 0) {
      await this.save();
    }
  }

  /**
   * Update skill status
   */
  async updateSkillStatus(
    skillName: string,
    status: "pending" | "in_progress" | "completed" | "failed",
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.currentCheckpoint) return;

    const skills = this.currentCheckpoint.state.skills || [];
    const existing = skills.find((s) => s.name === skillName);

    if (existing) {
      existing.status = status;
      if (data) existing.data = data;
    } else {
      skills.push({ name: skillName, status, data });
    }

    this.currentCheckpoint.state.skills = skills;
  }

  /**
   * Add metrics
   */
  addMetrics(tokens: number, apiCalls: number = 1): void {
    if (!this.currentCheckpoint) return;

    this.currentCheckpoint.metrics.totalTokens += tokens;
    this.currentCheckpoint.metrics.apiCalls += apiCalls;
  }

  /**
   * Add error
   */
  addError(error: string): void {
    if (!this.currentCheckpoint) return;

    this.currentCheckpoint.state.errors =
      this.currentCheckpoint.state.errors || [];
    this.currentCheckpoint.state.errors.push(error);
  }

  /**
   * Mark checkpoint as completed
   */
  async complete(): Promise<void> {
    if (!this.currentCheckpoint) return;

    this.currentCheckpoint.status = "completed";
    this.currentCheckpoint.progress.percentComplete = 100;
    await this.save();
    this.stopAutoSave();
  }

  /**
   * Mark checkpoint as failed
   */
  async fail(error?: string): Promise<void> {
    if (!this.currentCheckpoint) return;

    this.currentCheckpoint.status = "failed";
    if (error) {
      this.addError(error);
    }
    await this.save();
    this.stopAutoSave();
  }

  /**
   * Mark checkpoint as paused
   */
  async pause(): Promise<void> {
    if (!this.currentCheckpoint) return;

    this.currentCheckpoint.status = "paused";
    await this.save();
    this.stopAutoSave();
  }

  /**
   * Resume a paused checkpoint
   */
  async resume(id?: string): Promise<CheckpointData | null> {
    if (id) {
      await this.load(id);
    }

    if (!this.currentCheckpoint) return null;

    this.currentCheckpoint.status = "in_progress";
    this.startAutoSave();

    return this.currentCheckpoint;
  }

  /**
   * List all checkpoints
   */
  async list(): Promise<CheckpointSummary[]> {
    await this.ensureDir();

    const files = await readdir(this.options.checkpointDir);
    const summaries: CheckpointSummary[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      try {
        const content = await readFile(
          join(this.options.checkpointDir, file),
          "utf-8",
        );
        const checkpoint: CheckpointData = JSON.parse(content);

        summaries.push({
          id: checkpoint.id,
          status: checkpoint.status,
          createdAt: checkpoint.createdAt,
          percentComplete: checkpoint.progress.percentComplete,
          request: JSON.stringify(checkpoint.request).slice(0, 100),
        });
      } catch {
        // Skip invalid files
      }
    }

    return summaries.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /**
   * Delete a checkpoint
   */
  async delete(id: string): Promise<boolean> {
    const filePath = this.getFilePath(id);

    if (!existsSync(filePath)) {
      return false;
    }

    await unlink(filePath);
    return true;
  }

  /**
   * Get current checkpoint
   */
  getCurrent(): CheckpointData | null {
    return this.currentCheckpoint;
  }

  /**
   * Get resumable checkpoint (most recent paused or in_progress)
   */
  async getResumable(): Promise<CheckpointData | null> {
    const checkpoints = await this.list();
    const resumable = checkpoints.find(
      (c) => c.status === "paused" || c.status === "in_progress",
    );

    if (resumable) {
      return this.load(resumable.id);
    }

    return null;
  }

  /**
   * Clean up old checkpoints
   */
  private async cleanupOldCheckpoints(): Promise<void> {
    const checkpoints = await this.list();

    // Keep completed/failed checkpoints for a limited time
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days

    for (const checkpoint of checkpoints) {
      if (
        (checkpoint.status === "completed" || checkpoint.status === "failed") &&
        new Date(checkpoint.createdAt).getTime() < cutoff
      ) {
        await this.delete(checkpoint.id);
      }
    }

    // Keep only maxCheckpoints
    const remaining = await this.list();
    if (remaining.length > this.options.maxCheckpoints) {
      const toDelete = remaining.slice(this.options.maxCheckpoints);
      for (const checkpoint of toDelete) {
        await this.delete(checkpoint.id);
      }
    }
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    this.stopAutoSave();

    this.saveTimer = setInterval(async () => {
      await this.save();
    }, this.options.autoSaveInterval);
  }

  /**
   * Stop auto-save timer
   */
  private stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * Ensure checkpoint directory exists
   */
  private async ensureDir(): Promise<void> {
    await mkdir(this.options.checkpointDir, { recursive: true });
  }

  /**
   * Get file path for a checkpoint
   */
  private getFilePath(id: string): string {
    return join(this.options.checkpointDir, `${id}.json`);
  }

  /**
   * Generate a unique checkpoint ID
   */
  private generateId(request: Record<string, unknown>): string {
    const timestamp = Date.now().toString(36);
    const hash = createHash("sha256")
      .update(JSON.stringify(request) + timestamp)
      .digest("hex")
      .slice(0, 8);

    return `sf-${timestamp}-${hash}`;
  }
}

// ============================================================================
// CHECKPOINT WRAPPER FOR PIPELINE
// ============================================================================

export interface CheckpointedPipelineOptions {
  checkpointManager: CheckpointManager;
  onProgress?: (step: string, percent: number) => void;
}

/**
 * Wrap a pipeline with checkpoint support
 */
export function withCheckpoint<
  T extends { run: (...args: unknown[]) => Promise<unknown> },
>(pipeline: T, options: CheckpointedPipelineOptions): T {
  const { checkpointManager } = options;
  const originalRun = pipeline.run.bind(pipeline);

  (pipeline as Record<string, unknown>).run = async (
    ...args: unknown[]
  ): Promise<unknown> => {
    const request = args[0] as Record<string, unknown>;

    // Create checkpoint
    await checkpointManager.create(request);

    try {
      // Run pipeline with progress tracking
      const result = await originalRun(...args);

      // Mark complete
      await checkpointManager.complete();

      return result;
    } catch (error) {
      // Mark failed
      await checkpointManager.fail(
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };

  return pipeline;
}

// ============================================================================
// STANDALONE FUNCTIONS
// ============================================================================

/**
 * Create a checkpoint manager
 */
export function createCheckpointManager(
  options?: CheckpointManagerOptions,
): CheckpointManager {
  return new CheckpointManager(options);
}

/**
 * List all checkpoints
 */
export async function listCheckpoints(
  checkpointDir?: string,
): Promise<CheckpointSummary[]> {
  const manager = new CheckpointManager({ checkpointDir });
  return manager.list();
}

/**
 * Load a specific checkpoint
 */
export async function loadCheckpoint(
  id: string,
  checkpointDir?: string,
): Promise<CheckpointData | null> {
  const manager = new CheckpointManager({ checkpointDir });
  return manager.load(id);
}

/**
 * Delete a checkpoint
 */
export async function deleteCheckpoint(
  id: string,
  checkpointDir?: string,
): Promise<boolean> {
  const manager = new CheckpointManager({ checkpointDir });
  return manager.delete(id);
}

/**
 * Get the most recent resumable checkpoint
 */
export async function getResumableCheckpoint(
  checkpointDir?: string,
): Promise<CheckpointData | null> {
  const manager = new CheckpointManager({ checkpointDir });
  return manager.getResumable();
}
