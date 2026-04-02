#!/usr/bin/env python3
"""
weekly_analysis.py
------------------
离线分析脚本（用于测试/开发阶段）：
从本地 JSONL 文件读取记账数据，模拟 get_weekly_transactions 和
get_rolling_averages 工具的计算逻辑，输出可供来信生成使用的 JSON。

用法：
  python weekly_analysis.py --file /path/to/records.jsonl \
                             --week 2026-01-11 \
                             --rolling 4
"""

import json
import argparse
from datetime import datetime, timedelta
from collections import defaultdict

FIXED_CATEGORIES = {"住房租房", "贷款还款", "保险", "生活费"}


def get_week_bounds(date_str: str):
    """给定日期字符串，返回其所在周的周一和周日"""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    monday = d - timedelta(days=d.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def load_records(filepath: str):
    records = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def filter_week(records, monday, sunday):
    result = []
    for r in records:
        try:
            t = datetime.strptime(r["occurred_time"], "%Y-%m-%d %H:%M:%S")
        except:
            continue
        if monday <= t <= sunday + timedelta(hours=23, minutes=59, seconds=59):
            result.append(r)
    return result


def aggregate_week(records):
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
                "is_fixed": v["is_fixed"]
            }
            for k, v in sorted(categories.items(), key=lambda x: -x[1]["total"])
        }
    }


def compute_rolling_averages(records, target_monday, num_weeks=4):
    """计算 target_monday 之前 num_weeks 周的各类别均值"""
    weekly_data = []
    for i in range(1, num_weeks + 1):
        week_monday = target_monday - timedelta(weeks=i)
        week_sunday = week_monday + timedelta(days=6)
        week_records = filter_week(records, week_monday, week_sunday)
        if week_records:
            agg = aggregate_week(week_records)
            weekly_data.append(agg)

    if not weekly_data:
        return {"week_count_used": 0, "controllable_avg": 0, "categories": {}}

    # 聚合均值
    cat_totals = defaultdict(list)
    ctrl_totals = []
    for wd in weekly_data:
        ctrl_totals.append(wd["controllable_expense"])
        for cat, info in wd["categories"].items():
            if not info["is_fixed"]:
                cat_totals[cat].append(info["total"])

    return {
        "week_count_used": len(weekly_data),
        "controllable_avg": round(sum(ctrl_totals) / len(ctrl_totals), 2),
        "categories": {
            cat: {"weekly_avg": round(sum(vals) / len(vals), 2), "weeks_sampled": len(vals)}
            for cat, vals in cat_totals.items()
        }
    }


def main():
    parser = argparse.ArgumentParser(description="Weekly spending analysis for letter generation")
    parser.add_argument("--file", required=True, help="Path to JSONL records file")
    parser.add_argument("--week", required=True, help="Any date within the target week (YYYY-MM-DD)")
    parser.add_argument("--rolling", type=int, default=4, help="Number of weeks for rolling average")
    args = parser.parse_args()

    monday, sunday = get_week_bounds(args.week)
    records = load_records(args.file)

    # 本周数据
    week_records = filter_week(records, monday, sunday)
    week_agg = aggregate_week(week_records)
    week_agg["week_label"] = f"{monday.strftime('%Y-%m-%d')} ~ {sunday.strftime('%Y-%m-%d')}"
    week_agg["transaction_count"] = len(week_records)

    # 滚动均值
    rolling = compute_rolling_averages(records, monday, args.rolling)

    # 异常检测
    anomalies = []
    for cat, info in week_agg["categories"].items():
        if info["is_fixed"]:
            continue
        avg = rolling["categories"].get(cat, {}).get("weekly_avg", 0)
        if avg > 0:
            ratio = info["total"] / avg
            if ratio >= 2.0:
                anomalies.append({
                    "type": "spike",
                    "category": cat,
                    "amount": info["total"],
                    "avg": avg,
                    "ratio": round(ratio, 2)
                })
        pct_of_ctrl = info["total"] / week_agg["controllable_expense"] if week_agg["controllable_expense"] > 0 else 0
        if pct_of_ctrl >= 0.4:
            anomalies.append({
                "type": "dominant",
                "category": cat,
                "amount": info["total"],
                "pct_of_controllable": round(pct_of_ctrl * 100, 1)
            })

    # 缺失类别检测
    for cat in rolling["categories"]:
        if cat not in week_agg["categories"] and rolling["categories"][cat]["weekly_avg"] > 50:
            anomalies.append({
                "type": "missing",
                "category": cat,
                "expected_avg": rolling["categories"][cat]["weekly_avg"]
            })

    output = {
        "week": week_agg,
        "rolling_averages": rolling,
        "anomalies": anomalies
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
