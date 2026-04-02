#!/usr/bin/env python3
"""
monthly_analysis.py
-------------------
离线分析脚本（用于测试/开发阶段）：
从本地 JSONL 文件读取记账数据，模拟月来信所需的数据分析逻辑，
输出可供月来信生成使用的 JSON。

用法：
  python monthly_analysis.py --file /path/to/records.jsonl \
                              --month 2026-02 \
                              --rolling 3
"""

import json
import argparse
import calendar
from datetime import datetime, timedelta
from collections import defaultdict

FIXED_CATEGORIES = {"住房租房", "贷款还款", "保险", "生活费"}

BUDGET_RATING_LABELS = {
    "EXCELLENT": "优秀",
    "GOOD": "良好",
    "NEEDS_ATTENTION": "需关注",
    "UNREASONABLE": "预算不合理",
}


def get_month_bounds(month_str: str):
    """给定 YYYY-MM 字符串，返回月首日和月末日"""
    d = datetime.strptime(month_str + "-01", "%Y-%m-%d")
    first_day = d.replace(day=1)
    last_day = d.replace(day=calendar.monthrange(d.year, d.month)[1])
    return first_day, last_day


def get_prev_month(month_str: str) -> str:
    """返回上一个月的 YYYY-MM 字符串"""
    d = datetime.strptime(month_str + "-01", "%Y-%m-%d")
    first_of_current = d.replace(day=1)
    last_of_prev = first_of_current - timedelta(days=1)
    return last_of_prev.strftime("%Y-%m")


def load_records(filepath: str):
    records = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def filter_month(records, first_day, last_day):
    result = []
    for r in records:
        try:
            t = datetime.strptime(r["occurred_time"], "%Y-%m-%d %H:%M:%S")
        except (KeyError, ValueError):
            continue
        if first_day <= t <= last_day + timedelta(hours=23, minutes=59, seconds=59):
            result.append(r)
    return result


def aggregate_month(records):
    categories = defaultdict(lambda: {"total": 0.0, "sub": defaultdict(float), "is_fixed": False, "count": 0})
    total_expense = 0.0
    total_income = 0.0

    for r in records:
        amt = float(r.get("amount", 0))
        cat1 = r.get("category1", "其他")
        cat2 = r.get("category2", "其他")
        direction = r.get("direction", "支出")

        if direction == "支出":
            total_expense += amt
            categories[cat1]["total"] += amt
            categories[cat1]["sub"][cat2] += amt
            categories[cat1]["count"] += 1
            if cat1 in FIXED_CATEGORIES:
                categories[cat1]["is_fixed"] = True
        else:
            total_income += amt

    fixed = sum(v["total"] for v in categories.values() if v["is_fixed"])
    controllable = total_expense - fixed

    return {
        "total_expense": round(total_expense, 2),
        "total_income": round(total_income, 2),
        "fixed_expense": round(fixed, 2),
        "controllable_expense": round(controllable, 2),
        "categories": {
            k: {
                "total": round(v["total"], 2),
                "count": v["count"],
                "sub_categories": dict(v["sub"]),
                "is_fixed": v["is_fixed"],
            }
            for k, v in sorted(categories.items(), key=lambda x: -x[1]["total"])
        },
    }


def compute_rolling_averages(records, target_month_str: str, num_months: int = 3):
    """计算 target_month 之前 num_months 个月的各类别均值"""
    monthly_data = []
    current = target_month_str

    for _ in range(num_months):
        prev = get_prev_month(current)
        first_day, last_day = get_month_bounds(prev)
        month_records = filter_month(records, first_day, last_day)
        if month_records:
            agg = aggregate_month(month_records)
            agg["month_label"] = prev
            monthly_data.append(agg)
        current = prev

    if not monthly_data:
        return {"month_count_used": 0, "expense_avg": 0, "controllable_avg": 0, "categories": {}}

    cat_totals = defaultdict(list)
    expense_totals = []
    ctrl_totals = []
    income_totals = []

    for md in monthly_data:
        expense_totals.append(md["total_expense"])
        ctrl_totals.append(md["controllable_expense"])
        income_totals.append(md["total_income"])
        for cat, info in md["categories"].items():
            cat_totals[cat].append(info["total"])

    return {
        "month_count_used": len(monthly_data),
        "expense_avg": round(sum(expense_totals) / len(expense_totals), 2),
        "controllable_avg": round(sum(ctrl_totals) / len(ctrl_totals), 2),
        "income_avg": round(sum(income_totals) / len(income_totals), 2) if income_totals else 0,
        "categories": {
            cat: {"monthly_avg": round(sum(vals) / len(vals), 2), "months_sampled": len(vals)}
            for cat, vals in cat_totals.items()
        },
    }


