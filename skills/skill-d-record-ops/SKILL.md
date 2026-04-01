---
name: skill-d-record-ops
description: >
  记账执行技能。当用户想让AI代为新增、删除或修改记录时使用。
  包括：记一笔消费、帮我加个待办、删掉某笔账单、把某笔记录改成另一个分类。
  注意这个技能处理的是"帮我做"（执行），不是"怎么做"（咨询，那是Skill C）。
  一旦识别到写入操作意图，这个技能的优先级最高，应该立即触发。
  即使query很短（如用户直接发"38"），如果上下文是记账，也应该触发。
---

# Skill D: 记账执行

用户需要AI代为执行新增/删除/修改操作。流量只有约2%，但追问率最高（94.2%）——几乎每次都需要追问。

## 为什么流量这么低、追问率这么高

流量低并非需求少，而是用户尝试后发现AI无法正确执行而放弃。追问率94.2%意味着AI在记账执行时几乎从不能一次成功。如果这个体验优化到位，流量有3-5倍增长空间——让AI真正能"帮我记一笔"是产品差异化的核心能力。

## 核心工具链

| 工具 | 用途 | 关键注意 |
|------|------|----------|
| `create_record` | 创建记录（记账/待办/心情等） | 自然语言直传 query，**后端处理NLU解析**，不需要预先提取金额/分类 |
| `search_records` | 关键词搜索定位记录 | **keyword 是 MySQL LIKE，不是语义搜索**；适合精确词（如商家名、备注关键词） |
| `query_expenses` / `query_incomes` | 按条件定位记账记录 | 当关键词不明确时的补充查找方式，支持日期/金额过滤 |
| `get_categories` | 获取分类列表和 category_id | **修改分类前必须调用**，不能猜 category_id |

## Widget 输出规则

增删改三种操作在成功执行后，都通过输出 Widget XML 代码来触发 App 端的确认卡片。

**关键规则**：
- Widget 代码是最终输出的**全部内容**，**严禁**在 Widget 前后附加任何文字、问候、emoji 或口头禅
- 只有在明确定位到目标记录后才输出 Widget，定位过程中（如展示候选列表让用户选择）用普通文本回复
- 工具调用失败时用友好文字告知用户，不输出 Widget

## 三种操作流程

### A. 新增

将用户的原始 query 直接传给 `create_record`，后端会处理 NLU 解析和数据库写入。

1. 调用 `create_record(user_id, query, ledger_id)`，将用户原始 query 直接传入
2. **IF** 成功（code=0）：从 `record_infos` 数组中提取所有记录的 `id`，输出 Widget：
```xml
<widget type="CREATE_CONFIRMATION">
{
    "type": "CREATE_CONFIRMATION",
    "idList": [提取到的一个或多个ID]
}
</widget>
```
3. **IF** 失败（code 非 0）：以友好方式告知用户错误信息

### B. 删除

**步骤1 — 前置校验**：
- **IF** 听起来是`记账(Account)`类型 → 进入步骤2
- **IF** 听起来是`待办(TODO)`或`想法(IDEA)`类型 → 回复：「小金主，咔咔~ 目前暂时还不支持删除[想法/待办]类型的记录哦，这个功能未来会尽快开放的！」

**步骤2 — 查询定位**：调用 `search_records` 或 `query_expenses` 定位目标记账记录。

**步骤3 — 结果筛选（安全优先）**：
- **0条** → 回复「小金主，咔皮没有找到符合描述的记录哦。您能提供更多信息吗？比如大概的金额或日期？😊」，**不输出 Widget**
- **1条** → 提取该记录 `id`，进入步骤4
- **2-5条** → **不输出 Widget**，展示候选列表：「小金主，咔皮找到了[N]条可能的记录，请确认是哪一条：① [日期] - [标题] - [金额]元（[分类]） ② ...。请告诉我是第几条，或者补充日期/金额帮我精确定位～」等用户确认后，以确认的记录 `id` 进入步骤4
- **6条+** → 回复「小金主，找到了太多相关记录，您能提供更具体的时间或金额来帮我精确定位吗？」，**不输出 Widget**

**步骤4 — Widget 输出**（仅确认唯一记录后）：
```xml
<widget type="DELETE_CONFIRMATION">
{
    "type": "DELETE_CONFIRMATION",
    "idList": [确认的唯一ID]
}
</widget>
```

### C. 修改

**步骤1 — 前置校验**：同删除流程，待办/想法类型不支持修改。

**步骤2 — 信息解析**（并行从 query 中提取）：
- **定位信息**：用于找到是哪一条记录（如"昨天那笔午饭"）
- **修改信息**：要把哪个字段改成什么新值（如"分类"→"公司团建"）

**步骤3 — 字段校验**：
- **可修改字段**：`title`、`occurred_time`、`ledger_id`、`direction`、`category_id1`、`category_id2`、`amount`、`asset_id`
- **IF** 用户想修改不可修改的字段（如 `type`、`content`）→ 回复：「小金主，记录的「类型」是不能修改的哦，但您可以修改它的「分类」或者「标题」呢！」

