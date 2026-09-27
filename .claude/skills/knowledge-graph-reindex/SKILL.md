---
name: knowledge-graph-reindex
description: Re-index the Creator Claw knowledge graph. Scans the workspace and rebuilds graph.json with all skills, database tables, cron jobs, pipelines, and connections. Trigger when new skills are added, config changes, or to refresh the RAG agent's knowledge.
---

# Knowledge Graph Re-Index

Rebuilds the knowledge graph that powers the RAG agent. Scans the entire Creator Claw workspace and maps relationships between skills, database tables, APIs, cron jobs, personas, and pipelines.

## What It Does

- Scans all skills, scripts, and config files
- Maps database tables and their relationships
- Identifies cron jobs and their schedules
- Links APIs, platforms, and integrations
- Outputs `knowledge-graph/graph.json` for RAG queries

## Usage

```bash
node skills/knowledge-graph-reindex/scripts/reindex.js
```

Or run directly from the knowledge-graph folder:
```bash
node knowledge-graph/index.js
```

## When to Re-Index

- After adding new skills
- After modifying database schema
- After changing cron schedules
- After updating identity/persona files
- Weekly maintenance (optional cron)

## Output

```
Graph built: X nodes, Y edges
Output: knowledge-graph/graph.json

Node types:
  DatabaseTable: X
  Skill: X
  CronJob: X
  ...
```

## Cron Schedule (Optional)

Add to `cron-config.json` for weekly refresh:
```json
{
  "skill": "knowledge-graph-reindex",
  "command": "node skills/knowledge-graph-reindex/scripts/reindex.js",
  "cron": "0 3 * * 0",
  "frequency": "weekly",
  "enabled": true
}
```
