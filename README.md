<p align="center">
  <img src="https://raw.githubusercontent.com/BankkRoll/skillforge/main/.github/assets/logo.png" alt="SkillForge Logo" width="200" />
</p>

<h1 align="center">SkillForge</h1>

> THIS WILL BURN THROUGH ALOT OF YOUR AI CREDITS FYI NEED CACHEING AND SOME BETTER OPTIMIZATIONS

<p align="center">
  <strong>AI-powered skill, agent, and plugin generator for Claude Code and 40+ AI coding agents</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#commands">Commands</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## What is SkillForge?

SkillForge is an advanced CLI tool that uses AI to generate **skills**, **agents**, and **plugins** compatible with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Skills.sh](https://skills.sh), and 40+ AI coding agents. It features a multi-agent architecture that can run extended sessions, similar to Claude Code with Opus, capable of working for 20+ minutes on complex generation tasks.

### The Problem

Creating high-quality AI skills and agents is time-consuming. You need to:

- Research best practices and patterns
- Write detailed procedures and constraints
- Create code examples and templates
- Ensure security and quality standards
- Structure everything correctly

### The Solution

SkillForge automates this entire process using a sophisticated multi-agent pipeline:

```
Prompt → Orchestrator → Researcher → SkillWriter → ExampleGenerator → QA → Output
```

Just provide a description, and SkillForge generates production-ready skills with:

- ✅ Complete SKILL.md files with YAML frontmatter
- ✅ Step-by-step procedures
- ✅ Constraints and guardrails
- ✅ Code examples and templates
- ✅ Quality scores and validation

## Features

### 🤖 Multi-Agent Architecture

- **Orchestrator** - Plans and coordinates the generation pipeline
- **Researcher** - Gathers domain knowledge, best practices, security concerns
- **SkillWriter** - Creates comprehensive SKILL.md files
- **ExampleGenerator** - Produces runnable code examples and templates
- **QA Agent** - Reviews quality, completeness, and security

### 🔧 Generation Capabilities

- **Skills** - Generate SKILL.md files with procedures, constraints, and examples
- **Agents** - Create agent.md definitions with system prompts and capabilities
- **Plugins** - Build complete plugin packages with manifest, skills, agents, and hooks

### 🌐 Input Modes

- **Prompt-based** - Describe what you want in natural language
- **URL Crawling** - Extract content from documentation sites (Playwright + Turndown)
- **Repository Analysis** - Analyze codebases to generate relevant skills

### ⚡ Advanced Features

- **Quality Gates** - Automated linting and validation with scoring
- **Checkpointing** - Resumable sessions for long-running generations
- **Parallel Processing** - Generate multiple skills concurrently
- **Interactive Mode** - Guided prompts with spinners and progress

### 🔌 Pure AI SDK Gateway

- Uses **only** `@ai-sdk/gateway` - no provider-specific packages
- Model-agnostic via `gateway("provider/model")` pattern
- Easy switching between Anthropic, OpenAI, and other providers

## Installation

```bash
git clone https://github.com/BankkRoll/skillforge.git
cd skillforge
pnpm install
pnpm build
pnpm link --global
```

## Quick Start

### 1. Configure your API key

**Option A: Interactive setup (recommended)**

```bash
skillforge config init
```

This will guide you through:

- Setting your API key (securely stored)
- Choosing a default model
- Configuring web search (optional)

**Option B: Environment variable**

```bash
export SKILLFORGE_API_KEY="your-api-key"
```

**Option C: Direct configuration**

```bash
skillforge config set apiKey
# Prompts for secure input with masked characters
```

### 2. Generate skills

```bash
# Interactive mode
skillforge

# From a prompt
skillforge build -p "Create skills for building React applications with TypeScript"

# Target specific framework
skillforge build -p "API authentication" -f "Express" -l "TypeScript"

# Override API key for a single command
skillforge build -p "..." --api-key "your-key"
```

### 3. Check the output

```
output/
├── react-component-creation/
│   ├── SKILL.md
│   ├── README.md
│   ├── examples/
│   │   ├── functional-component.tsx
│   │   └── with-hooks.tsx
│   └── templates/
│       └── component.template.tsx
└── react-state-management/
    ├── SKILL.md
    └── ...
```

## Commands

### `skillforge build`

Generate skills from a prompt.

```bash
skillforge build [options]

Options:
  -p, --prompt <prompt>      The prompt describing skills to generate
  -o, --output <dir>         Output directory (default: "./output")
  -d, --domain <domain>      Target domain (e.g., web, mobile, backend)
  -f, --framework <framework> Target framework (e.g., React, Django)
  -l, --language <language>  Target language (e.g., TypeScript, Python)
  -m, --model <model>        AI model to use (any gateway-compatible model)
  --parallel                 Process skills in parallel
  --no-examples              Skip generating code examples
  --web-search               Enable web search for research (requires SERPER_API_KEY or TAVILY_API_KEY)
  --max-search-results <n>   Maximum web search results (default: 10)
  -v, --verbose              Verbose output
```

**Model Selection**

Any gateway-compatible model identifier works. Examples:

- `anthropic/claude-sonnet-4` (default)
- `anthropic/claude-opus-4`
- `openai/gpt-4o`
- `openai/gpt-4-turbo`
- Custom models via gateway configuration

### `skillforge agent`

Generate an AI agent definition.

```bash
skillforge agent [options]

Options:
  -p, --prompt <prompt>  The prompt describing the agent
  -o, --output <dir>     Output directory (default: "./output/agents")
  -m, --model <model>    AI model to use
  -v, --verbose          Verbose output
```

### `skillforge plugin`

Generate a complete plugin package.

```bash
skillforge plugin [options]

Options:
  -p, --prompt <prompt>  The prompt describing the plugin
  -o, --output <dir>     Output directory (default: "./output/plugins")
  -m, --model <model>    AI model to use
  -v, --verbose          Verbose output
```

### `skillforge crawl`

Crawl a URL and extract content for skill generation.

```bash
skillforge crawl [options]

Options:
  -u, --url <url>           URL to crawl
  -o, --output <dir>        Output directory for crawled content
  -d, --depth <number>      Maximum crawl depth (default: 1)
  --max-pages <number>      Maximum pages to crawl (default: 10)
  --js                      Use Playwright for JavaScript-rendered content
  --generate-skills         Generate skills from crawled content
  -v, --verbose             Verbose output
```

### `skillforge analyze`

Analyze a repository and extract patterns.

```bash
skillforge analyze [options]

Options:
  -p, --path <path>      Repository path to analyze
  -o, --output <dir>     Output directory for analysis report
  --no-patterns          Skip pattern extraction
  --no-dependencies      Skip dependency analysis
  --generate-skills      Generate skills from analysis
  -v, --verbose          Verbose output
```

### `skillforge lint`

Lint and validate generated skills, agents, or plugins.

```bash
skillforge lint [options]

Options:
  -p, --path <path>  File or directory path to lint
  -v, --verbose      Show detailed lint output
  --fix              Attempt to fix issues automatically
```

### `skillforge checkpoint`

Manage generation checkpoints for resumable sessions.

```bash
skillforge checkpoint <action> [id]

Actions:
  list     List all checkpoints
  show     Show checkpoint details
  resume   Resume a paused checkpoint
  delete   Delete a checkpoint
  clean    Clean up completed/failed checkpoints
```

### `skillforge config`

Manage configuration with secure credential storage.

```bash
skillforge config <action> [key] [value]

Actions:
  init                Interactive setup wizard (recommended for first-time setup)
  set <key>           Set a config value (prompts for secure input for API keys)
  get <key>           Get a config value (masks sensitive values)
  show                Show all config values with their sources
  delete <key>        Delete a config value
  path                Show config directory path

Options:
  --keychain          Store sensitive values in system keychain (requires keytar)

Examples:
  skillforge config init              # Interactive first-time setup
  skillforge config set apiKey        # Set API key with masked input
  skillforge config set defaultModel anthropic/claude-opus-4
  skillforge config show              # View all settings and their sources
```

**Secure Storage**

API keys and sensitive credentials are stored securely:

- **System keychain** (recommended): Uses Windows Credential Manager, macOS Keychain, or Linux Secret Service. Requires `keytar` package: `pnpm add keytar`
- **Encrypted file**: Falls back to `~/.skillforge/credentials.enc` with machine-specific encryption

### `skillforge interactive`

Launch interactive mode with guided prompts.

```bash
skillforge interactive
# or
skillforge i
```

Interactive mode guides you through:

1. **Generation type** - Skills, Agents, or Plugins
2. **Description** - What you want to generate
3. **Model selection** - Choose from popular models or enter a custom one
4. **Target options** - Framework, language, domain
5. **Advanced options** - Web search, parallel processing, examples

## Programmatic Usage

```typescript
import { createSkillForge, quickGenerate } from "skillforge";

// Full control
const sf = createSkillForge({
  apiKey: process.env.SKILLFORGE_API_KEY!,
  model: "anthropic/claude-sonnet-4",
  outputDir: "./output",
  verbose: true,
});

const result = await sf.generate({
  prompt: "Create skills for building REST APIs",
  target: {
    framework: "Express",
    language: "TypeScript",
  },
});

console.log(`Generated ${result.skills.length} skills`);

// Quick generation
const skills = await quickGenerate("React hooks best practices", {
  apiKey: process.env.SKILLFORGE_API_KEY!,
  framework: "React",
  language: "TypeScript",
});
```

## Output Format

### SKILL.md Structure

```markdown
---
name: my-skill
description: A helpful skill for doing X
allowed-tools: Read, Write, Bash
version: 1.0.0
tags: [web, typescript]
---

# My Skill

Description of what this skill does.

## When to use this skill

- Use case 1
- Use case 2

## When NOT to use this skill

- Exclusion 1
- Exclusion 2

## Procedure

### 1. First Step

Description and instructions.

### 2. Second Step

More instructions with code examples.

## Constraints

- NEVER do X
- ALWAYS do Y

## Guardrails

- Prefer A over B
- Avoid C when possible

## Output expectations

What the skill should produce.
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Interface                         │
│  (Commander.js + @inquirer/prompts + ora + chalk)           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    AI Gateway Abstraction                    │
│              (@ai-sdk/gateway - no providers)               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Multi-Agent Orchestration                   │
├─────────────┬─────────────┬─────────────┬──────────────────┤
│ Orchestrator│  Researcher │ SkillWriter │ ExampleGenerator │
│             │             │             │                  │
│  (Planning) │ (Research)  │  (Writing)  │   (Examples)     │
└─────────────┴─────────────┴─────────────┴──────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      QA Agent                                │
│        (Quality scoring, validation, security review)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     File Generators                          │
│           (Skill, Agent, Plugin → File System)              │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

SkillForge uses a secure, layered configuration system with multiple storage options.

### API Key Priority

When resolving API keys, SkillForge checks in this order:

1. **CLI flag** (`--api-key`) - Highest priority, for one-off overrides
2. **Environment variable** (`SKILLFORGE_API_KEY`) - Standard for CI/CD
3. **Legacy env var** (`AI_GATEWAY_API_KEY`) - For backwards compatibility
4. **System keychain** - Most secure local storage (requires `keytar`)
5. **Encrypted config file** (`~/.skillforge/credentials.enc`) - Fallback secure storage

### Environment Variables

```bash
# Primary API key (recommended for CI/CD)
SKILLFORGE_API_KEY=sk-...

# Legacy API key (still supported)
AI_GATEWAY_API_KEY=sk-...

# Default model (optional)
SKILLFORGE_DEFAULT_MODEL=anthropic/claude-opus-4

# Web search API keys (optional, for enhanced research)
SERPER_API_KEY=...                # Serper.dev API key
TAVILY_API_KEY=...                # Tavily API key (alternative)
```

### Config Files

SkillForge stores configuration in `~/.skillforge/`:

```
~/.skillforge/
├── config.json         # Non-sensitive settings (model, output dir, etc.)
└── credentials.enc     # Encrypted API keys (machine-specific encryption)
```

**config.json** (non-sensitive):

```json
{
  "defaultModel": "anthropic/claude-sonnet-4",
  "outputDir": "./output",
  "useWebSearch": true,
  "verbose": false
}
```

### CLI Configuration

```bash
# First-time setup (recommended)
skillforge config init

# Set individual values
skillforge config set apiKey                    # Prompts for masked input
skillforge config set defaultModel openai/gpt-4o
skillforge config set useWebSearch true

# View configuration
skillforge config show                          # Shows all values with sources
skillforge config get defaultModel

# Delete values
skillforge config delete serperApiKey

# Store in system keychain (most secure)
skillforge config set apiKey --keychain
```

### Keychain Support

For maximum security, install `keytar` to use your system's native keychain:

```bash
npm install keytar
# or
pnpm add keytar
```

This enables storage in:

- **Windows**: Credential Manager
- **macOS**: Keychain
- **Linux**: Secret Service (GNOME Keyring, KWallet)

## Supported Targets

SkillForge can generate skills for any framework, language, or domain. Some popular targets:

### Languages

TypeScript, JavaScript, Python, Go, Rust, Java, C#, Ruby, PHP, Swift, Kotlin

### Frameworks

React, Next.js, Vue, Nuxt, Angular, Svelte, Express, FastAPI, Django, Rails, NestJS

### Domains

Web Development, Mobile Apps, APIs, DevOps, Databases, Authentication, Testing

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

```bash
# Clone the repo
git clone https://github.com/BankkRoll/skillforge.git
cd skillforge

# Install dependencies
pnpm install

# Run in development
pnpm dev

# Run tests
pnpm test

# Build
pnpm build
```

## License

MIT © [BankkRoll](https://github.com/BankkRoll)
