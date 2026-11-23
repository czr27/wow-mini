# -*- coding: utf-8 -*-
import subprocess
import sys
from pathlib import Path

src = Path(r"G:/Desktop/wow_simu/R1_启动.bat").read_text(encoding="gbk")
marker = ":: 每次启动都编译 engine"
idx = src.find(marker)
if idx < 0:
    print("marker missing")
    sys.exit(2)

smoke = src[:idx] + "echo [SMOKE] parse OK\r\nexit /b 0\r\n"
smoke = smoke.replace("pause", "rem pause")
smoke_path = Path(r"G:/Desktop/wow_simu/_r1_smoke.bat")
smoke_path.write_bytes(smoke.encode("gbk"))

r = subprocess.run(
    ["cmd", "/c", str(smoke_path)],
    cwd=r"G:/Desktop/wow_simu",
    capture_output=True,
)
out = r.stdout.decode("gbk", errors="replace") + r.stderr.decode(
    "gbk", errors="replace"
)
smoke_path.unlink(missing_ok=True)

sys.stdout.reconfigure(encoding="utf-8")
print("exit", r.returncode)
print(out)

if "'exist'" in out or "不是内部或外部命令" in out:
    print("FAIL: encoding still broken")
    sys.exit(1)
if "[SMOKE] parse OK" in out:
    print("PASS")
    sys.exit(0)

print("UNEXPECTED")
sys.exit(1)
