# -*- coding: utf-8 -*-
from __future__ import print_function
import re
from curl_cffi import requests

try:
    from urllib.parse import quote, unquote
except ImportError:
    from urllib import quote, unquote

QUERY = "\u6811\u76ae\u672f"
engines = []

def try_get(name, url, impersonate="chrome110"):
    print("====", name)
    try:
        r = requests.get(
            url,
            impersonate=impersonate,
            timeout=40,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
        )
        html = r.text
        print("status", r.status_code, "len", len(html))
        # any wowhead
        wh = re.findall(r".{0,40}wowhead\.com.{0,80}", html, re.I)
        print("wowhead snippets", len(wh))
        for s in wh[:8]:
            print(" ", s.replace("\n", " ")[:140])
        spell = re.findall(r"spell=\d+", html)
        print("spell= ids", spell[:10])
        return html
    except Exception as e:
        print("ERR", e)
        return ""

# Bing
try_get(
    "bing",
    "https://www.bing.com/search?q=" + quote("site:wowhead.com " + QUERY + " spell") + "&setlang=zh-CN",
)
# Bing EN barkskin
try_get(
    "bing-en",
    "https://www.bing.com/search?q=" + quote("site:wowhead.com Barkskin spell") + "&setlang=en-US",
)
# Baidu
try_get(
    "baidu",
    "https://www.baidu.com/s?wd=" + quote("site:wowhead.com " + QUERY),
)
# DDG lite
try_get(
    "ddg-lite",
    "https://lite.duckduckgo.com/lite/?q=" + quote("site:wowhead.com " + QUERY + " spell"),
)
# Wowhead search page (may 403)
try_get(
    "wowhead-search",
    "https://www.wowhead.com/search?q=" + quote(QUERY),
)
# opensearch / suggest JSONP sometimes works without CF
try_get(
    "wh-suggest-en",
    "https://www.wowhead.com/search/suggestions-template?q=Barkskin",
)
