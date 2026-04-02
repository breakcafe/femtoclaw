# 来信 Widget 规范

文字负责让用户想做，Widget 负责让用户马上就能做。

**原则**：Widget 依附在文字建议之后，不独立存在。预填优先。一个建议最多一个 Widget。

---

## Widget 类型

### 1. `quick_transfer_card` — 快速划转

**触发**：有储蓄/划转建议 + 用户**已有**对应目标

```json
{
  "widget_type": "quick_transfer_card",
  "title": "划入旅行基金",
  "amount": 400,
  "destination": { "goal_id": "g001", "name": "日本旅行基金", "current": 3200, "target": 15000 },
  "cta": "确认划转"
}
```

### 2. `goal_setup_card` — 目标创建

**触发**：有储蓄建议 + 用户**无**对应目标

```json
{
  "widget_type": "goal_setup_card",
  "title": "创建储蓄目标",
  "suggested_goal_name": "旅行基金",
  "suggested_amount": 5000,
  "cta": "创建目标"
}
```

### 3. `upcoming_bill_confirm_card` — 账单确认

**触发**：`get_upcoming_bills` 返回了 `unconfirmed_recurring` 账单

```json
{
  "widget_type": "upcoming_bill_confirm_card",
  "title": "系统识别到可能的账单",
  "bills": [{ "name": "话费充值", "estimated_amount": 50, "estimated_date": "2026-02-20" }]
}
```

### 4. `upcoming_bill_add_card` — 手动登记账单

**触发**：来信推断到大额即将支出，但系统**无记录**

```json
{
  "widget_type": "upcoming_bill_add_card",
  "title": "登记这笔支出",
  "prefill": { "name": "朋友婚礼份子钱", "amount": 2000, "expected_date": "2026-02-14" },
  "cta": "加入账单提醒"
}
```

### 5. `budget_setup_card` — 类别预算设置

**触发**：建议设预算 + 用户**未设置**该类别预算

```json
{
  "widget_type": "budget_setup_card",
  "title": "设置购物预算",
  "category": "购物",
  "suggested_amount": 600,
  "cta": "设为预算"
}
```

---

## 输出格式

```json
{
  "letter_text": "=== ...\n{昵称}，...\n---",
  "widgets": [
    { "anchor": "action_1", "widget": { "widget_type": "quick_transfer_card", ... } },
    { "anchor": "footer", "widget": { "widget_type": "upcoming_bill_confirm_card", ... } }
  ]
}
```

`anchor`：`action_1`/`action_2` 对应🔥行动序号，`footer` 放来信末尾。
