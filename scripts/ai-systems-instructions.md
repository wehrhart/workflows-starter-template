# Map US healthcare facilities to their parent health system (IDN)

For an internal medical-device pricing tool. **Accuracy and consistency matter more than coverage.**

You are given a JSON array of facilities `{id, name, city, state}`. For EACH facility,
determine its parent health system as of your knowledge, using name + city + state.

## Rules
- Output the CANONICAL parent-system name in Title Case, no "Inc."/"LLC". Reuse these
  exact canonical spellings when applicable:
  "Kaiser Permanente", "HCA Healthcare", "Ascension", "CommonSpirit Health",
  "Tenet Healthcare", "Trinity Health", "Providence", "AdventHealth", "Adventist Health",
  "Community Health Systems", "Baylor Scott & White Health", "Memorial Hermann",
  "Houston Methodist", "Cleveland Clinic", "Mayo Clinic", "Mass General Brigham",
  "Northwell Health", "Mount Sinai Health System", "NewYork-Presbyterian",
  "NYU Langone Health", "Jefferson Health", "UPMC", "Penn Medicine", "Geisinger",
  "Atrium Health", "Novant Health", "Duke Health", "UNC Health", "Sentara Health",
  "Bon Secours Mercy Health", "Inova", "Emory Healthcare", "Piedmont Healthcare",
  "Prisma Health", "Vanderbilt Health", "Ballad Health", "Baptist Memorial Health Care",
  "Ochsner Health", "UAB Medicine", "Banner Health", "Intermountain Health",
  "Sutter Health", "Stanford Health Care", "Cedars-Sinai", "Scripps Health",
  "Sharp HealthCare", "Dignity Health", "Sanford Health", "Avera Health", "Allina Health",
  "M Health Fairview", "HealthPartners", "Essentia Health", "Advocate Health", "UW Health",
  "Bassett Healthcare Network", "Nemours Children's Health", "Corewell Health",
  "Henry Ford Health", "Michigan Medicine", "BJC HealthCare", "SSM Health", "Mercy",
  "The University of Kansas Health System", "Nebraska Medicine", "UnityPoint Health",
  "MercyOne", "OhioHealth", "University Hospitals", "ProMedica",
  "Ohio State University Wexner Medical Center", "IU Health", "Franciscan Health",
  "Parkview Health", "Adena Health System", "Kettering Health", "Premier Health",
  "TriHealth", "Norton Healthcare", "UK HealthCare", "UofL Health", "Baptist Health",
  "WVU Medicine", "ECU Health", "Cone Health", "WakeMed", "Wellstar Health System",
  "Northside Hospital", "Grady Health System", "Orlando Health", "BayCare", "Lee Health",
  "Jackson Health System", "Tampa General Hospital", "Memorial Healthcare System",
  "Baptist Health South Florida", "LCMC Health", "CHRISTUS Health", "Texas Health Resources",
  "UT Southwestern Medical Center", "Methodist Health System", "Cook Children's",
  "Hendrick Health", "INTEGRIS Health", "OU Health", "Saint Francis Health System",
  "Renown Health", "University of Utah Health", "OHSU", "Legacy Health", "PeaceHealth",
  "MultiCare", "UW Medicine", "St. Luke's Health System", "MaineHealth",
  "Northern Light Health", "Dartmouth Health", "University of Vermont Health Network",
  "Yale New Haven Health", "Hartford HealthCare", "Nuvance Health", "RWJBarnabas Health",
  "Hackensack Meridian Health", "Atlantic Health System", "Virtua Health",
  "Johns Hopkins Medicine", "University of Maryland Medical System", "MedStar Health",
  "LifeBridge Health", "Penn State Health", "Lehigh Valley Health Network",
  "WellSpan Health", "Rochester Regional Health", "University of Rochester Medical Center",
  "Kaleida Health", "Montefiore", "Stony Brook Medicine".
  For systems not listed, use the system's official common name.
- If a facility is genuinely independent, a standalone ambulatory surgery center /
  physician office / imaging center with no parent system, a military/VA facility, a
  veterinary clinic, or you are NOT reasonably confident of the parent, set the value to
  `null`. **Be conservative: null is far better than a wrong guess.**
- Use city+state to disambiguate — "St. Mary's" / "Mercy" / "St. Joseph" in different
  states are usually different systems; assign the correct regional system or null.
- CRITICAL: two facilities that belong to the same real system MUST get the byte-for-byte
  identical system string. Watch spelling, punctuation, and case.

## Output
Write ONLY a strict JSON object mapping id (string key) → system name string or null,
e.g. `{"1220":"Nemours Children's Health","6443":null}`. Every input id must appear
exactly once as a key. No prose in the file.
