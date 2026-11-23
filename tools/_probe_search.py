# -*- coding: utf-8 -*-
from __future__ import print_function
import re
from curl_cffi import requests

try:
    from urllib.parse import quote
except ImportError:
    from urllib import quote

q = "树皮术"
qe = quote(q)
candidates = [
    "https://www.wowhead.com/search/suggestions?q=" + qe,
    "https://nether.wowhead.com/search/suggestions?locale=4&q=" + qe,
    "https://html.duckduckgo.com/html/?q=" + quote("site:wowhead.com " + q + " spell"),
    "https://www.bing.com/search?q=" + quote("site:wowhead.com " + q + " spell") + "&setlang=zh-CN",
]
spell_re = re.compile(
    r"https?://(?:www\.)?wowhead\.com/[^\s\"'<>]*spell=\d+[^\s\"'<>]*",
    re.I,
)
rel_re = re.compile(r"/[^\s\"'<>]*spell=\d+[^\s\"'<>]*", re.I)

for u in candidates:
    print("====", u[:90])
    try:
        r = requests.get(
            u,
            impersonate="chrome110",
            timeout=30,
            headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "zh-CN,zh;q=0.9"},
        )
        t = r.text
        print("status", r.status_code, "len", len(t))
        print("head", t[:200].replace("\n", " "))
        links = spell_re.findall(t)
        if not links:
            rels = rel_re.findall(t)
            links = ["https://www.wowhead.com" + x for x in rels[:10]]
        print("links", links[:8])
    except Exception as e:
        print("ERR", e)
