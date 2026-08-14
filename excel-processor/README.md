# Excel 自动处理工具

通用的 Excel 文档自动处理工具，支持导入 Excel、按模板进行统计分析、输出格式化的 Excel 报告。

## 功能特性

### 积分统计模板 (score_stats)
- ✅ 个人总分计算
- ✅ 小组总分计算
- ✅ 小组平均分计算
- ✅ 小组排名（按总分）
- ✅ 个人全班排名
- ✅ 个人组内排名
- ✅ 输出3个Sheet：个人明细统计、小组汇总统计、排行榜
- ✅ 格式化样式：表头着色、前三名金银铜色、小组分隔行

### 成绩分析模板 (grade_stats)
- ✅ 个人总分/平均分
- ✅ 小组各科平均分
- ✅ 分数段统计（优秀/良好/中等/及格/不及格）
- ✅ 排名统计

## 快速开始

### 安装依赖

```bash
pip install openpyxl
```

### 使用方法

```bash
# 积分统计
python main.py --input 积分表.xlsx --template score_stats --output 结果.xlsx

# 成绩分析
python main.py --input 成绩表.xlsx --template grade_stats --output 结果.xlsx

# 自动检测模板（根据文件名中的"积分"或"成绩"关键字）
python main.py --input 积分表.xlsx --auto --output 结果.xlsx

# 不指定输出路径，自动在输入文件同目录生成
python main.py --input 积分表.xlsx --template score_stats
```

## 输入文件格式

### 积分统计模板

| 组别 | 姓名 | [积分项1~N] | 个总 | 组总 | 人均 | 组排 | 排名 |
|------|------|-------------|------|------|------|------|------|
| 第一组 | 张三 | 13  19  13... | | | | | |
| | 李四 | 8  14  12... | | | | | |
| 第二组 | ... | | | | | | |

- **组别**：第一列，合并单元格表示同一小组
- **姓名**：第二列
- **积分项**：第三列开始，数值类型（可为负数）
- 统计列（个总/组总等）可选，程序会重新计算

## 输出文件结构

### Sheet 1: 个人明细统计
包含所有学生的原始积分数据 + 个人总分 + 全班排名 + 组内排名，按小组分组展示。

### Sheet 2: 小组汇总统计
| 排名 | 小组名称 | 小组人数 | 小组总分 | 小组平均分 | 与第一名差距 |

### Sheet 3: 排行榜
- 全班积分排行榜（前三名金银铜色高亮）
- 各小组第一名

## 项目结构

```
excel-processor/
├── README.md
├── requirements.txt
├── main.py                    # CLI 主入口
├── core/
│   ├── excel_reader.py        # Excel 读取模块
│   ├── statistics.py          # 统计计算模块
│   └── excel_writer.py        # Excel 输出模块
├── output/                    # 输出目录
└── docs/
    └── 需求文档.md
```

## 技术栈

- Python 3.13+
- openpyxl（Excel 读写）
