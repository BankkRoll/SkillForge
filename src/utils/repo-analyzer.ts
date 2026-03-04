/**
 * SkillForge Repository Analyzer
 * Analyzes codebases to extract patterns, structures, and generate skills
 */

import { readFile, readdir, stat } from "fs/promises";
import { join, extname, relative } from "path";
import { existsSync } from "fs";

// ============================================================================
// TYPES
// ============================================================================

export interface FileInfo {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  size: number;
  language?: string;
}

export interface CodePattern {
  type:
    | "function"
    | "class"
    | "interface"
    | "type"
    | "export"
    | "import"
    | "hook"
    | "component";
  name: string;
  file: string;
  line: number;
  signature?: string;
  documentation?: string;
}

export interface ProjectStructure {
  type: "monorepo" | "single" | "workspace";
  rootDir: string;
  packages?: string[];
  entryPoints: string[];
  configFiles: string[];
  testDirs: string[];
}

export interface DependencyInfo {
  name: string;
  version: string;
  type: "production" | "development" | "peer";
}

export interface AnalysisResult {
  structure: ProjectStructure;
  files: FileInfo[];
  patterns: CodePattern[];
  dependencies: DependencyInfo[];
  languages: Record<string, number>;
  frameworks: string[];
  summary: {
    totalFiles: number;
    totalLines: number;
    primaryLanguage: string;
    codebaseSize: "small" | "medium" | "large";
  };
}

export interface AnalyzerOptions {
  maxFileSize?: number;
  excludePatterns?: string[];
  includePatterns?: string[];
  maxDepth?: number;
  extractPatterns?: boolean;
  analyzeDependencies?: boolean;
}

// ============================================================================
// LANGUAGE DETECTION
// ============================================================================

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".php": "php",
  ".vue": "vue",
  ".svelte": "svelte",
  ".astro": "astro",
  ".md": "markdown",
  ".mdx": "mdx",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".sql": "sql",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".fish": "fish",
  ".ps1": "powershell",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".html": "html",
  ".xml": "xml",
};

// ============================================================================
// PATTERN EXTRACTION
// ============================================================================

interface PatternMatcher {
  language: string[];
  patterns: Array<{
    type: CodePattern["type"];
    regex: RegExp;
    nameGroup: number;
    signatureGroup?: number;
  }>;
}

const PATTERN_MATCHERS: PatternMatcher[] = [
  {
    language: ["typescript", "javascript"],
    patterns: [
      {
        type: "function",
        regex:
          /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)/gm,
        nameGroup: 1,
        signatureGroup: 0,
      },
      {
        type: "class",
        regex:
          /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?/gm,
        nameGroup: 1,
      },
      {
        type: "interface",
        regex: /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?/gm,
        nameGroup: 1,
      },
      {
        type: "type",
        regex: /(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/gm,
        nameGroup: 1,
      },
      {
        type: "hook",
        regex: /(?:export\s+)?(?:const|function)\s+(use\w+)\s*[=:]/gm,
        nameGroup: 1,
      },
      {
        type: "component",
        regex:
          /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]\s*(?:\([^)]*\)|React\.FC)/gm,
        nameGroup: 1,
      },
    ],
  },
  {
    language: ["python"],
    patterns: [
      {
        type: "function",
        regex: /def\s+(\w+)\s*\(([^)]*)\)\s*(?:->.*)?:/gm,
        nameGroup: 1,
        signatureGroup: 0,
      },
      {
        type: "class",
        regex: /class\s+(\w+)(?:\([\w,\s]*\))?:/gm,
        nameGroup: 1,
      },
    ],
  },
  {
    language: ["go"],
    patterns: [
      {
        type: "function",
        regex: /func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(([^)]*)\)/gm,
        nameGroup: 1,
        signatureGroup: 0,
      },
      {
        type: "type",
        regex: /type\s+(\w+)\s+(?:struct|interface)/gm,
        nameGroup: 1,
      },
    ],
  },
  {
    language: ["rust"],
    patterns: [
      {
        type: "function",
        regex: /(?:pub\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/gm,
        nameGroup: 1,
        signatureGroup: 0,
      },
      {
        type: "type",
        regex: /(?:pub\s+)?struct\s+(\w+)/gm,
        nameGroup: 1,
      },
      {
        type: "interface",
        regex: /(?:pub\s+)?trait\s+(\w+)/gm,
        nameGroup: 1,
      },
    ],
  },
];