def compute_savings_rate(total_income: float, total_expense: float):
    """计算储蓄率"""
    if total_income <= 0:
        return {"savings_rate": None, "surplus": round(total_income - total_expense, 2), "has_income": False}

    surplus = total_income - total_expense
    rate = surplus / total_income * 100

    if rate >= 30:
        level = "high"
    elif rate >= 15:
        level = "healthy"
    elif rate >= 5:
        level = "low"
    elif rate >= 0:
        level = "very_low"
    else:
        level = "negative"

    return {
        "savings_rate": round(rate, 1),
        "surplus": round(surplus, 2),
        "has_income": True,
        "level": level,
    }


def compute_budget_execution(budget_data: dict, month_agg: dict):
    """
    逐类别计算预算执行率 + 四级评分。
    budget_data: {category: budget_amount, ...}
    """
    if not budget_data:
        return {"has_budget": False}

    total_budget = sum(budget_data.values())
    total_overspend = 0.0
    category_results = {}
    overspend_categories = []

    for cat, budget in budget_data.items():
        actual = month_agg["categories"].get(cat, {}).get("total", 0.0)
        execution_rate = (actual / budget * 100) if budget > 0 else 0
        overspend = max(0, actual - budget)
        total_overspend += overspend

        category_results[cat] = {
            "budget": round(budget, 2),
            "actual": round(actual, 2),
            "execution_rate": round(execution_rate, 1),
            "overspend": round(overspend, 2),
            "underspend": round(max(0, budget - actual), 2),
        }

        if execution_rate > 110:
            overspend_categories.append({"category": cat, "rate": execution_rate, "overspend": overspend})

    # 四级评分
    over_50_count = sum(1 for c in overspend_categories if c["rate"] > 150)
    over_30_count = sum(1 for c in overspend_categories if c["rate"] > 130)

    if not overspend_categories:
        rating = "EXCELLENT"
    elif len(overspend_categories) <= 1 and all(c["rate"] < 130 for c in overspend_categories):
        rating = "GOOD"
    elif over_50_count >= 3 or month_agg["total_expense"] > total_budget * 1.5:
        rating = "UNREASONABLE"
    else:
        rating = "NEEDS_ATTENTION"

    # 跨类别再分配检测
    reallocation_opportunities = []
    for oc in overspend_categories:
        for cat, result in category_results.items():
            if result["underspend"] >= 0.7 * oc["overspend"] and cat != oc["category"]:
                reallocation_opportunities.append({
                    "from_category": cat,
                    "to_category": oc["category"],
                    "from_underspend": result["underspend"],
                    "to_overspend": oc["overspend"],
                })

    overall_execution = max(0, (total_budget - total_overspend) / total_budget * 100) if total_budget > 0 else 0

    return {
        "has_budget": True,
        "total_budget": round(total_budget, 2),
        "overall_execution": round(overall_execution, 1),
        "rating": rating,
        "rating_label": BUDGET_RATING_LABELS[rating],
        "categories": category_results,
        "overspend_categories": overspend_categories,
        "reallocation_opportunities": reallocation_opportunities,
    }


def compare_monthly_structure(current_agg: dict, prev_agg: dict, rolling_avg: dict):
    """本月 vs 上月 vs 三月均值结构对比"""
    all_cats = set()
    all_cats.update(current_agg["categories"].keys())
    if prev_agg:
        all_cats.update(prev_agg["categories"].keys())

    comparisons = {}
    for cat in all_cats:
        current_total = current_agg["categories"].get(cat, {}).get("total", 0)
        prev_total = prev_agg["categories"].get(cat, {}).get("total", 0) if prev_agg else 0
        avg_total = rolling_avg["categories"].get(cat, {}).get("monthly_avg", 0)

        current_pct = (current_total / current_agg["total_expense"] * 100) if current_agg["total_expense"] > 0 else 0
        prev_pct = (prev_total / prev_agg["total_expense"] * 100) if prev_agg and prev_agg["total_expense"] > 0 else 0

        mom_change = ((current_total - prev_total) / prev_total * 100) if prev_total > 0 else None
        vs_avg_change = ((current_total - avg_total) / avg_total * 100) if avg_total > 0 else None

        significant = False
        if mom_change is not None and abs(mom_change) > 20:
            significant = True
        if vs_avg_change is not None and abs(vs_avg_change) > 20:
            significant = True

        comparisons[cat] = {
            "current": round(current_total, 2),
            "current_pct": round(current_pct, 1),
            "previous": round(prev_total, 2),
            "previous_pct": round(prev_pct, 1),
            "avg": round(avg_total, 2),
            "mom_change_pct": round(mom_change, 1) if mom_change is not None else None,
            "vs_avg_change_pct": round(vs_avg_change, 1) if vs_avg_change is not None else None,
            "significant": significant,
        }

    return comparisons


