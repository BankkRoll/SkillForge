---
name: {{name}}
description: {{description}}
{{#if argumentHint}}argument-hint: "{{argumentHint}}"{{/if}}
{{#if allowedTools}}allowed-tools: {{allowedTools}}{{/if}}
{{#if model}}model: {{model}}{{/if}}
{{#if tags}}tags: [{{tags}}]{{/if}}
version: 1.0.0
---

# {{title}}

{{description}}

## When to use this skill

- {{whenToUse.[0]}}
- {{whenToUse.[1]}}
- {{whenToUse.[2]}}

## When NOT to use this skill

- {{whenNotToUse.[0]}}
- {{whenNotToUse.[1]}}

## Prerequisites

- {{prerequisites.[0]}}

## Procedure

### 1. {{procedure.[0].title}}

{{procedure.[0].description}}

{{#if procedure.[0].code}}

```{{procedure.[0].language}}
{{procedure.[0].code}}
```

{{/if}}

### 2. {{procedure.[1].title}}

{{procedure.[1].description}}

### 3. {{procedure.[2].title}}

{{procedure.[2].description}}

## Constraints

- NEVER {{constraints.[0]}}
- ALWAYS {{constraints.[1]}}
- {{constraints.[2]}}

## Guardrails

- Prefer {{guardrails.[0]}}
- Avoid {{guardrails.[1]}}
- {{guardrails.[2]}}

## Output expectations

{{outputDescription}}

Include these sections:
{{#each outputSections}}

- {{this}}
  {{/each}}

## Troubleshooting

### {{troubleshooting.[0].issue}}

{{troubleshooting.[0].solution}}
