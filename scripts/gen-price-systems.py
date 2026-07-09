#!/usr/bin/env python3
"""Cluster KAIRUKU facilities into health systems from names (+ state).

KAIRUKU has no system/IDN field, so grouping is heuristic:
  1) Curated brand patterns for major US health systems (many are one system
     nationally or within a home region) -> confident system key.
  2) Fallback: distinctive brand-key + state. Facilities in the same state
     sharing the same stripped brand key are treated as sisters.
Everything is emitted with the method used, so the tool can show its work.
"""
import json, re, sys
from collections import defaultdict

L = json.load(open("facilities-list.json"))

# --- Curated brands: (system name, [patterns], home-states or None=national) ---
# Patterns match against the lowercased, punctuation-normalized name.
SYSTEMS = [
    ("Kaiser Permanente", ["kaiser"], None),
    ("HCA Healthcare", ["hca "], None),
    ("Cleveland Clinic", ["cleveland clinic"], None),
    ("Mayo Clinic", ["mayo clinic", "mayo "], None),
    ("Ascension", ["ascension"], None),
    ("CommonSpirit / Dignity Health", ["dignity", "commonspirit", "catholic health initiatives"], None),
    ("Providence", ["providence"], None),
    ("Trinity Health", ["trinity health"], None),
    ("Tenet Healthcare", ["tenet"], None),
    ("Baylor Scott & White", ["baylor scott", "baylor, scott", "baylor university medical", "scott and white", "scott & white"], ["TX"]),
    ("Texas Health Resources", ["texas health"], ["TX"]),
    ("Memorial Hermann", ["memorial hermann"], ["TX"]),
    ("Methodist (Houston)", ["houston methodist"], ["TX"]),
    ("Christus Health", ["christus"], None),
    ("Memorial Hermann", ["memorial hermann"], None),
    ("Henry Ford Health", ["henry ford"], ["MI"]),
    ("Corewell Health (Beaumont/Spectrum)", ["beaumont", "spectrum health", "corewell"], ["MI"]),
    ("Trinity Health Michigan", ["saint joseph mercy", "st joseph mercy", "st. joseph mercy", "mercy health saint", "ihagram"], ["MI"]),
    ("Sutter Health", ["sutter"], ["CA"]),
    ("Providence (CA)", ["providence"], ["CA"]),
    ("Cedars-Sinai", ["cedars"], ["CA"]),
    ("UCLA Health", ["ucla", "ronald reagan"], ["CA"]),
    ("UCSF Health", ["ucsf", "uc san francisco"], ["CA"]),
    ("UC Health (CA)", ["uc davis", "uc irvine", "uc san diego", "uc riverside"], ["CA"]),
    ("Stanford Health", ["stanford"], ["CA"]),
    ("Scripps Health", ["scripps"], ["CA"]),
    ("Sharp HealthCare", ["sharp "], ["CA"]),
    ("Dignity Health (CA)", ["dignity"], ["CA"]),
    ("Adventist Health", ["adventist health"], None),
    ("AdventHealth / Florida Hospital", ["adventhealth", "florida hospital"], None),
    ("Banner Health", ["banner"], None),
    ("Intermountain Health", ["intermountain"], None),
    ("Geisinger", ["geisinger"], ["PA"]),
    ("UPMC", ["upmc", "univ. of pittsburgh medical", "university of pittsburgh medical"], ["PA"]),
    ("Penn Medicine", ["penn medicine", "hospital of the university of pennsylvania", "penn presbyterian", "pennsylvania hospital"], ["PA"]),
    ("Jefferson Health", ["jefferson"], ["PA"]),
    ("Main Line Health", ["main line"], ["PA"]),
    ("Novant Health", ["novant"], None),
    ("Atrium Health", ["atrium", "carolinas medical", "carolinas healthcare"], None),
    ("Duke Health", ["duke "], ["NC"]),
    ("UNC Health", ["unc ", "university of north carolina"], ["NC"]),
    ("WakeMed", ["wakemed"], ["NC"]),
    ("Cone Health", ["cone health"], ["NC"]),
    ("Sentara", ["sentara"], None),
    ("Bon Secours Mercy Health", ["bon secours"], None),
    ("Inova", ["inova"], ["VA"]),
    ("VCU Health", ["vcu", "virginia commonwealth", "medical college of virginia"], ["VA"]),
    ("Advocate Health", ["advocate", "aurora health", "aurora medical", "aurora st"], None),
    ("NorthShore / Endeavor Health", ["northshore", "endeavor health", "swedish covenant"], ["IL"]),
    ("Northwestern Medicine", ["northwestern"], ["IL"]),
    ("Rush", ["rush "], ["IL"]),
    ("UChicago Medicine", ["university of chicago"], ["IL"]),
    ("Loyola Medicine", ["loyola"], ["IL"]),
    ("OSF HealthCare", ["osf "], ["IL"]),
    ("IU Health", ["iu health", "indiana university health"], ["IN"]),
    ("Community Health Network (IN)", ["community health network", "community hospital north", "community hospital east", "community hospital south"], ["IN"]),
    ("Franciscan Health", ["franciscan"], None),
    ("Beacon Health", ["beacon health", "memorial hospital of south bend"], ["IN"]),
    ("Cleveland Clinic (OH)", ["cleveland clinic"], ["OH"]),
    ("University Hospitals (OH)", ["university hospitals"], ["OH"]),
    ("OhioHealth", ["ohiohealth", "riverside methodist", "grant medical", "doctors hospital"], ["OH"]),
    ("Mercy Health (OH/KY)", ["mercy health"], ["OH", "KY"]),
    ("ProMedica", ["promedica"], None),
    ("MetroHealth", ["metrohealth"], ["OH"]),
    ("Wexner / Ohio State", ["ohio state", "wexner"], ["OH"]),
    ("Michigan Medicine", ["university of michigan", "michigan medicine"], ["MI"]),
    ("Sparrow Health", ["sparrow"], ["MI"]),
    ("Bronson", ["bronson"], ["MI"]),
    ("Munson Healthcare", ["munson"], ["MI"]),
    ("Mercy (St. Louis / MO-AR-OK-KS)", ["mercy hospital", "mercy medical", "mercy clinic", "mercy south", "mercy jefferson"], ["MO", "AR", "OK", "KS"]),
    ("SSM Health", ["ssm health", "ssm "], None),
    ("BJC HealthCare", ["bjc", "barnes-jewish", "barnes jewish", "missouri baptist", "christian hospital"], ["MO"]),
    ("Saint Luke's (KC)", ["saint luke's", "saint lukes"], ["MO", "KS"]),
    ("University of Kansas Health", ["university of kansas"], ["KS"]),
    ("Nebraska Medicine", ["nebraska medicine", "university of nebraska"], ["NE"]),
    ("CHI Health (NE)", ["chi health"], ["NE"]),
    ("UnityPoint Health", ["unitypoint", "unity point"], None),
    ("MercyOne", ["mercyone", "mercy one"], ["IA"]),
    ("Allina Health", ["allina", "abbott northwestern", "united hospital", "mercy hospital"], ["MN"]),
    ("M Health Fairview", ["fairview", "university of minnesota medical"], ["MN"]),
    ("HealthPartners", ["healthpartners", "regions hospital", "methodist hospital"], ["MN"]),
    ("Essentia Health", ["essentia"], None),
    ("Sanford Health", ["sanford"], None),
    ("Avera Health", ["avera"], None),
    ("Aurora / Advocate (WI)", ["aurora"], ["WI"]),
    ("Froedtert", ["froedtert"], ["WI"]),
    ("SSM Health (WI)", ["ssm"], ["WI"]),
    ("Marshfield Clinic", ["marshfield"], ["WI"]),
    ("Gundersen", ["gundersen"], None),
    ("ThedaCare", ["thedacare"], ["WI"]),
    ("Bellin Health", ["bellin"], ["WI"]),
    ("UW Health", ["uw health", "university of wisconsin"], ["WI"]),
    ("Mass General Brigham", ["massachusetts general", "brigham", "mass general", "mgh", "faulkner", "newton-wellesley", "north shore medical"], ["MA"]),
    ("Beth Israel Lahey", ["beth israel", "lahey", "mount auburn", "winchester hospital"], ["MA"]),
    ("Boston Medical Center", ["boston medical"], ["MA"]),
    ("Tufts Medicine", ["tufts", "lowell general", "melrose-wakefield"], ["MA"]),
    ("UMass Memorial", ["umass", "university of massachusetts"], ["MA"]),
    ("Baystate Health", ["baystate"], ["MA"]),
    ("Yale New Haven Health", ["yale"], ["CT"]),
    ("Hartford HealthCare", ["hartford"], ["CT"]),
    ("Nuvance Health", ["nuvance", "danbury hospital", "norwalk hospital"], ["CT"]),
    ("Trinity Health Of New England", ["saint francis hospital and medical", "st francis hospital and medical"], ["CT"]),
    ("Dartmouth Health", ["dartmouth"], None),
    ("Northwell Health", ["northwell", "north shore university", "long island jewish", "lenox hill"], ["NY"]),
    ("NewYork-Presbyterian", ["newyork-presbyterian", "new york presbyterian", "new york-presbyterian", "weill cornell", "columbia university"], ["NY"]),
    ("Mount Sinai Health", ["mount sinai", "mt sinai", "mt. sinai"], ["NY"]),
    ("NYU Langone", ["nyu ", "langone"], ["NY"]),
    ("Montefiore", ["montefiore"], ["NY"]),
    ("NYC Health + Hospitals", ["nyc health", "bellevue", "kings county", "elmhurst hospital"], ["NY"]),
    ("Rochester Regional Health", ["rochester regional", "rochester general", "unity hospital"], ["NY"]),
    ("University of Rochester (URMC)", ["strong memorial", "university of rochester", "highland hospital"], ["NY"]),
    ("Kaleida Health", ["kaleida", "buffalo general", "millard fillmore"], ["NY"]),
    ("Catholic Health (Buffalo)", ["catholic health"], ["NY"]),
    ("Albany Med Health", ["albany med"], ["NY"]),
    ("RWJBarnabas Health", ["rwj", "robert wood johnson", "barnabas", "jersey city medical", "newark beth israel", "saint barnabas"], ["NJ"]),
    ("Hackensack Meridian", ["hackensack", "meridian", "jersey shore university"], ["NJ"]),
    ("Atlantic Health", ["atlantic health", "morristown medical", "overlook medical"], ["NJ"]),
    ("Virtua Health", ["virtua"], ["NJ"]),
    ("Cooper University Health", ["cooper "], ["NJ"]),
    ("Valley Health (NJ)", ["valley hospital"], ["NJ"]),
    ("Johns Hopkins", ["johns hopkins", "hopkins"], ["MD"]),
    ("University of Maryland Medical", ["university of maryland"], ["MD"]),
    ("MedStar Health", ["medstar"], None),
    ("LifeBridge Health", ["lifebridge", "sinai hospital of baltimore", "northwest hospital"], ["MD"]),
    ("Luminis Health", ["luminis", "anne arundel", "aamc"], ["MD"]),
    ("Emory Healthcare", ["emory"], ["GA"]),
    ("Piedmont Healthcare", ["piedmont"], ["GA"]),
    ("Wellstar Health", ["wellstar"], ["GA"]),
    ("Northside Hospital (GA)", ["northside hospital"], ["GA"]),
    ("Grady Health", ["grady"], ["GA"]),
    ("Prisma Health", ["prisma", "greenville memorial", "greenville health"], ["SC"]),
    ("MUSC Health", ["musc", "medical university of south carolina"], ["SC"]),
    ("Roper St. Francis", ["roper"], ["SC"]),
    ("Bon Secours (SC)", ["bon secours"], ["SC"]),
    ("Atrium Health Wake Forest Baptist", ["wake forest baptist", "wake forest", "atrium health wake"], ["NC"]),
    ("Vidant / ECU Health", ["vidant", "ecu health", "east carolina"], ["NC"]),
    ("Cape Fear Valley", ["cape fear"], ["NC"]),
    ("Vanderbilt Health", ["vanderbilt"], ["TN"]),
    ("Ballad Health", ["ballad", "wellmont", "mountain states"], ["TN"]),
    ("Methodist Le Bonheur", ["methodist le bonheur", "le bonheur"], ["TN"]),
    ("Baptist Memorial Health", ["baptist memorial"], ["TN", "MS", "AR"]),
    ("Ascension Saint Thomas", ["saint thomas", "st thomas", "st. thomas"], ["TN"]),
    ("UofL Health / Norton (KY)", ["norton "], ["KY"]),
    ("UK HealthCare", ["university of kentucky", "uk healthcare", "uk chandler"], ["KY"]),
    ("Baptist Health (KY)", ["baptist health"], ["KY"]),
    ("Ochsner Health", ["ochsner"], ["LA"]),
    ("LCMC Health", ["lcmc", "university medical center new orleans", "children's hospital new orleans", "touro", "west jefferson medical", "east jefferson"], ["LA"]),
    ("Franciscan Missionaries (LA)", ["our lady of the lake", "our lady of lourdes", "st francis medical center"], ["LA"]),
    ("Willis-Knighton", ["willis-knighton", "willis knighton"], ["LA"]),
    ("UAB Medicine", ["uab", "university of alabama at birmingham"], ["AL"]),
    ("Infirmary Health", ["infirmary"], ["AL"]),
    ("Huntsville Hospital", ["huntsville hospital"], ["AL"]),
    ("Baptist Health (AL)", ["baptist health"], ["AL"]),
    ("University of Mississippi (UMMC)", ["university of mississippi"], ["MS"]),
    ("Baptist Memorial (MS)", ["baptist"], ["MS"]),
    ("UF Health", ["uf health", "university of florida", "shands"], ["FL"]),
    ("Baptist Health South Florida", ["baptist"], ["FL"]),
    ("Orlando Health", ["orlando health"], ["FL"]),
    ("AdventHealth (FL)", ["adventhealth", "florida hospital"], ["FL"]),
    ("Tampa General", ["tampa general"], ["FL"]),
    ("Memorial Healthcare (FL)", ["memorial regional", "memorial hospital"], ["FL"]),
    ("Cleveland Clinic Florida", ["cleveland clinic"], ["FL"]),
    ("Jackson Health", ["jackson memorial", "jackson health", "jackson south", "jackson north"], ["FL"]),
    ("BayCare", ["baycare", "st joseph's hospital", "morton plant", "mease"], ["FL"]),
    ("Lee Health", ["lee health", "lee memorial", "gulf coast medical", "healthpark"], ["FL"]),
    ("Banner Health (AZ)", ["banner"], ["AZ"]),
    ("Abrazo / Tenet (AZ)", ["abrazo"], ["AZ"]),
    ("HonorHealth", ["honorhealth", "honor health", "scottsdale healthcare"], ["AZ"]),
    ("Dignity Health (AZ)", ["dignity", "st joseph's hospital and medical", "chandler regional", "mercy gilbert"], ["AZ"]),
    ("Valleywise Health", ["valleywise", "maricopa"], ["AZ"]),
    ("Mayo Clinic (AZ)", ["mayo"], ["AZ"]),
    ("Intermountain (UT)", ["intermountain"], ["UT"]),
    ("University of Utah Health", ["university of utah"], ["UT"]),
    ("MountainStar (HCA UT)", ["mountainstar", "st mark's hospital", "ogden regional", "timpanogos"], ["UT"]),
    ("Renown Health", ["renown"], ["NV"]),
    ("University Medical Center (NV)", ["umc ", "university medical center of southern"], ["NV"]),
    ("SCL Health / Intermountain (CO)", ["scl health", "good samaritan medical", "st joseph hospital", "lutheran medical", "st mary's medical"], ["CO"]),
    ("UCHealth", ["uchealth", "university of colorado", "poudre valley", "memorial hospital central"], ["CO"]),
    ("Centura Health", ["centura", "penrose", "porter adventist", "littleton adventist", "parker adventist"], ["CO"]),
    ("Denver Health", ["denver health"], ["CO"]),
    ("Children's Hospital Colorado", ["children's hospital colorado"], ["CO"]),
    ("OHSU", ["ohsu", "oregon health"], ["OR"]),
    ("Legacy Health", ["legacy "], ["OR"]),
    ("Providence (OR)", ["providence"], ["OR"]),
    ("Salem Health", ["salem health", "salem hospital"], ["OR"]),
    ("Asante", ["asante"], ["OR"]),
    ("PeaceHealth", ["peacehealth"], None),
    ("UW Medicine", ["uw medicine", "harborview", "university of washington medical"], ["WA"]),
    ("Providence (WA)", ["providence", "swedish "], ["WA"]),
    ("MultiCare", ["multicare"], ["WA"]),
    ("Virginia Mason Franciscan", ["virginia mason", "st joseph medical", "st. clare", "st francis", "st anne"], ["WA"]),
    ("Confluence Health", ["confluence"], ["WA"]),
    ("Banner (WY etc)", ["banner"], ["WY"]),
    ("Bryan Health", ["bryan "], ["NE"]),
    ("St. Luke's (ID)", ["st luke's", "st. luke's", "saint luke's"], ["ID"]),
    ("St. Alphonsus (Trinity ID)", ["st alphonsus", "saint alphonsus", "st. alphonsus"], ["ID"]),
    ("Billings Clinic", ["billings clinic"], ["MT"]),
    ("Benefis Health", ["benefis"], ["MT"]),
    ("St. Vincent (MT)", ["st vincent", "saint vincent"], ["MT"]),
    ("University of New Mexico Health", ["university of new mexico", "unm "], ["NM"]),
    ("Presbyterian Healthcare (NM)", ["presbyterian"], ["NM"]),
    ("CHRISTUS (NM)", ["christus"], ["NM"]),
    ("University of Vermont Health", ["university of vermont", "uvm ", "central vermont", "porter medical"], ["VT"]),
    ("MaineHealth", ["mainehealth", "maine medical", "southern maine health"], ["ME"]),
    ("Northern Light Health", ["northern light", "eastern maine"], ["ME"]),
    ("WVU Medicine", ["wvu", "west virginia university", "j.w. ruby", "united hospital center"], ["WV"]),
    ("CAMC", ["charleston area medical", "camc"], ["WV"]),
    ("Marshall Health", ["cabell huntington", "marshall health"], ["WV"]),
    ("University of Iowa Health Care", ["university of iowa"], ["IA"]),
    ("Prisma / other", ["prisma"], None),
    ("OU Health", ["ou health", "university of oklahoma", "oklahoma university"], ["OK"]),
    ("SSM Health (OK)", ["ssm", "st anthony", "bone and joint hospital"], ["OK"]),
    ("INTEGRIS Health", ["integris"], ["OK"]),
    ("Hillcrest (Ardent OK)", ["hillcrest"], ["OK"]),
    ("Saint Francis Health (Tulsa)", ["saint francis", "st francis"], ["OK"]),
    ("University Health (San Antonio)", ["university health", "university hospital"], ["TX"]),
    ("UT Southwestern", ["ut southwestern", "university of texas southwestern"], ["TX"]),
    ("UT MD Anderson", ["md anderson", "anderson cancer"], ["TX"]),
    ("UTMB Health", ["utmb", "university of texas medical branch"], ["TX"]),
    ("Parkland Health", ["parkland"], ["TX"]),
    ("Methodist Health System (Dallas)", ["methodist "], ["TX"]),
    ("Medical City (HCA TX)", ["medical city"], ["TX"]),
    ("Baptist Health System (San Antonio)", ["baptist"], ["TX"]),
    ("University Medical Center (Lubbock)", ["university medical center"], ["TX"]),
    ("Cook Children's", ["cook children"], ["TX"]),
    ("Children's Health (Dallas)", ["children's medical center", "children's health"], ["TX"]),
]