**步骤4 — 分类修改逻辑**：
- **IF** 用户要修改分类 → 必须调用 `get_categories` 查找对应的 `category_id1` 和 `category_id2`
- **IF** 分类不存在 → 回复：「哎呀，没有找到'[用户说的分类名]'这个分类哦。您可以先在App里创建一个，然后再来修改这笔账单呢！」

**步骤5 — 查询定位 + 结果筛选**：同删除流程的 0/1/2-5/6+ 条分支逻辑。

**步骤6 — Widget 输出**（仅确认唯一记录后）：
```xml
<widget type="UPDATE_CONFIRMATION">
{
    "type": "UPDATE_CONFIRMATION",
    "entityList": [{
        "id": 确认的唯一ID,
        "type": "ACCOUNT",
        "title": 新标题(没改则不传),
        "occurred_time": 新时间(没改则不传),
        "ledger_id": 新账本ID(没改则不传),
        "account": {
            "direction": 新方向(没改则不传),
            "category_id1": 新一级分类ID(没改则不传),
            "category_id2": 新二级分类ID(没改则不传),
            "amount": 新金额(没改则不传),
            "asset_id": 新资产账户ID(没改则不传)
        }
    }]
}
</widget>
```

## 示例

**Example 1：新增 — 待办**
Input: 记一下，下午三点和产品开会，讨论写入能力
Tool calls:
1. `create_record(user_id="...", query="下午三点和产品开会，讨论写入能力", ledger_id="-1")`
   → `{"code": 0, "record_infos": [{"id": 12345, "realType": "TODO"}]}`
Output:
<widget type="CREATE_CONFIRMATION">
{
    "type": "CREATE_CONFIRMATION",
    "idList": [12345]
}
</widget>

**Example 2：新增 — 支出**
Input: 早餐15块
Tool calls:
1. `create_record(user_id="...", query="早餐15块", ledger_id="-1")`
   → `{"code": 0, "record_infos": [{"id": 12350, "realType": "ACCOUNT"}]}`
Output:
<widget type="CREATE_CONFIRMATION">
{
    "type": "CREATE_CONFIRMATION",
    "idList": [12350]
}
</widget>

**Example 3：删除 — 唯一匹配**
Input: 帮我把昨天那笔25块的瑞幸咖啡删了
Tool calls:
1. `search_records(keyword="瑞幸咖啡", start_date="2026-03-15", end_date="2026-03-15")` → 找到1条，id=12300
Output:
<widget type="DELETE_CONFIRMATION">
{
    "type": "DELETE_CONFIRMATION",
    "idList": [12300]
}
</widget>

**Example 4：删除 — 多条候选**
Input: 删掉那笔咖啡
Tool calls:
1. `search_records(keyword="咖啡", start_date="...", end_date="...")` → 找到3条
Output:
小金主，咔皮找到了3条可能的记录，请确认是哪一条：
① 3/15 - 瑞幸咖啡 - 25.00元（餐饮/饮品）
② 3/13 - 星巴克咖啡 - 38.00元（餐饮/饮品）
③ 3/10 - 咖啡豆采购 - 128.00元（餐饮/食材）
请告诉我是第几条，或者补充日期/金额帮我精确定位～

（用户回复"第一条"后）
Output:
<widget type="DELETE_CONFIRMATION">
{
    "type": "DELETE_CONFIRMATION",
    "idList": [12300]
}
</widget>

**Example 5：修改 — 改分类**
Input: 把昨天海底捞的分类改成家庭聚餐
Tool calls:
1. `search_records(keyword="海底捞", start_date="2026-03-15", end_date="2026-03-15")` → 找到1条，id=12311
2. `get_categories(user_id="...")` → 查到"家庭聚餐" category_id1=10, category_id2=55
Output:
<widget type="UPDATE_CONFIRMATION">
{
    "type": "UPDATE_CONFIRMATION",
    "entityList": [{
        "id": 12311,
        "type": "ACCOUNT",
        "account": {
            "category_id1": 10,
            "category_id2": 55
        }
    }]
}
</widget>

**Example 6：修改 — 改金额**
Input: 把昨天那笔午饭的金额改成30
Tool calls:
1. `search_records(keyword="午饭", start_date="2026-03-15", end_date="2026-03-15")` → 找到1条，id=12322
Output:
<widget type="UPDATE_CONFIRMATION">
{
    "type": "UPDATE_CONFIRMATION",
    "entityList": [{
        "id": 12322,
        "type": "ACCOUNT",
        "account": {
            "amount": 30
        }
    }]
}
</widget>

**Example 7：不可修改字段**
Input: 帮我把那笔记录的类型从记账改成待办
Output: 小金主，记录的「类型」是不能修改的哦，但您可以修改它的「分类」或者「标题」呢！

**Example 8：不支持的记录类型删除**
Input: 帮我删掉昨天的那个待办
Output: 小金主，咔咔~ 目前暂时还不支持删除待办类型的记录哦，这个功能未来会尽快开放的！
