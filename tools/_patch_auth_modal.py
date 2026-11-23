# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"G:/Desktop/wow_simu/DEV/packages/web/src/components/AuthAndCharacterModal.tsx")
t = p.read_text(encoding="utf-8")

old1 = """      {/* Create Character Modal */}
      {isCreating && isLoggedIn && (
        <div className=\"fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4\">
          <div className=\"bg-[#1a1a30] border border-amber-400/60 rounded-xl p-5 max-w-md w-full space-y-4 shadow-2xl\">
            <h3 className=\"text-base font-bold text-amber-300\">创建新冒险者</h3>"""

new1 = """      {/* Create Character Modal */}
      {isCreating && isLoggedIn && (
        <DismissibleModal
          onClose={() => !createCharBusy && setIsCreating(false)}
          overlayClassName=\"bg-black/75\"
          panelClassName=\"bg-[#1a1a30] border border-amber-400/60 rounded-xl p-5 max-w-md w-full space-y-4 shadow-2xl\"
          aria-label=\"创建新冒险者\"
        >
            <h3 className=\"text-base font-bold text-amber-300\">创建新冒险者</h3>"""

if old1 not in t:
    raise SystemExit("create open missing")
t = t.replace(old1, new1, 1)

old1c = """            </form>
          </div>
        </div>
      )}

      {/* Delete / cancel account confirm */}
      {showDeleteConfirm && (
        <div className=\"fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70] p-4\">
          <div className=\"bg-[#1a1218] border border-red-600/50 rounded-2xl p-5 max-w-sm w-full space-y-3 shadow-2xl\">
            <h3 className=\"text-base font-extrabold text-red-300\">删除账号</h3>"""

new1c = """            </form>
        </DismissibleModal>
      )}

      {/* Delete / cancel account confirm */}
      {showDeleteConfirm && (
        <DismissibleModal
          onClose={() => {
            if (deleteBusy) return;
            setShowDeleteConfirm(false);
            setDeletePassword('');
            setDeleteError(null);
          }}
          zClassName=\"z-[70]\"
          panelClassName=\"bg-[#1a1218] border border-red-600/50 rounded-2xl p-5 max-w-sm w-full space-y-3 shadow-2xl\"
          aria-label=\"删除账号确认\"
        >
            <h3 className=\"text-base font-extrabold text-red-300\">删除账号</h3>"""

if old1c not in t:
    raise SystemExit("create close / delete open missing")
t = t.replace(old1c, new1c, 1)

# Delete modal already closes with </DismissibleModal> from prior partial edit —
# but if opening was still divs, we may have leftover </div> before </DismissibleModal>.
# After our replace, delete open is DismissibleModal and close should already be </DismissibleModal>.

# Fix login close: after login DismissibleModal open, replace trailing </div></div>
idx = t.find("aria-label={authMode ===")
if idx < 0:
    raise SystemExit("login aria missing")
rest = t[idx:]
old_close = """              </p>
            </form>
          </div>
        </div>
      )}"""
new_close = """              </p>
            </form>
          </div>
        </DismissibleModal>
      )}"""
if old_close not in rest:
    i2 = rest.find("</form>")
    print(repr(rest[i2 : i2 + 120]))
    raise SystemExit("login close missing")
t = t[:idx] + rest.replace(old_close, new_close, 1)

p.write_text(t, encoding="utf-8")
print("OK")
