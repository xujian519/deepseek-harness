"""工作区公共模块（纯 Python，可脱离 FreeCAD 导入）。"""

from __future__ import annotations

import pathlib
import sys


def freecad_argv(argv: list[str] | None = None) -> list[str]:
    """剥离 FreeCAD 注入的二进制名与脚本路径，返回真正的脚本参数。

    `freecadcmd build.py --pass x.json` 下 sys.argv 为
    ['freecadcmd', 'build.py', '--pass', 'x.json']；
    `python3 build.py --pass x.json` 下为 ['build.py', '--pass', 'x.json']。
    本脚本的参数全部以 `-` 开头，故跳过所有前导非选项 token。

    @param argv - 原始 argv，缺省取 sys.argv[1:]。
    @returns 供 argparse 解析的参数列表。
    """
    source = sys.argv[1:] if argv is None else list(argv)
    cleaned: list[str] = []
    for item in source:
        if cleaned or item.startswith("-"):
            cleaned.append(item)
    return cleaned


def is_entry(file: str, name: str) -> bool:
    """判断当前模块是否作为脚本入口被执行。

    - `python3 build.py`：__name__ == "__main__"。
    - `freecadcmd build.py`：__name__ 为脚本 stem，且脚本路径在 sys.argv 中。
    - `import build`：__name__ 可能等于 stem，但脚本路径不在 sys.argv 中。

    @param file - 模块的 __file__。
    @param name - 模块的 __name__。
    @returns 仅当作为入口脚本执行时为真。
    """
    if name == "__main__":
        return True
    stem = pathlib.Path(file).stem
    if name != stem:
        return False
    try:
        here = pathlib.Path(file).resolve()
        return any(
            pathlib.Path(arg).resolve() == here
            for arg in sys.argv[1:]
            if arg
        )
    except (OSError, RuntimeError):
        return False
