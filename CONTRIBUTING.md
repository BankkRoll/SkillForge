# Contributing to SkillForge

First off, thank you for considering contributing to SkillForge! It's people like you that make SkillForge such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by the [SkillForge Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

**Bug Report Template:**

```markdown
**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Run command '...'
2. With options '...'
3. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Screenshots/Logs**
If applicable, add screenshots or logs to help explain your problem.

**Environment:**
 - OS: [e.g., macOS 14.0, Windows 11, Ubuntu 22.04]
 - Node.js version: [e.g., 20.10.0]
 - SkillForge version: [e.g., 0.1.0]

**Additional context**
Add any other context about the problem here.
```

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. Create an issue and provide the following information:

- **Use a clear and descriptive title** for the issue
- **Provide a step-by-step description** of the suggested enhancement
- **Provide specific examples** to demonstrate the steps
- **Describe the current behavior** and **explain the behavior you expected**
- **Explain why this enhancement would be useful**

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

## Development Setup

### Prerequisites

- Node.js 18.0.0 or higher
- pnpm (recommended) or npm
- Git

### Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/skillforge.git
cd skillforge

# Install dependencies
pnpm install

# Create a branch for your feature
git checkout -b feature/amazing-feature
```

### Development Workflow

```bash
# Run in development mode
pnpm dev

# Run type checking
pnpm typecheck

# Run linting
pnpm lint

# Run tests
pnpm test

# Build the project
pnpm build
```

### Project Structure

```
skillforge/
├── src/
│   ├── agents/          # Multi-agent orchestration
│   │   ├── base.ts      # Base agent class
│   │   ├── orchestrator.ts
│   │   ├── researcher.ts
│   │   ├── skill-writer.ts
│   │   ├── example-generator.ts
│   │   ├── qa.ts
│   │   └── index.ts
│   ├── cli/             # CLI interface
│   │   └── index.ts
│   ├── gateway/         # AI SDK Gateway abstraction
│   │   └── index.ts
│   ├── generators/      # File output generators
│   │   ├── skill.ts
│   │   ├── agent.ts
│   │   ├── plugin.ts
│   │   └── index.ts
│   ├── schemas/         # Zod validation schemas
│   │   └── index.ts
│   ├── templates/       # Template engine
│   │   └── index.ts
│   ├── utils/           # Utilities
│   │   ├── crawler.ts
│   │   ├── repo-analyzer.ts
│   │   ├── quality-gates.ts
│   │   ├── checkpoint.ts
│   │   └── index.ts
│   └── index.ts         # Main exports
├── tests/               # Test files
├── package.json
├── tsconfig.json
└── README.md
```

## Coding Guidelines

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Prefer interfaces over type aliases for object shapes
- Use `const` assertions where appropriate
- Avoid `any` - use `unknown` if type is truly unknown

### Naming Conventions

- **Files**: kebab-case (`skill-writer.ts`)
- **Classes**: PascalCase (`SkillWriter`)
- **Functions/Methods**: camelCase (`generateSkill`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRIES`)
- **Interfaces**: PascalCase with descriptive names (`AgentEventHandlers`)

### Code Style

- Use 2 spaces for indentation
- Use single quotes for strings
- Add trailing commas in multiline structures
- Keep lines under 100 characters when possible
- Add JSDoc comments for public APIs

```typescript
/**
 * Generate skills from a prompt
 * @param prompt - The user's prompt describing desired skills
 * @param options - Generation options
 * @returns Promise resolving to generated skills
 */
export async function generateSkills(
  prompt: string,
  options?: GenerationOptions
): Promise<GeneratedSkill[]> {
  // Implementation
}
```

### Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - A new feature
- `fix:` - A bug fix
- `docs:` - Documentation only changes
- `style:` - Changes that don't affect the meaning of the code
- `refactor:` - A code change that neither fixes a bug nor adds a feature
- `perf:` - A code change that improves performance
- `test:` - Adding missing tests or correcting existing tests
- `chore:` - Changes to the build process or auxiliary tools

Examples:
```
feat: add URL crawling with Playwright support
fix: handle empty response from AI gateway
docs: update CLI command documentation
refactor: simplify agent state management
```

### Testing

- Write tests for new features
- Maintain existing test coverage
- Use descriptive test names
- Group related tests with `describe`

```typescript
describe('SkillGenerator', () => {
  describe('generateSkill', () => {
    it('should create SKILL.md with correct frontmatter', async () => {
      // Test implementation
    });

    it('should handle missing optional fields', async () => {
      // Test implementation
    });
  });
});
```

## Adding New Features

### Adding a New Agent

1. Create a new file in `src/agents/`
2. Extend `BaseAgent`
3. Implement the `execute` method
4. Add to exports in `src/agents/index.ts`
5. Update the pipeline if needed
6. Add tests

### Adding a New CLI Command

1. Add command function in `src/cli/index.ts`
2. Register command with Commander.js
3. Add to README documentation
4. Add tests

### Adding a New Generator

1. Create a new file in `src/generators/`
2. Implement the generator class
3. Add to exports in `src/generators/index.ts`
4. Add tests

## Questions?

Feel free to open an issue with your question or reach out to the maintainers.

Thank you for contributing! 🎉
