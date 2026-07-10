#!/usr/bin/env python3
"""Merge the 14 AI system-mapping slices into one canonical systems.json.

Output format matches what gen-price-data.mjs expects:
  { "<id>": {"system": "<canonical name>"|null, "method": "ai"|"singleton"} }
"""
import json, os, re, glob
from collections import Counter, defaultdict

S = os.path.dirname(os.path.abspath(__file__))
L = json.load(open(f"{S}/facilities-list.json"))
all_ids = {str(f["id"]) for f in L}
id_name = {str(f["id"]): f for f in L}

# 1) Load all slice outputs
raw = {}
for p in sorted(glob.glob(f"{S}/ai-out/sys_*.json")):
    d = json.load(open(p))
    for k, v in d.items():
        raw[str(k)] = v.strip() if isinstance(v, str) and v.strip() else None

missing = all_ids - set(raw)
print(f"loaded {len(raw)} ids from AI; missing {len(missing)}")

# 2) Canonicalize labels: merge ones that are identical after normalization.
def norm(s):
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[.,'\-/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

variants = defaultdict(Counter)
for v in raw.values():
    if v:
        variants[norm(v)][v] += 1
canon = {k: cnt.most_common(1)[0][0] for k, cnt in variants.items()}

assigned = {}
for i, v in raw.items():
    assigned[i] = canon[norm(v)] if v else None

# 3) Emit systems.json
out = {}
members = defaultdict(list)
for i in all_ids:
    sysname = assigned.get(i)
    out[i] = {"system": sysname, "method": "ai" if sysname else "singleton"}
    if sysname:
        members[sysname].append(i)

# Drop "systems" that ended up with only ONE facility -> not useful as a group,
# but KEEP the label (a lone facility in a real system is fine; it just has no sisters).
json.dump(out, open(f"{S}/systems-ai.json", "w"))

nassigned = sum(1 for v in out.values() if v["system"])
multi = {k: v for k, v in members.items() if len(v) >= 2}
print(f"assigned {nassigned}/{len(all_ids)} | distinct systems {len(members)} | multi-facility systems {len(multi)}")
print("distinct raw labels:", sum(len(c) for c in variants.values()), "-> canonical:", len(canon))
print("\n--- largest systems ---")
for k, v in sorted(members.items(), key=lambda kv: -len(kv[1]))[:20]:
    print(f"{len(v):4d}  {k}")

def check(frag):
    for i, f in id_name.items():
        if frag.lower() in f["name"].lower():
            print(f"  #{i} {f['name']} ({f['state']}) -> {assigned.get(i)}")

print("\n--- spot checks (off-brand cases) ---")
for q in ["Kaiser Sunnyside", "Adventist GlenOaks", "Adena Regional", "Adena Pike", "Affinity Health", "Du Pont Hospital"]:
    check(q)
