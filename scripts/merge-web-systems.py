#!/usr/bin/env python3
"""Merge web-verified system assignments over the AI mapping.

base   = systems-ai.json  ({id: {system, method}})  — the memory-only pass
web    = web-out/sys_*.json ({id: label|null})       — web-verified, only for ungrouped
Web results only FILL nulls (the ungrouped); already-grouped facilities keep theirs.
Output: systems.json  ({id: {system: canon|null, method}})
"""
import json, os, re, glob
from collections import defaultdict, Counter

S = os.path.dirname(os.path.abspath(__file__))
L = json.load(open(f"{S}/facilities-list.json"))
id_name = {str(f["id"]): f for f in L}
base = json.load(open(f"{S}/systems-ai.json"))

web = {}
for p in glob.glob(f"{S}/web-out/sys_*.json"):
    for k, v in json.load(open(p)).items():
        web[str(k)] = v.strip() if isinstance(v, str) and v.strip() else None

# Combine: base system wins if present; else web fills.
raw = {}
method = {}
for fid in id_name:
    b = base.get(fid, {"system": None, "method": "singleton"})
    if b.get("system"):
        raw[fid] = b["system"]; method[fid] = b.get("method", "ai")
    elif web.get(fid):
        raw[fid] = web[fid]; method[fid] = "web"
    else:
        raw[fid] = None; method[fid] = "singleton"

# Canonicalize labels: merge ones identical after normalization.
def norm(s):
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[.,'\-/]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

variants = defaultdict(Counter)
for v in raw.values():
    if v:
        variants[norm(v)][v] += 1
canon = {k: c.most_common(1)[0][0] for k, c in variants.items()}

out = {}
members = defaultdict(list)
for fid in id_name:
    v = raw[fid]
    label = canon[norm(v)] if v else None
    out[fid] = {"system": label, "method": method[fid]}
    if label:
        members[label].append(fid)

json.dump(out, open(f"{S}/systems.json", "w"))

n_grouped = sum(1 for x in out.values() if x["system"])
by_method = Counter(x["method"] for x in out.values() if x["system"])
multi = {k: v for k, v in members.items() if len(v) >= 2}
print(f"grouped: {n_grouped}/{len(out)} | independent: {len(out)-n_grouped}")
print(f"by method: {dict(by_method)}")
print(f"distinct systems: {len(members)} | multi-facility: {len(multi)}")
print("\n--- largest ---")
for k, v in sorted(members.items(), key=lambda kv: -len(kv[1]))[:15]:
    print(f"{len(v):4d}  {k}")

def show(frag):
    for fid, f in id_name.items():
        if frag.lower() in f["name"].lower():
            print(f"  #{fid} {f['name']} ({f['state']}) -> {out[fid]['system']} [{out[fid]['method']}]")
            break
print("\n--- spot checks ---")
for q in ["River Hills Surgery", "Ukiah Valley", "St Helena Hospital", "Castle Medical Center"]:
    show(q)
