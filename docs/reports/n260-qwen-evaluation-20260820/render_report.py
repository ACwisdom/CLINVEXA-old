from __future__ import annotations

import html
from pathlib import Path

import markdown


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "N260-Qwen-CLINVEXA-完整测试报告.md"
OUTPUT = ROOT / "N260-Qwen-CLINVEXA-完整测试报告.html"


def main() -> None:
    source = SOURCE.read_text(encoding="utf-8")
    body = markdown.markdown(
        source,
        extensions=["tables", "fenced_code", "toc", "sane_lists"],
        output_format="html5",
    )
    title = "N260 Qwen 远程调用与 CLINVEXA 完整功能测试报告"
    document = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    :root {{ color-scheme: light; --ink:#172033; --muted:#5f6b7a; --line:#dbe3ef; --accent:#0957a4; --warn:#a33a23; --soft:#f5f8fc; }}
    * {{ box-sizing:border-box; }}
    html {{ background:#eef3f8; }}
    body {{ margin:0; color:var(--ink); font:15px/1.72 "Segoe UI","Microsoft YaHei",Arial,sans-serif; overflow-x:hidden; }}
    main {{ width:min(1120px,calc(100% - 32px)); margin:24px auto 56px; padding:48px 56px; background:#fff; border:1px solid var(--line); border-radius:14px; box-shadow:0 14px 40px rgba(20,39,69,.08); }}
    h1 {{ font-size:32px; line-height:1.25; margin:0 0 24px; color:#0b2747; }}
    h2 {{ margin:38px 0 14px; padding-top:8px; border-top:1px solid var(--line); font-size:23px; color:#123f6c; }}
    h3 {{ margin:26px 0 10px; font-size:18px; }}
    p, li {{ overflow-wrap:anywhere; }}
    strong {{ color:#102b4a; }}
    code {{ background:#edf3f9; border:1px solid #dfe8f2; border-radius:5px; padding:.12em .35em; font-family:Consolas,monospace; font-size:.92em; overflow-wrap:anywhere; }}
    pre {{ max-width:100%; overflow:auto; background:#0e1726; color:#eef6ff; padding:16px; border-radius:8px; }}
    table {{ width:100%; border-collapse:collapse; table-layout:fixed; margin:16px 0 22px; font-size:13px; }}
    th,td {{ border:1px solid var(--line); padding:9px 10px; vertical-align:top; overflow-wrap:anywhere; }}
    th {{ background:#eaf2fb; color:#153f69; text-align:left; }}
    tr:nth-child(even) td {{ background:#fafcff; }}
    blockquote {{ margin:16px 0; padding:10px 16px; border-left:4px solid var(--accent); background:var(--soft); color:var(--muted); }}
    a {{ color:var(--accent); }}
    @media (max-width:760px) {{ main {{ width:100%; margin:0; padding:24px 18px; border:0; border-radius:0; }} h1 {{ font-size:25px; }} table {{ font-size:12px; }} th,td {{ padding:7px 6px; }} }}
    @media print {{ html {{ background:#fff; }} main {{ width:100%; margin:0; padding:18mm; border:0; box-shadow:none; }} a {{ color:inherit; text-decoration:none; }} }}
  </style>
</head>
<body><main>{body}</main></body>
</html>"""
    OUTPUT.write_text(document, encoding="utf-8")
    print(OUTPUT)


if __name__ == "__main__":
    main()
