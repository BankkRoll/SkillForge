# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2024-12-01

### Added

- Initial release of SkillForge
- Multi-agent orchestration system
  - Orchestrator agent for planning
  - Researcher agent for domain knowledge
  - SkillWriter agent for SKILL.md generation
  - ExampleGenerator agent for code examples
  - QA agent for quality scoring
- Skill generation from prompts
- Agent definition generation
- Plugin package generation
- URL crawling with Playwright support
- Repository analysis with pattern extraction
- Quality gates and linting system
- Checkpointing for resumable sessions
- Interactive CLI mode
- Template engine with starter templates
- Pure AI SDK Gateway abstraction (no provider packages)

### Commands

- `skillforge build` - Generate skills from a prompt
- `skillforge agent` - Generate AI agent definitions
- `skillforge plugin` - Generate plugin packages
- `skillforge crawl` - Crawl URLs for content extraction
- `skillforge analyze` - Analyze repositories
- `skillforge lint` - Lint generated files
- `skillforge checkpoint` - Manage checkpoints
- `skillforge config` - Manage configuration
- `skillforge interactive` - Interactive mode

[Unreleased]: https://github.com/BankkRoll/skillforge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/BankkRoll/skillforge/releases/tag/v0.1.0
