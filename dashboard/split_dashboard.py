#!/usr/bin/env python3
"""Split components/dashboard.tsx into smaller files. Run from the frontend/ folder:
    python3 split_dashboard.py
Backs up the original to components/dashboard.tsx.bak first."""
import os, re, shutil, sys

SRC = "components/dashboard.tsx"
OUT = "components/dashboard"
if not os.path.exists(SRC):
    sys.exit("Run this from the frontend/ folder (components/dashboard.tsx not found)")
if os.path.exists(OUT):
    sys.exit("components/dashboard/ already exists - the split was already done. "
             "To redo it from scratch: delete components/dashboard/, restore components/dashboard.tsx.bak "
             "to components/dashboard.tsx, delete the .bak, then run again.")
if not os.path.exists(SRC + ".bak"):
    shutil.copy(SRC, SRC + ".bak")
L = open(SRC + ".bak").read().split("\n")


def idx(pat, start=0):
    for i in range(start, len(L)):
        if re.match(pat, L[i]):
            return i
    sys.exit(f"anchor not found: {pat}")


i_api = idx(r"const API =")
i_types = idx(r"type Runner = ")
i_money = idx(r"const money =")
i_stat = idx(r"function Stat\b")
i_dash = idx(r"export default function Dashboard")
i_after = next(i for i in range(i_dash, len(L)) if re.match(r"^function ", L[i]))
i_dash_end = max(i for i in range(i_dash, i_after) if L[i] == "}")

header = "\n".join(L[:i_api])
types_block = L[i_types:i_money]
helpers_block = L[i_money:i_stat]
func_lines = L[i_stat:i_dash] + L[i_after:]
dash = L[i_dash:i_dash_end + 1]

# ---- imports available from the original header
IMPORTS = {}  # local name -> (module, specifier text)
for spec, mod in re.findall(r'import\s*\{([^}]*)\}\s*from\s*"([^"]+)";', header):
    for s in spec.split(","):
        s = s.strip()
        if not s:
            continue
        local = s.split(" as ")[-1].strip()
        IMPORTS[local] = (mod, s)

type_names = [m.group(1) for l in types_block if (m := re.match(r"type (\w+)\s*=", l))]
helper_names = [m.group(1) for l in helpers_block if (m := re.match(r"const (\w+)\s*=", l))]

# ---- parse top-level functions
funcs, cur = {}, None
for l in func_lines:
    m = re.match(r"function (\w+)", l)
    if m:
        cur = m.group(1)
        funcs[cur] = []
    if cur:
        funcs[cur].append(l)
for k in funcs:
    body = funcs[k]
    while body and (not body[-1].strip() or body[-1].lstrip().startswith(("/*", "*", "=", "//"))):
        body.pop()
    funcs[k] = [("export " + body[0]) if body[0].startswith("function") else body[0]] + body[1:]

UI = ["Stat", "SectionHeader", "EmptyState", "PageTitle", "SignalBadge", "InputSelect", "ConfigRow",
      "HealthRow", "MetricBox", "RiskStat", "RiskExplanation", "SettingInput"]
CARDS = {
    "RiskCard": ["RiskCard"], "OperationsMonitor": ["OperationsMonitor"], "MarketTable": ["MarketTable"],
    "Positions": ["PositionsCard", "PositionCard", "PositionValue"], "RecentTrades": ["RecentTrades"],
    "SystemCard": ["SystemCard"],
}
missing = [n for n in UI + sum(CARDS.values(), []) if n not in funcs]
if missing:
    sys.exit(f"functions not found: {missing}")
unplaced = set(funcs) - set(UI) - set(sum(CARDS.values(), []))
if unplaced:
    sys.exit(f"unplaced functions: {unplaced}")

where = {n: "./ui" for n in UI}
for f, names in CARDS.items():
    for n in names:
        where[n] = f"./cards/{f}"
for n in type_names:
    where[n] = "./types"
for n in helper_names:
    where[n] = "./format"
where["API"] = "./config"


def build_imports(body, here):
    """Imports needed by `body`. `here` = path of the module being written, relative to OUT."""
    out, by_mod = [], {}
    for local, (mod, spec) in IMPORTS.items():
        if re.search(r"\b" + re.escape(local) + r"\b", body):
            by_mod.setdefault(mod, []).append(spec)
    for mod, specs in by_mod.items():
        out.append(f'import {{ {", ".join(specs)} }} from "{mod}";')
    sib = {}
    for name, mod in where.items():
        if mod == here:
            continue
        if re.search(r"\b" + re.escape(name) + r"\b", body):
            # relative path from `here`
            depth = here.count("/") - 1
            rel = mod if depth == 0 else "../" + mod[2:]
            if here == "./shell":
                rel = "./dashboard/" + mod[2:]
            sib.setdefault(rel, []).append(name)
    for rel, names in sib.items():
        out.append(f'import {{ {", ".join(sorted(names))} }} from "{rel}";')
    return "\n".join(out)


