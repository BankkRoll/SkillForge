---
name: {{name}}
description: {{description}}
{{#if model}}model: {{model}}{{/if}}
{{#if temperature}}temperature: {{temperature}}{{/if}}
{{#if maxTokens}}max-tokens: {{maxTokens}}{{/if}}
{{#if tools}}tools: [{{tools}}]{{/if}}
{{#if skills}}skills: [{{skills}}]{{/if}}
{{#if tags}}tags: [{{tags}}]{{/if}}
version: 1.0.0
---

# {{title}}

{{description}}

## System Prompt

{{systemPrompt}}

## Capabilities

{{#each capabilities}}

- {{this}}
  {{/each}}

## Constraints

{{#each constraints}}

- {{this}}
  {{/each}}

## Communication

**Style:** {{communication.style}}

**Tone:** {{communication.tone}}

### Guidelines

{{#each communication.guidelines}}

- {{this}}
  {{/each}}

{{#if workflow}}

## Workflow

{{#each workflow.steps}}

### {{name}}

{{description}}

{{#if toolsUsed}}
**Tools:** {{toolsUsed}}
{{/if}}

{{/each}}

{{#if workflow.errorHandling}}

### Error Handling

{{#each workflow.errorHandling}}

- {{this}}
  {{/each}}
  {{/if}}
  {{/if}}

{{#if examples}}

## Examples

{{#each examples}}

### Example {{@index}}

**Input:**

```
{{input}}
```

**Output:**

```
{{output}}
```

{{#if explanation}}
_{{explanation}}_
{{/if}}

{{/each}}
{{/if}}
