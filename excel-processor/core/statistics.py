"""
统计计算模块
负责计算个人总分、小组总分、小组平均分、个人排名、小组排名等。
"""

from typing import List, Dict, Any


class ScoreStatistics:
    """积分统计计算器。"""

    def __init__(self, data: dict):
        """
        Args:
            data: ExcelReader.read_score_data() 返回的数据结构
        """
        self.title = data["title"]
        self.score_item_names = data["score_item_names"]
        self.score_item_count = data["score_item_count"]
        self.groups = data["groups"]
        self.total_students = data["total_students"]
        self.total_groups = data["total_groups"]

    def calculate(self) -> dict:
        """
        执行全部统计计算。

        返回结构:
        {
            "title": ...,
            "score_item_names": [...],
            "students": [  # 所有学生（含统计字段）
                {
                    "group": "第一组",
                    "name": "邵泽贤",
                    "scores": [13, 19, ...],
                    "total": 184,          # 个人总分
                    "class_rank": 30,      # 全班排名
                    "group_rank": 4,       # 组内排名
                    "group_total": 634,    # 所在小组总分
                    "group_avg": 158.5,    # 所在小组平均分
                    "group_rank_overall": 12  # 所在小组全班排名
                },
                ...
            ],
            "group_summary": [  # 小组汇总
                {
                    "name": "第一组",
                    "member_count": 4,
                    "total": 634,
                    "average": 158.5,
                    "rank": 12
                },
                ...
            ]
        }
        """
        # Step 1: 计算个人总分
        students = []
        for group in self.groups:
            for member in group["members"]:
                total = sum(member["scores"])
                students.append({
                    "group": group["name"],
                    "name": member["name"],
                    "scores": member["scores"],
                    "total": total
                })

        # Step 2: 计算小组总分和平均分
        group_stats = {}  # group_name -> {total, count, members}
        for group in self.groups:
            gname = group["name"]
            members = group["members"]
            group_total = sum(sum(m["scores"]) for m in members)
            group_count = len(members)
            group_avg = round(group_total / group_count, 2) if group_count > 0 else 0

            group_stats[gname] = {
                "total": group_total,
                "count": group_count,
                "average": group_avg,
                "members": [m["name"] for m in members]
            }

        # Step 3: 小组排名（按总分降序）
        group_ranking = sorted(
            group_stats.items(),
            key=lambda x: x[1]["total"],
            reverse=True
        )
        for rank, (gname, stats) in enumerate(group_ranking, 1):
            group_stats[gname]["rank"] = rank

        # Step 4: 个人全班排名（按总分降序）
        sorted_students = sorted(students, key=lambda x: x["total"], reverse=True)
        for rank, student in enumerate(sorted_students, 1):
            student["class_rank"] = rank

        # Step 5: 个人组内排名
        # 按小组分组，每组内按总分降序排名
        group_members_map = {}  # group_name -> list of students
        for student in students:
            gname = student["group"]
            if gname not in group_members_map:
                group_members_map[gname] = []
            group_members_map[gname].append(student)

        for gname, members in group_members_map.items():
            members_sorted = sorted(members, key=lambda x: x["total"], reverse=True)
            for rank, member in enumerate(members_sorted, 1):
                member["group_rank"] = rank
                # 附加小组统计信息
                gs = group_stats[gname]
                member["group_total"] = gs["total"]
                member["group_avg"] = gs["average"]
                member["group_rank_overall"] = gs["rank"]

        # Step 6: 构建小组汇总
        group_summary = []
        for gname, stats in sorted(group_stats.items(), key=lambda x: x[1]["rank"]):
            group_summary.append({
                "name": gname,
                "member_count": stats["count"],
                "total": stats["total"],
                "average": stats["average"],
                "rank": stats["rank"]
            })

        return {
            "title": self.title,
            "score_item_names": self.score_item_names,
            "score_item_count": self.score_item_count,
            "total_students": len(students),
            "total_groups": len(group_stats),
            "students": students,
            "group_summary": group_summary
        }

    def get_top_students(self, result: dict, n: int = 10) -> list:
        """获取前N名学生。"""
        sorted_students = sorted(result["students"], key=lambda x: x["total"], reverse=True)
        return sorted_students[:n]

    def get_group_leaders(self, result: dict) -> list:
        """获取每个小组的第一名。"""
        leaders = []
        for student in result["students"]:
            if student["group_rank"] == 1:
                leaders.append(student)
        leaders.sort(key=lambda x: x["total"], reverse=True)
        return leaders
