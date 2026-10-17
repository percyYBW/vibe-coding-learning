#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
筛选交互检查脚本 —— filter-check Skill 的可执行部分
====================================================

作用：不用打开浏览器，先静态扫描项目文件，看看"筛选功能该有的部件"齐不齐。
      它是第一道筛子，通过的项代表"代码里找得到"，不代表"点下去真的对"。
      真正的验收还得在浏览器里过一遍三种情况（有结果 / 无结果 / 清空恢复）。

用法（在项目根目录执行）：
    python .workbuddy/skills/filter-check/scripts/check_filter.py

可选参数：
    --root <目录>   指定项目根目录（默认自动往上找带 archive.html 的那一层）

退出码：
    0 = 全部通过
    1 = 有未通过项
    2 = 找不到项目文件（路径不对）

规则依据：遵循 AGENTS.md 第八条——中文注释、简单直白的命名，让未来的自己看得懂。
"""

import argparse
import datetime
import re
import sys
from pathlib import Path


# ---------- 小工具 ----------

def read_text(path):
    """读文件，读不到就返回空字符串（当作"没找到"，后面会判成未通过）"""
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def find_project_root(hint=None):
    """找项目根目录：优先用传入的；否则从本脚本往上找，找带 archive.html 的那一层"""
    if hint:
        return Path(hint).resolve()

    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "archive.html").exists():
            return parent
    return None


def count_of(text, needle):
    """数一数 needle 在 text 里出现了几次"""
    return text.count(needle)


# ---------- 检查项 ----------

def build_checks(html, js, css):
    """
    返回一张检查清单。每一项是 (编号, 检查说明, 是否通过, 证据说明)。
    编号沿用 SKILL.md 里"合格线八条"的顺序，脚本查不了的项会标成"需人工确认"。
    """
    checks = []

    def add(no, desc, ok, evidence):
        checks.append((no, desc, bool(ok), evidence))

    # 1. 有结果 —— 靠关键字输入框 + 筛选函数一起支撑
    has_keyword = 'id="filter-keyword"' in html
    has_search_type = 'type="search"' in html
    add(1, "有结果：关键字输入框（id=filter-keyword, type=search）",
        has_keyword and has_search_type,
        "archive.html 已就位" if (has_keyword and has_search_type)
        else "缺 id=\"filter-keyword\" 或 type=\"search\"")

    # 2. 无结果 —— 空状态容器 + 无结果分支
    has_empty_box = 'id="filter-empty"' in html
    js_talks_empty = "filter-empty" in js
    js_has_zero_branch = re.search(r"===\s*0", js) is not None
    add(2, "无结果：空状态容器 + 无结果分支",
        has_empty_box and js_talks_empty and js_has_zero_branch,
        "空状态容器在 archive.html，判断分支在 app.js" if (has_empty_box and js_talks_empty and js_has_zero_branch)
        else "缺：" + "、".join(
            x for x in [
                "" if has_empty_box else "archive.html 的 #filter-empty",
                "" if js_talks_empty else "app.js 里控制 #filter-empty 的代码",
                "" if js_has_zero_branch else "app.js 里 === 0 的无结果判断",
            ] if x))

    # 3. 清空恢复
    has_reset_btn = 'id="filter-reset"' in html
    js_has_reset = "filter-reset" in js
    add(3, "清空恢复：清空按钮 + 点击逻辑",
        has_reset_btn and js_has_reset,
        "按钮在 archive.html，监听在 app.js" if (has_reset_btn and js_has_reset)
        else "缺：" + "、".join([
            "" if has_reset_btn else "archive.html 的 #filter-reset 按钮",
            "" if js_has_reset else "app.js 里对 #filter-reset 的监听",
        ]).strip("、"))

    # 4. 结果计数
    has_count = 'id="filter-count"' in html
    js_updates_count = "filter-count" in js
    add(4, "结果计数：计数节点 + 更新逻辑",
        has_count and js_updates_count,
        "计数节点在 archive.html，更新在 app.js" if (has_count and js_updates_count)
        else "缺：" + "、".join([
            "" if has_count else "archive.html 的 #filter-count",
            "" if js_updates_count else "app.js 里对 #filter-count 的更新",
        ]).strip("、"))

    # 5. 关键字容错：大小写 + 首尾空格
    has_lower = "toLowerCase(" in js
    has_trim = "trim(" in js
    add(5, "关键字容错：toLowerCase + trim",
        has_lower and has_trim,
        "两项都在 app.js" if (has_lower and has_trim)
        else "缺：" + "、".join([
            "" if has_lower else "toLowerCase(",
            "" if has_trim else "trim(",
        ]).strip("、"))

    # 6. 不破坏原功能：卡片链接由渲染函数产出，这里检查渲染函数还在
    has_render = bool(re.search(r"function\s+\w*[Cc]ard", js)) or "character.html?id=" in js
    add(6, "不破坏原功能：卡片链接渲染逻辑还在",
        has_render,
        "app.js 里能看到卡片渲染 / 详情页链接" if has_render else "app.js 里找不到卡片链接渲染")

    # 7. 键盘可访问性（余力加练项）：aria-label 至少两处
    aria_times = count_of(html, "aria-label")
    add(7, "键盘可访问性：控件带 aria-label（至少 2 处）",
        aria_times >= 2,
        "archive.html 里 aria-label ×%d" % aria_times if aria_times >= 2
        else "archive.html 里 aria-label 只有 %d 处" % aria_times)

    # 8. 视觉一致：筛选栏 + 空状态都有样式
    has_bar_style = ".filter-bar" in css
    has_empty_style = "#filter-empty" in css
    add(8, "视觉一致：.filter-bar 与 #filter-empty 样式",
        has_bar_style and has_empty_style,
        "两处样式都在 style.css" if (has_bar_style and has_empty_style)
        else "缺：" + "、".join([
            "" if has_bar_style else "style.css 的 .filter-bar",
            "" if has_empty_style else "style.css 的 #filter-empty",
        ]).strip("、"))

    # 附加 A：职业下拉（今天拍板的筛选粒度要有它）
    add("A", "职业下拉（id=filter-class）",
        'id="filter-class"' in html,
        "archive.html 已就位" if 'id="filter-class"' in html else "archive.html 里没有 #filter-class")

    # 附加 B：筛选函数存在
    add("B", "筛选函数 applyFilter()",
        re.search(r"function\s+applyFilter", js) is not None,
        "app.js 里找到了" if re.search(r"function\s+applyFilter", js) else "app.js 里找不到 function applyFilter")

    return checks


# ---------- 打印报告 ----------

def main():
    # 中文在管道里也能正常输出
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    parser = argparse.ArgumentParser(description="filter-check：筛选交互静态检查")
    parser.add_argument("--root", help="项目根目录（默认自动查找）")
    args = parser.parse_args()

    root = find_project_root(args.root)
    if root is None or not (root / "archive.html").exists():
        print("找不到项目文件（没找到 archive.html），请用 --root 指定项目根目录。")
        sys.exit(2)

    html = read_text(root / "archive.html")
    js = read_text(root / "app.js")
    css = read_text(root / "style.css")

    checks = build_checks(html, js, css)
    passed = sum(1 for c in checks if c[2])

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print("=" * 62)
    print("筛选交互检查报告（filter-check Skill）")
    print("运行时间：" + now)
    print("项目根目录：" + str(root))
    print("检查文件：archive.html / app.js / style.css")
    print("=" * 62)

    for no, desc, ok, evidence in checks:
        mark = "通过  " if ok else "未通过"
        print("[%2s] %s  %s" % (no, mark, desc))
        print("       依据：%s" % evidence)

    print("-" * 62)
    print("静态检查通过 %d / %d 项" % (passed, len(checks)))

    if passed == len(checks):
        print("结论：代码里的部件齐了，接下来请在浏览器里实测三种情况（有结果 / 无结果 / 清空恢复）。")
        sys.exit(0)
    else:
        print("结论：还有 %d 项未通过，筛选实现尚不合格（退出码 1）。" % (len(checks) - passed))
        sys.exit(1)


if __name__ == "__main__":
    main()
