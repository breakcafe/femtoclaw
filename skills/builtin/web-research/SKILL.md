---
name: web-research
description: Search the web and fetch pages for current information.
whenToUse: When the user needs information beyond your training data, asks about current events, recent products, or real-time data.
triggers: search,look up,find,latest,news,what is,查一下,搜索,最新
---

# Web Research Skill

## When to use

When the user needs information that may be beyond your training data, or asks about current events, recent products, or real-time data.

## Workflow

1. Use `WebSearch` with a concise, targeted query
2. If search results contain a promising URL, use `WebFetch` to get the full content
3. Synthesize the information into a clear answer
4. Always cite the source URL

## Guidelines

- Prefer official sources over blogs or forums
- If multiple sources disagree, mention the discrepancy
- Do not fabricate information — if search returns nothing useful, say so
- Keep the answer focused on what the user asked

## Output format

Natural language with inline source links. Example:

> According to [Microsoft Learn](https://learn.microsoft.com/...), Azure Functions now supports Node.js 22...