def check_recording_density(records, first_day, last_day):
    """检查记录密度：有记录天数 / 月总天数"""
    total_days = (last_day - first_day).days + 1
    recorded_dates = set()

    for r in records:
        try:
            t = datetime.strptime(r["occurred_time"], "%Y-%m-%d %H:%M:%S")
        except (KeyError, ValueError):
            continue
        if first_day <= t <= last_day + timedelta(hours=23, minutes=59, seconds=59):
            recorded_dates.add(t.date())

    density = len(recorded_dates) / total_days if total_days > 0 else 0

    return {
        "total_days": total_days,
        "recorded_days": len(recorded_dates),
        "density": round(density, 2),
        "low_density": density < 0.6,
    }


def main():
    parser = argparse.ArgumentParser(description="Monthly spending analysis for letter generation")
    parser.add_argument("--file", required=True, help="Path to JSONL records file")
    parser.add_argument("--month", required=True, help="Target month (YYYY-MM)")
    parser.add_argument("--rolling", type=int, default=3, help="Number of months for rolling average")
    parser.add_argument("--budget", default=None, help="Path to budget JSON file (optional, {category: amount})")
    args = parser.parse_args()

    first_day, last_day = get_month_bounds(args.month)
    records = load_records(args.file)

    # 本月数据
    month_records = filter_month(records, first_day, last_day)
    month_agg = aggregate_month(month_records)
    month_agg["month_label"] = args.month
    month_agg["transaction_count"] = len(month_records)

    # 上月数据
    prev_month_str = get_prev_month(args.month)
    prev_first, prev_last = get_month_bounds(prev_month_str)
    prev_records = filter_month(records, prev_first, prev_last)
    prev_agg = aggregate_month(prev_records) if prev_records else None
    if prev_agg:
        prev_agg["month_label"] = prev_month_str

    # 三月滚动均值
    rolling = compute_rolling_averages(records, args.month, args.rolling)

    # 储蓄率
    savings = compute_savings_rate(month_agg["total_income"], month_agg["total_expense"])

    # 预算执行（如提供预算文件）
    budget_data = {}
    if args.budget:
        with open(args.budget, "r", encoding="utf-8") as f:
            budget_data = json.load(f)
    budget_execution = compute_budget_execution(budget_data, month_agg)

    # 消费结构对比
    structure_comparison = compare_monthly_structure(month_agg, prev_agg, rolling)

    # 记录密度
    density = check_recording_density(month_records, first_day, last_day)

    # 异常检测
    anomalies = []

    # 缺失类别检测（阈值 ¥150，月度尺度更高）
    for cat in rolling["categories"]:
        if cat not in month_agg["categories"] and rolling["categories"][cat]["monthly_avg"] > 150:
            anomalies.append({
                "type": "missing",
                "category": cat,
                "expected_avg": rolling["categories"][cat]["monthly_avg"],
            })

    # 显著结构偏移
    for cat, comp in structure_comparison.items():
        if comp["significant"] and comp["vs_avg_change_pct"] is not None and comp["vs_avg_change_pct"] > 50:
            anomalies.append({
                "type": "structure_shift",
                "category": cat,
                "current": comp["current"],
                "avg": comp["avg"],
                "change_pct": comp["vs_avg_change_pct"],
            })

    # 低密度警告
    if density["low_density"] and month_agg["total_expense"] < rolling.get("expense_avg", 0) * 0.5:
        anomalies.append({
            "type": "low_recording_density",
            "density": density["density"],
            "recorded_days": density["recorded_days"],
            "total_days": density["total_days"],
        })

    output = {
        "month": month_agg,
        "previous_month": prev_agg,
        "rolling_averages": rolling,
        "savings": savings,
        "budget_execution": budget_execution,
        "structure_comparison": structure_comparison,
        "recording_density": density,
        "anomalies": anomalies,
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
