---
name: data-query
description: Query user's financial and consumption data via MCP tools.
whenToUse: When the user asks about spending, income, budgets, trends, or any financial data query.
triggers: spending,expense,income,cost,budget,trend,consume,how much,花了多少,消费,支出,收入,账单,预算,趋势
---

# Data Query Skill

## When to use

When the user asks about their financial data — spending, income, budgets, trends, or specific transactions.

## Prerequisites

This skill requires MCP tools from a financial data service (e.g., `mcp__kapii__*`).
If no financial MCP tools are available, tell the user that financial data integration is not configured.

## Workflow

### Step 1: Parse the time range

Use the DateTimeParserTool (if available) or parse manually:
- "最近一周" → last 7 days from today
- "上个月" → previous calendar month
- "今年" → January 1 to today
- Default to "最近一周" if no time is specified

Dates must be in YYYY-MM-DD format.

### Step 2: Determine the query type

| User intent | MCP tool to use |
|-------------|-----------------|
| Total spending / expenses | `query_expenses` or `summarize_period` |
| Spending by category | `analyze_expense_categories` |
| Income | `query_incomes` |
| Budget vs actual | `compare_budget_vs_actual` |
| Spending trend | `spending_trend` |
| Specific transactions | `query_expenses` with filters |

### Step 3: Call the appropriate MCP tool

Always include:
- `user_id`: from the conversation context
- `start_date` and `end_date`: parsed from Step 1
- Any additional filters the user specified (category, amount range)

### Step 4: Present results

- Summarize the key numbers first (total amount, count)
- Show breakdown by category if available
- Compare with previous period if the user asks for trends
- Use natural language, not raw JSON
- Round amounts to 2 decimal places
- Use the user's currency (default: CNY / 元)

## Output format

Natural language summary. Example:

> 最近一周你的总支出是 ¥1,234.50，共 23 笔。
> 主要支出分类：餐饮 ¥456（37%）、交通 ¥234（19%）、购物 ¥198（16%）。
> 相比上周，总支出增加了 ¥200（+19%）。
