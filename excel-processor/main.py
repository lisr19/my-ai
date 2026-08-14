#!/usr/bin/env python3
"""
Excel 自动处理工具 - 主入口
支持积分统计、成绩分析等多种模板。

用法:
    python main.py --input <输入文件.xlsx> --template score_stats --output <输出文件.xlsx>
    python main.py --input <输入文件.xlsx> --auto --output <输出文件.xlsx>
"""

import argparse
import os
import sys
import time
from pathlib import Path

# 添加项目根目录到路径
PROJECT_ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(PROJECT_ROOT))

from core.excel_reader import ExcelReader
from core.statistics import ScoreStatistics
from core.excel_writer import ExcelWriter


def process_score_stats(input_path: str, output_path: str) -> dict:
    """
    积分统计模板处理流程。

    Args:
        input_path: 输入 Excel 文件路径
        output_path: 输出 Excel 文件路径

    Returns:
        统计结果摘要
    """
    print(f"📁 读取文件: {input_path}")

    # Step 1: 读取 Excel
    reader = ExcelReader(input_path)
    data = reader.read_score_data()

    print(f"   ✓ 共读取 {data['total_students']} 名学生，{data['total_groups']} 个小组")
    print(f"   ✓ 积分项: {data['score_item_names']}")

    # Step 2: 统计计算
    print(f"📊 计算统计数据...")
    stats = ScoreStatistics(data)
    result = stats.calculate()

    print(f"   ✓ 个人总分计算完成")
    print(f"   ✓ 小组总分计算完成")
    print(f"   ✓ 排名计算完成")

    # 打印摘要
    print(f"\n{'='*50}")
    print(f"统计摘要:")
    print(f"{'='*50}")
    print(f"  总人数: {result['total_students']}")
    print(f"  总组数: {result['total_groups']}")
    print(f"\n  小组排名:")
    for g in result["group_summary"]:
        print(f"    第{g['rank']}名 - {g['name']}: "
              f"总分 {g['total']}, 平均 {g['average']}, {g['member_count']}人")

    top3 = sorted(result["students"], key=lambda x: x["total"], reverse=True)[:3]
    print(f"\n  全班前三名:")
    for s in top3:
        print(f"    第{s['class_rank']}名 - {s['name']} ({s['group']}): {s['total']}分")

    # Step 3: 生成输出 Excel
    print(f"\n📝 生成报告: {output_path}")
    writer = ExcelWriter(output_path)
    writer.write_report(result)
    print(f"   ✓ 报告生成完成!")

    return result


def process_grade_stats(input_path: str, output_path: str) -> dict:
    """
    成绩统计分析模板处理流程。
    （复用积分统计的核心逻辑，增加分数段统计）
    """
    print(f"📁 读取文件: {input_path}")

    reader = ExcelReader(input_path)
    data = reader.read_score_data()

    print(f"   ✓ 共读取 {data['total_students']} 名学生，{data['total_groups']} 个小组")

    # 统计计算
    print(f"📊 计算统计数据...")
    stats = ScoreStatistics(data)
    result = stats.calculate()

    # 额外: 分数段统计
    all_totals = [s["total"] for s in result["students"]]
    score_ranges = {
        "优秀 (90%+)": 0,
        "良好 (80-90%)": 0,
        "中等 (70-80%)": 0,
        "及格 (60-70%)": 0,
        "不及格 (<60%)": 0
    }
    if all_totals:
        max_score = max(all_totals)
        for score in all_totals:
            pct = score / max_score * 100 if max_score > 0 else 0
            if pct >= 90:
                score_ranges["优秀 (90%+)"] += 1
            elif pct >= 80:
                score_ranges["良好 (80-90%)"] += 1
            elif pct >= 70:
                score_ranges["中等 (70-80%)"] += 1
            elif pct >= 60:
                score_ranges["及格 (60-70%)"] += 1
            else:
                score_ranges["不及格 (<60%)"] += 1

    print(f"\n{'='*50}")
    print(f"成绩分析摘要:")
    print(f"{'='*50}")
    print(f"  总人数: {result['total_students']}")
    print(f"  最高分: {max(all_totals) if all_totals else 0}")
    print(f"  最低分: {min(all_totals) if all_totals else 0}")
    print(f"  平均分: {round(sum(all_totals) / len(all_totals), 2) if all_totals else 0}")
    print(f"\n  分数段分布:")
    for range_name, count in score_ranges.items():
        print(f"    {range_name}: {count}人")

    print(f"\n📝 生成报告: {output_path}")
    writer = ExcelWriter(output_path)
    writer.write_report(result)
    print(f"   ✓ 报告生成完成!")

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Excel 自动处理工具 - 积分统计/成绩分析",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 积分统计
  python main.py --input data.xlsx --template score_stats --output result.xlsx

  # 成绩分析
  python main.py --input data.xlsx --template grade_stats --output result.xlsx

  # 自动检测模板
  python main.py --input data.xlsx --auto --output result.xlsx
        """
    )
    parser.add_argument(
        "--input", "-i",
        required=True,
        help="输入 Excel 文件路径 (.xlsx)"
    )
    parser.add_argument(
        "--output", "-o",
        help="输出 Excel 文件路径 (.xlsx)，默认在 input 同目录下生成"
    )
    parser.add_argument(
        "--template", "-t",
        choices=["score_stats", "grade_stats"],
        default="score_stats",
        help="处理模板: score_stats(积分统计) | grade_stats(成绩分析)"
    )
    parser.add_argument(
        "--auto", "-a",
        action="store_true",
        help="自动检测模板类型"
    )

    args = parser.parse_args()

    # 验证输入文件
    if not os.path.exists(args.input):
        print(f"❌ 错误: 输入文件不存在: {args.input}")
        sys.exit(1)

    if not args.input.endswith(".xlsx"):
        print(f"❌ 错误: 仅支持 .xlsx 格式文件")
        sys.exit(1)

    # 设置输出路径
    if not args.output:
        input_dir = os.path.dirname(args.input)
        input_name = os.path.splitext(os.path.basename(args.input))[0]
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        args.output = os.path.join(
            input_dir,
            f"{input_name}_统计结果_{timestamp}.xlsx"
        )

    # 确保输出目录存在
    output_dir = os.path.dirname(args.output)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # 自动检测模板
    template = args.template
    if args.auto:
        filename = os.path.basename(args.input)
        if "积分" in filename:
            template = "score_stats"
        elif "成绩" in filename:
            template = "grade_stats"
        else:
            template = "score_stats"  # 默认
        print(f"🔍 自动检测模板: {template}")

    print(f"\n🚀 开始处理...")
    print(f"   模板: {template}")
    print(f"   输入: {args.input}")
    print(f"   输出: {args.output}")
    print()

    # 执行处理
    try:
        if template == "score_stats":
            result = process_score_stats(args.input, args.output)
        elif template == "grade_stats":
            result = process_grade_stats(args.input, args.output)
        else:
            print(f"❌ 未知模板: {template}")
            sys.exit(1)

        print(f"\n✅ 处理完成!")
        print(f"   输出文件: {args.output}")

    except Exception as e:
        print(f"\n❌ 处理失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