function extractPatterns(
  content: string,
  language: string,
  filePath: string,
): CodePattern[] {
  const patterns: CodePattern[] = [];

  const matcher = PATTERN_MATCHERS.find((m) => m.language.includes(language));
  if (!matcher) return patterns;

  for (const patternDef of matcher.patterns) {
    let match;
    patternDef.regex.lastIndex = 0;

    while ((match = patternDef.regex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split("\n").length;

      patterns.push({
        type: patternDef.type,
        name: match[patternDef.nameGroup],
        file: filePath,
        line: lineNumber,
        signature:
          patternDef.signatureGroup !== undefined
            ? match[patternDef.signatureGroup]
            : undefined,
      });
    }
  }

  return patterns;
}

// ============================================================================
// FRAMEWORK DETECTION
// ============================================================================

interface FrameworkIndicator {
  name: string;
  indicators: {
    dependencies?: string[];
    files?: string[];
    patterns?: RegExp[];
  };
}

const FRAMEWORK_INDICATORS: FrameworkIndicator[] = [
  {
    name: "React",
    indicators: {
      dependencies: ["react", "react-dom"],
      patterns: [/import.*from ['"]react['"]/],
    },
  },
  {
    name: "Next.js",
    indicators: {
      dependencies: ["next"],
      files: ["next.config.js", "next.config.mjs", "next.config.ts"],
    },
  },
  {
    name: "Vue",
    indicators: {
      dependencies: ["vue"],
      patterns: [/<template>/],
    },
  },
  {
    name: "Nuxt",
    indicators: {
      dependencies: ["nuxt"],
      files: ["nuxt.config.js", "nuxt.config.ts"],
    },
  },
  {
    name: "Angular",
    indicators: {
      dependencies: ["@angular/core"],
      files: ["angular.json"],
    },
  },
  {
    name: "Svelte",
    indicators: {
      dependencies: ["svelte"],
      files: ["svelte.config.js"],
    },
  },
  {
    name: "Express",
    indicators: {
      dependencies: ["express"],
    },
  },
  {
    name: "Fastify",
    indicators: {
      dependencies: ["fastify"],
    },
  },
  {
    name: "NestJS",
    indicators: {
      dependencies: ["@nestjs/core"],
    },
  },
  {
    name: "Django",
    indicators: {
      files: ["manage.py", "settings.py"],
      patterns: [/from django/],
    },
  },
  {
    name: "Flask",
    indicators: {
      patterns: [/from flask import/],
    },
  },
  {
    name: "FastAPI",
    indicators: {
      patterns: [/from fastapi import/],
    },
  },
  {
    name: "Rails",
    indicators: {
      files: ["Gemfile", "config/routes.rb"],
    },
  },
  {
    name: "Tailwind CSS",
    indicators: {
      dependencies: ["tailwindcss"],
      files: ["tailwind.config.js", "tailwind.config.ts"],
    },
  },
  {
    name: "Prisma",
    indicators: {
      dependencies: ["prisma", "@prisma/client"],
      files: ["prisma/schema.prisma"],
    },
  },
  {
    name: "TypeORM",
    indicators: {
      dependencies: ["typeorm"],
    },
  },
];

// ============================================================================
// REPO ANALYZER CLASS
// ============================================================================

export class RepoAnalyzer {
  private options: Required<AnalyzerOptions>;

  constructor(options: AnalyzerOptions = {}) {
    this.options = {
      maxFileSize: options.maxFileSize ?? 1024 * 1024, // 1MB
      excludePatterns: options.excludePatterns ?? [
        "node_modules",
        ".git",
        "dist",
        "build",
        "coverage",
        ".next",
        ".nuxt",
        "__pycache__",
        "venv",
        ".venv",
        "vendor",
        "target",
      ],
      includePatterns: options.includePatterns ?? ["*"],
      maxDepth: options.maxDepth ?? 10,
      extractPatterns: options.extractPatterns ?? true,
      analyzeDependencies: options.analyzeDependencies ?? true,
    };
  }

  /**
   * Analyze a repository
   */
  async analyze(repoPath: string): Promise<AnalysisResult> {
    const absolutePath = join(process.cwd(), repoPath);

    if (!existsSync(absolutePath)) {
      throw new Error(`Repository path does not exist: ${absolutePath}`);
    }

    // Analyze structure
    const structure = await this.analyzeStructure(absolutePath);

    // Collect files
    const files = await this.collectFiles(absolutePath);

    // Extract patterns
    let patterns: CodePattern[] = [];
    if (this.options.extractPatterns) {
      patterns = await this.extractAllPatterns(files, absolutePath);
    }

    // Analyze dependencies
    let dependencies: DependencyInfo[] = [];
    if (this.options.analyzeDependencies) {
      dependencies = await this.analyzeDependencies(absolutePath);
    }

    // Count languages
    const languages = this.countLanguages(files);

    // Detect frameworks
    const frameworks = await this.detectFrameworks(absolutePath, dependencies);

    // Build summary
    const totalLines = await this.countTotalLines(files, absolutePath);
    const primaryLanguage =
      Object.entries(languages).sort(([, a], [, b]) => b - a)[0]?.[0] ||
      "unknown";

    const summary = {
      totalFiles: files.length,
      totalLines,
      primaryLanguage,
      codebaseSize:
        totalLines < 5000
          ? ("small" as const)
          : totalLines < 50000
            ? ("medium" as const)
            : ("large" as const),
    };

    return {
      structure,
      files,
      patterns,
      dependencies,
      languages,
      frameworks,
      summary,
    };
  }

  /**
   * Analyze project structure
   */
  private async analyzeStructure(rootDir: string): Promise<ProjectStructure> {
    const structure: ProjectStructure = {
      type: "single",
      rootDir,
      entryPoints: [],
      configFiles: [],
      testDirs: [],
    };

    // Check for monorepo indicators
    const hasPackages = existsSync(join(rootDir, "packages"));
    const hasApps = existsSync(join(rootDir, "apps"));
    const hasLernaJson = existsSync(join(rootDir, "lerna.json"));
    const hasPnpmWorkspace = existsSync(join(rootDir, "pnpm-workspace.yaml"));

    if (hasPackages || hasApps || hasLernaJson || hasPnpmWorkspace) {
      structure.type = "monorepo";
      structure.packages = [];

      if (hasPackages) {
        const packages = await readdir(join(rootDir, "packages"));
        structure.packages.push(...packages.map((p) => `packages/${p}`));
      }
      if (hasApps) {
        const apps = await readdir(join(rootDir, "apps"));
        structure.packages.push(...apps.map((a) => `apps/${a}`));
      }
    }

    // Check for workspace in package.json
    const packageJsonPath = join(rootDir, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(
          await readFile(packageJsonPath, "utf-8"),
        );
        if (packageJson.workspaces) {
          structure.type = "workspace";
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Find entry points
    const entryPointFiles = [
      "index.ts",
      "index.js",
      "main.ts",
      "main.js",
      "app.ts",
      "app.js",
      "src/index.ts",
      "src/main.ts",
    ];
    for (const entry of entryPointFiles) {
      if (existsSync(join(rootDir, entry))) {
        structure.entryPoints.push(entry);
      }
    }

    // Find config files
    const configFiles = [
      "package.json",
      "tsconfig.json",
      "webpack.config.js",
      "vite.config.ts",
      "next.config.js",
      "nuxt.config.ts",
      ".eslintrc.js",
      "jest.config.js",
      "vitest.config.ts",
      "tailwind.config.js",
      "prisma/schema.prisma",
    ];
    for (const config of configFiles) {
      if (existsSync(join(rootDir, config))) {
        structure.configFiles.push(config);
      }
    }

    // Find test directories
    const testDirs = ["test", "tests", "__tests__", "spec", "specs"];
    for (const testDir of testDirs) {
      if (existsSync(join(rootDir, testDir))) {
        structure.testDirs.push(testDir);
      }
    }

    return structure;
  }

  /**
   * Collect all source files
   */
  private async collectFiles(
    dir: string,
    depth: number = 0,
  ): Promise<FileInfo[]> {
    const files: FileInfo[] = [];

    if (depth > this.options.maxDepth) return files;

    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(process.cwd(), fullPath);

      // Check exclude patterns
      if (
        this.options.excludePatterns.some(
          (pattern) => entry.name === pattern || relativePath.includes(pattern),
        )
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await this.collectFiles(fullPath, depth + 1);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        const language = EXTENSION_TO_LANGUAGE[ext];

        // Only include source files
        if (language) {
          const stats = await stat(fullPath);

          if (stats.size <= this.options.maxFileSize) {
            files.push({
              path: fullPath,
              relativePath,
              name: entry.name,
              extension: ext,
              size: stats.size,
              language,
            });
          }
        }
      }
    }

    return files;
  }

  /**
   * Extract patterns from all files
   */
  private async extractAllPatterns(
    files: FileInfo[],
    _rootDir: string,
  ): Promise<CodePattern[]> {
    const allPatterns: CodePattern[] = [];

    for (const file of files) {
      if (!file.language) continue;

      try {
        const content = await readFile(file.path, "utf-8");
        const patterns = extractPatterns(
          content,
          file.language,
          file.relativePath,
        );
        allPatterns.push(...patterns);
      } catch {
        // Ignore read errors
      }
    }

    return allPatterns;
  }

  /**
   * Analyze dependencies from package.json
   */
  private async analyzeDependencies(
    rootDir: string,
  ): Promise<DependencyInfo[]> {
    const dependencies: DependencyInfo[] = [];

    const packageJsonPath = join(rootDir, "package.json");
    if (!existsSync(packageJsonPath)) return dependencies;

    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));

      if (packageJson.dependencies) {
        for (const [name, version] of Object.entries(
          packageJson.dependencies,
        )) {
          dependencies.push({
            name,
            version: version as string,
            type: "production",
          });
        }
      }

      if (packageJson.devDependencies) {
        for (const [name, version] of Object.entries(
          packageJson.devDependencies,
        )) {
          dependencies.push({
            name,
            version: version as string,
            type: "development",
          });
        }
      }

      if (packageJson.peerDependencies) {
        for (const [name, version] of Object.entries(
          packageJson.peerDependencies,
        )) {
          dependencies.push({ name, version: version as string, type: "peer" });
        }
      }
    } catch {
      // Ignore parse errors
    }

    return dependencies;
  }

  /**
   * Count languages in the codebase
   */
  private countLanguages(files: FileInfo[]): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const file of files) {
      if (file.language) {
        counts[file.language] = (counts[file.language] || 0) + 1;
      }
    }

    return counts;
  }

  /**
   * Detect frameworks used
   */
  private async detectFrameworks(
    rootDir: string,
    dependencies: DependencyInfo[],
  ): Promise<string[]> {
    const detected: string[] = [];
    const depNames = new Set(dependencies.map((d) => d.name));

    for (const indicator of FRAMEWORK_INDICATORS) {
      let match = false;

      // Check dependencies
      if (indicator.indicators.dependencies) {
        match = indicator.indicators.dependencies.some((dep) =>
          depNames.has(dep),
        );
      }

      // Check files
      if (!match && indicator.indicators.files) {
        match = indicator.indicators.files.some((file) =>
          existsSync(join(rootDir, file)),
        );
      }

      if (match) {
        detected.push(indicator.name);
      }
    }

    return detected;
  }

  /**
   * Count total lines of code
   */
  private async countTotalLines(
    files: FileInfo[],
    _rootDir: string,
  ): Promise<number> {
    let total = 0;

    for (const file of files) {
      try {
        const content = await readFile(file.path, "utf-8");
        total += content.split("\n").length;
      } catch {
        // Ignore read errors
      }
    }

    return total;
  }

  /**
   * Generate a summary report
   */
  generateReport(result: AnalysisResult): string {
    const lines: string[] = [];

    lines.push("# Repository Analysis Report");
    lines.push("");

    // Summary
    lines.push("## Summary");
    lines.push("");
    lines.push(`- **Total Files:** ${result.summary.totalFiles}`);
    lines.push(
      `- **Total Lines:** ${result.summary.totalLines.toLocaleString()}`,
    );
    lines.push(`- **Primary Language:** ${result.summary.primaryLanguage}`);
    lines.push(`- **Codebase Size:** ${result.summary.codebaseSize}`);
    lines.push(`- **Project Type:** ${result.structure.type}`);
    lines.push("");

    // Languages
    lines.push("## Languages");
    lines.push("");
    const sortedLangs = Object.entries(result.languages).sort(
      ([, a], [, b]) => b - a,
    );
    for (const [lang, count] of sortedLangs) {
      const percentage = ((count / result.summary.totalFiles) * 100).toFixed(1);
      lines.push(`- ${lang}: ${count} files (${percentage}%)`);
    }
    lines.push("");

    // Frameworks
    if (result.frameworks.length > 0) {
      lines.push("## Frameworks Detected");
      lines.push("");
      for (const framework of result.frameworks) {
        lines.push(`- ${framework}`);
      }
      lines.push("");
    }

    // Structure
    lines.push("## Project Structure");
    lines.push("");
    lines.push(`- **Type:** ${result.structure.type}`);
    if (result.structure.packages?.length) {
      lines.push(`- **Packages:** ${result.structure.packages.join(", ")}`);
    }
    if (result.structure.entryPoints.length) {
      lines.push(
        `- **Entry Points:** ${result.structure.entryPoints.join(", ")}`,
      );
    }
    lines.push("");

    // Patterns
    if (result.patterns.length > 0) {
      lines.push("## Code Patterns");
      lines.push("");

      const patternsByType = result.patterns.reduce(
        (acc, p) => {
          acc[p.type] = (acc[p.type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      for (const [type, count] of Object.entries(patternsByType)) {
        lines.push(`- ${type}: ${count}`);
      }
      lines.push("");
    }

    // Top dependencies
    if (result.dependencies.length > 0) {
      lines.push("## Key Dependencies");
      lines.push("");
      const prodDeps = result.dependencies
        .filter((d) => d.type === "production")
        .slice(0, 10);
      for (const dep of prodDeps) {
        lines.push(`- ${dep.name}@${dep.version}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}

// ============================================================================
// STANDALONE FUNCTIONS
// ============================================================================

/**
 * Quick analyze a repository
 */
export async function analyzeRepo(
  repoPath: string,
  options?: AnalyzerOptions,
): Promise<AnalysisResult> {
  const analyzer = new RepoAnalyzer(options);
  return analyzer.analyze(repoPath);
}

/**
 * Generate a report from analysis
 */
export function generateAnalysisReport(result: AnalysisResult): string {
  const analyzer = new RepoAnalyzer();
  return analyzer.generateReport(result);
}
