# -*- coding: utf-8 -*-
from __future__ import print_function
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from wowhead_icon_dl import main, make_session, resolve_query_to_url, search_ddg

# 避免源文件编码在某些环境下被误读
QUERY = "\u6811\u76ae\u672f"  # 树皮术

def debug():
    session, backend = make_session()
    print("backend", backend)
    print("query", QUERY, [hex(ord(c)) for c in QUERY])
    try:
        links, eng = search_ddg(session, QUERY)
        print("ddg links", len(links), links[:5])
    except Exception as e:
        print("ddg err", e)
    try:
        url, eng, cands = resolve_query_to_url(session, QUERY, preferred_flavor="classic")
        print("resolved", url, eng, cands[:3])
    except Exception as e:
        print("resolve err", e)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "debug":
        debug()
        sys.exit(0)
    sys.exit(main([QUERY, "--flavor", "classic"]))