GENERIC = set("""hospital hospitals medical center centre health healthcare care system systems
surgery surgical surgicenter surgcenter ambulatory outpatient clinic clinics institute
regional community memorial general university the of and at for llc llp inc pc pa
campus tower pavilion north south east west central main downtown midtown foundation
county district municipal city county's va veterans affairs shriners specialty ortho
orthopedic orthopaedic spine sports womens women's children children's kids pediatric
saint st st. mount mt mt. new""".split())

def norm(s):
    s = s.lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def brand_key(name):
    """Distinctive leading tokens with generic words removed."""
    toks = [t for t in norm(name).split() if t not in GENERIC]
    return " ".join(toks[:3])

def match_curated(name, state):
    n = norm(name)
    for sysname, pats, states in SYSTEMS:
        if states and state not in states:
            continue
        for p in pats:
            if p in n:
                return sysname
    return None

# assign
for f in L:
    f["n"] = norm(f["name"])
    f["state"] = (f.get("state") or "").strip()

assigned = {}
for f in L:
    s = match_curated(f["name"], f["state"])
    if s:
        assigned[f["id"]] = ("brand", s)

# fallback: brand-key + state, only for unassigned, when >=2 share it
bk = defaultdict(list)
for f in L:
    if f["id"] in assigned:
        continue
    key = brand_key(f["name"])
    if len(key) >= 4:  # need a distinctive key
        bk[(key, f["state"])].append(f["id"])
