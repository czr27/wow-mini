# -*- coding: utf-8 -*-
from __future__ import print_function
import re
from curl_cffi import requests

try:
    from urllib.parse import quote
except ImportError:
    from urllib import quote

QUERY = "\u6811\u76ae\u672f"
q = "site:wowhead.com {} spell".format(QUERY)
url = "https://html.duckduckgo.com/html/?q=" + quote(q)
print("url", url)
r = requests.get(
    url,
    impersonate="chrome110",
    timeout=30,
    headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
)
print("status", r.status_code, "len", len(r.text))
html = r.text
# save sample
open("_ddg_sample.html", "w", encoding="utf-8").write(html)
print("wowhead count", html.lower().count("wowhead"))
print("spell= count", html.count("spell="))
# show result links
for pat in [
    r'uddg=([^&\"\']+)',
    r'href="([^"]*wowhead[^"]*)"',
    r"href='([^']*wowhead[^']*)'",
    r'class="result__a"[^>]*href="([^"]+)"',
]:
    ms = re.findall(pat, html, re.I)
    print("pat", pat, "n=", len(ms))
    for x in ms[:5]:
        print(" ", x[:160])