def write(path, body, here, client=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    imports = build_imports(body, here)
    with open(path, "w") as f:
        f.write(('"use client";\n\n' if client else "") + imports + "\n\n" + body.rstrip() + "\n")


# ---- config / types / format
write(f"{OUT}/config.ts", "export " + L[i_api], "./config", client=False)

tb = "\n".join(re.sub(r"^type ", "export type ", l) for l in types_block)
write(f"{OUT}/types.ts", tb, "./types", client=False)
hb = "\n".join(re.sub(r"^const ", "export const ", l) for l in helpers_block)
write(f"{OUT}/format.ts", hb, "./format", client=False)

# ---- ui + cards
write(f"{OUT}/ui.tsx", "\n\n".join("\n".join(funcs[n]) for n in UI), "./ui")
for f, names in CARDS.items():
    write(f"{OUT}/cards/{f}.tsx", "\n\n".join("\n".join(funcs[n]) for n in names), f"./cards/{f}")

# ---- pages
PROP_TYPES = {
    "status": "Status | null", "runners": "Runner[]", "positions": "Runner[]", "trades": "Trade[]",
    "markets": "Market[]", "runtimeEvents": "RuntimeEvent[]", "equity": "{ t: string; v: number }[]",
    "m": 'Status["metrics"] | undefined', "dailyLoss": "number", "drawdown": "number",
    "maxLosses": "number", "maxTrades": "number", "filteredMarkets": "Market[]",
    "marketSearch": "string", "setMarketSearch": "(v: string) => void",
    "signalCounts": "{ name: string; value: number }[]", "setActive": "(v: string) => void",
    "filteredTrades": "Trade[]", "tradeSearch": "string", "setTradeSearch": "(v: string) => void",
    "avgTrade": "number", "winningTrades": "Trade[]", "losingTrades": "Trade[]", "totalFees": "number",
    "tradeChart": "{ time: string; pnl: number; cumulative: number }[]",
    "backtestSymbol": "string", "setBacktestSymbol": "(v: string) => void",
    "backtestInterval": "string", "setBacktestInterval": "(v: string) => void",
    "backtestCandles": "string", "setBacktestCandles": "(v: string) => void",
    "backtestRunning": "boolean", "backtestResult": "BacktestResult | null",
    "runBacktest": "() => Promise<void>", "busy": "boolean",
    "command": "(path: string) => Promise<void>", "load": "() => Promise<void>",
}
ORDER = list(PROP_TYPES)
dash_txt = "\n".join(dash)

page_re = re.compile(r"^  const (Overview|[A-Z]\w*Page) = \(\) => ([\(\{])$")
starts = [(i, m) for i, l in enumerate(dash) if (m := page_re.match(l))]
marker = lambda i: next(j for j in range(i, len(dash)) if re.match(r"^  /\*$", dash[j]))
pages = {}
for i, m in starts:
    end = marker(i + 1) - 1
    while not dash[end].strip():
        end -= 1
    name = m.group(1) if m.group(1) != "Overview" else "OverviewPage"
    pages[name] = (i, end, m.group(2))

scope_src = "\n".join(dash[: starts[0][0]])  # Dashboard code before the first page
renders = {}
for name, (a, b, style) in pages.items():
    body = dash[a + 1:b]
    txt = "\n".join(body)
    used = []
    for p in ORDER:
        pat = r"\bm\??\." if p == "m" else r"\b" + p + r"\b"
        if re.search(pat, txt):
            used.append(p)
    sig = "{ " + ", ".join(used) + " }: {\n  " + ";\n  ".join(f"{p}: {PROP_TYPES[p]}" for p in used) + ";\n}" if used else ""
    if style == "(":
        fn = [f"export function {name}({sig}) {{", "  return ("] + body + ["  );", "}"]
    else:
        fn = [f"export function {name}({sig}) {{"] + body + ["}"]
    write(f"{OUT}/pages/{name}.tsx", "\n".join(fn), f"./pages/{name}")
    renders[name] = "<" + name + "".join(f" {p}={{{p}}}" for p in used) + " />"

# ---- rewrite the shell
first = min(a for a, _, _ in pages.values())
cut_a = first - 3  # the "/*  * OVERVIEW */" comment above
cut_b = next(j for j in range(first, len(dash)) if "ACTIVE PAGE" in dash[j]) - 1
shell = dash[:cut_a] + dash[cut_b:]
shell_txt = "\n".join(shell)
for name, r in renders.items():
    key = "Overview" if name == "OverviewPage" else name
    shell_txt = re.sub(r"<" + key + r" />", r, shell_txt)
settings_case = '      case "Settings":\n        return ' + renders["SettingsPage"] + ";\n\n"
shell_txt = shell_txt.replace('      case "Overview":', settings_case + '      case "Overview":', 1)

nav_block = "\n".join(L[i_api + 1:i_types])
write_body = nav_block + "\n\n" + shell_txt
page_imports = "\n".join(f'import {{ {n} }} from "./dashboard/pages/{n}";' for n in pages)
os.makedirs(OUT, exist_ok=True)
imports = build_imports(write_body, "./shell")
with open(SRC, "w") as f:
    f.write('"use client";\n\n' + imports + "\n" + page_imports + "\n\n" + write_body + "\n")
print("done:", ", ".join(sorted(pages)))


# =====================================================================
# Post-process: format, then remove unused imports / unused page props
# =====================================================================
import json, subprocess


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


def write_check_config():
    try:
        cfg = json.load(open("tsconfig.json"))
    except Exception:
        return False
    co = cfg.get("compilerOptions", {})
    for k in ("ignoreDeprecations", "plugins"):
        co.pop(k, None)
    co["incremental"] = False
    co["noUnusedLocals"] = True
    co["noUnusedParameters"] = True
    json.dump(cfg, open("tsconfig.split-check.json", "w"), indent=1)
    return True


def unused_errors():
    out = sh("npx tsc -p tsconfig.split-check.json --noEmit").stdout
    errs = []
    for line in out.splitlines():
        m = re.match(r"^(.+?)\((\d+),(\d+)\): error (TS\d+): (?:'(\w+)')?", line)
        if m and m.group(4) in ("TS6133", "TS6192", "TS6196"):
            errs.append((m.group(1), int(m.group(2)) - 1, int(m.group(5) is None and 0 or 0), m.group(4), m.group(5)))
    return errs, out


if write_check_config() and sh("npx prettier --version").returncode == 0:
    sh('npx prettier --write "components/**/*.{ts,tsx}"')
    for _ in range(4):
        errs, _out = unused_errors()
        errs = [e for e in errs if e[0].startswith("components/dashboard/")]
        if not errs:
            break
        shell_path = SRC
        shell_text = open(shell_path).read()
        by_file = {}
        for e in errs:
            by_file.setdefault(e[0], []).append(e)
        for path, es in by_file.items():
            lines = open(path).read().split("\n")
            page = os.path.basename(path)[:-4] if "/pages/" in path else None
            kill = set()
            for (_, ln, _c, code, name) in sorted(es, key=lambda x: -x[1]):
                text = lines[ln]
                if code == "TS6192":  # whole import unused
                    j = ln
                    while not lines[j].rstrip().endswith(";"):
                        kill.add(j); j += 1
                    kill.add(j)
                elif page and name in PROP_TYPES and re.match(r"^\s*" + name + r",?\s*$", text):
                    kill.add(ln)
                    for j in range(ln, len(lines)):  # its type line
                        if re.match(r"^\s*" + name + r": .*;\s*$", lines[j]):
                            kill.add(j); break
                    shell_text = re.sub(r"(<" + page + r"\b[^>]*?)\s+" + name + r"=\{" + name + r"\}", r"\1", shell_text)
                elif re.match(r"^\s*" + name + r"( as \w+)?,?\s*$", text):
                    kill.add(ln)  # specifier on its own line in a multi-line import
                else:  # inline specifier
                    new = re.sub(r"\b" + name + r"\b,?\s*", "", text, count=1)
                    lines[ln] = new
                    if re.match(r"^import \{\s*\} from", new):
                        kill.add(ln)
            lines = [l for i, l in enumerate(lines) if i not in kill]
            open(path, "w").write("\n".join(lines))
        open(shell_path, "w").write(shell_text)
        sh('npx prettier --write "components/**/*.{ts,tsx}"')
    os.remove("tsconfig.split-check.json")
    print("cleanup finished; now run:  npx tsc --noEmit   (or npm run build)")
else:
    print("Skipped cleanup (prettier/tsconfig not available). Run `npx prettier --write components` yourself.")