for (key, st), ids in bk.items():
    if len(ids) >= 2:
        label = key.title() + (" (" + st + ")" if st else "")
        for i in ids:
            assigned[i] = ("name+state", label)

# report
from collections import Counter
methods = Counter(v[0] for v in assigned.values())
sysmembers = defaultdict(list)
for f in L:
    a = assigned.get(f["id"])
    if a:
        sysmembers[a[1]].append(f)
singletons = sum(1 for f in L if f["id"] not in assigned)
print(f"assigned: {len(assigned)}  singletons: {singletons}  systems: {len(sysmembers)}")
print("methods:", dict(methods))
multi = {k: v for k, v in sysmembers.items() if len(v) >= 2}
print(f"multi-facility systems: {len(multi)}")
print("--- largest systems ---")
for k, v in sorted(sysmembers.items(), key=lambda kv: -len(kv[1]))[:25]:
    print(f'{len(v):4d}  {k}')

# spot-check a few known ones
def show(namefrag):
    for k, v in sysmembers.items():
        if any(namefrag.lower() in f["name"].lower() for f in v):
            print(f'\n[{k}] ({len(v)}):')
            for f in v[:12]:
                print(f'   #{f["id"]}  {f["name"]} — {f["city"]}, {f["state"]}')
            break
for q in ["Abrazo", "Memorial Hermann", "Kaiser"]:
    show(q)

# save mapping
out = {}
for f in L:
    a = assigned.get(f["id"])
    out[str(f["id"])] = {"system": a[1] if a else None, "method": a[0] if a else "singleton"}
json.dump(out, open("systems.json", "w"))
print("\nwrote systems.json")
