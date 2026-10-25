#!/usr/bin/env python3
"""index.html이 참조하는 CSS·JS를 모두 안에 넣어, 파일 하나만으로 열리는 standalone.html을 만든다.

사용법:
    python3 tools/build_standalone.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def inline(html):
    def css(m):
        text = (ROOT / m.group(1)).read_text(encoding="utf-8")
        return "<style>\n" + text + "\n</style>"

    def js(m):
        text = (ROOT / m.group(1)).read_text(encoding="utf-8")
        return "<script>\n" + text.replace("</script", "<\\/script") + "\n</script>"

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', js, html)
    return html


def main():
    src = (ROOT / "index.html").read_text(encoding="utf-8")
    out = inline(src).replace(
        "<head>",
        "<head>\n  <!-- 자동 생성 파일: tools/build_standalone.py 로 index.html에서 만듦. 직접 고치지 말 것 -->", 1)
    dst = ROOT / "standalone.html"
    dst.write_text(out, encoding="utf-8")
    print(f"{dst.name}: {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
