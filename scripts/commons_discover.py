"""Discovery pass: find candidate Commons categories + files for each landmark."""
import urllib.request, urllib.parse, json, time, sys, re

UA = "Bengaluru3D/1.0 (3D city landmark photo collection; https://example.com/bengaluru; dev@example.com) python-urllib"
API = "https://commons.wikimedia.org/w/api.php"
_cache = {}


def api(params):
    key = tuple(sorted(params.items()))
    if key in _cache:
        return _cache[key]
    params = dict(params)
    params.setdefault("format", "json")
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=45) as r:
                data = json.loads(r.read().decode("utf-8"))
            _cache[key] = data
            time.sleep(0.12)
            return data
        except Exception as e:
            if attempt == 3:
                print(f"  ! api fail {params.get('action')} {params.get('srsearch') or params.get('cmtitle')}: {e}",
                      file=sys.stderr)
                return {}
            time.sleep(1.5 * (attempt + 1))
    return {}


def search_categories(term, limit=15):
    """Find Category: names matching a term (namespace 14)."""
    d = api({"action": "query", "list": "search", "srsearch": term, "srnamespace": 14, "srlimit": limit})
    out = []
    for r in d.get("query", {}).get("search", []):
        out.append(r["title"])
    return out


def search_files(term, limit=50):
    """Find File: pages matching a term (namespace 6)."""
    d = api({"action": "query", "list": "search", "srsearch": term, "srnamespace": 6, "srlimit": limit})
    return [r["title"] for r in d.get("query", {}).get("search", [])]


def cat_members(cat, limit=100):
    d = api({"action": "query", "list": "categorymembers", "cmtitle": cat, "cmtype": "file", "cmlimit": limit})
    return [m["title"] for m in d.get("query", {}).get("categorymembers", [])]


def subcats(cat, limit=50):
    d = api({"action": "query", "list": "categorymembers", "cmtitle": cat, "cmtype": "subcat", "cmlimit": limit})
    return [m["title"] for m in d.get("query", {}).get("categorymembers", [])]


LANDMARKS = {
    "vidhana-soudha": ["Vidhana Soudha", "Vidhana Soudha Karnataka"],
    "bangalore-palace": ["Bangalore Palace"],
    "tipu-palace": ["Tipu Sultan Summer Palace", "Tipu Sultan's Summer Palace", "Summer Palace Bangalore"],
    "iskcon-temple": ["ISKCON Bangalore", "ISKCON Temple Bangalore", "Sri Radha Krishna Temple Bangalore"],
    "bull-temple": ["Bull Temple", "Bull Temple Bangalore"],
    "ub-city": ["UB City", "UB City Bangalore", "Unity Building Mall"],
    "lalbagh": ["Lalbagh", "Lal Bagh Bangalore", "Lalbagh Botanical Garden"],
    "cubbon-park": ["Cubbon Park"],
    "attara-kacheri": ["Attara Kacheri", "Karnataka High Court"],
    "mayo-hall": ["Mayo Hall", "Mayo Hall Bangalore"],
    "ulsoor-lake": ["Ulsoor Lake", "Ulsoor Lake Bangalore"],
    "hebbal-lake": ["Hebbal Lake"],
    "sankey-tank": ["Sankey Tank"],
    "bangalore-fort": ["Bangalore Fort"],
    "chota-imambara": ["Chota Imambara", "Chota Imambara Bangalore"],
    "ganjam": ["Ganjam Bangalore", "Ganjam, Bangalore"],
    "hombegowda-temple": ["Hombegowda Temple", "Nageshvara Temple Bangalore", "Hombegowda temple"],
    "dodda-basavana-gudi": ["Dodda Basappa Temple", "Doddab Basappa Temple", "Dodda Basavana Gudi"],
    "gavi-gangadhareshwara-temple": ["Gavi Gangadhareshwara Temple", "Gavimath Temple", "Gavi Gangadhareshwara Temple Bangalore"],
    "st-marys-basilica": ["St. Mary's Basilica Bangalore", "St Mary's Basilica Bangalore", "St. Mary's Basilica"],
    "kr-market": ["KR Market", "K. R. Market", "KR Market Bangalore"],
    "russell-market": ["Russell Market", "Russell Market Bangalore"],
    "chickpet": ["Chickpet", "Chickpet Bangalore"],
    "gandhinagar": ["Gandhinagar Bangalore", "Gandhinagar, Bangalore"],
    "whitefield": ["Whitefield Bangalore", "Whitefield, Bangalore"],
    "jayanagar": ["Jayanagar Bangalore", "Jayanagar, Bangalore"],
    "basavanagudi": ["Basavanagudi", "Basavanagudi, Bangalore"],
    "malleswaram": ["Malleswaram", "Malleshwaram"],
    "koramangala": ["Koramangala", "Koramangala Bangalore"],
    "indiranagar": ["Indiranagar Bangalore", "Indiranagar, Bangalore"],
    "richmond-town": ["Richmond Town Bangalore", "Richmond Town, Bangalore"],
    "majestic": ["Majestic Bangalore", "Kempegowda Bus Station", "Majestic, Bangalore"],
    "bangalore-market": ["Bangalore Market", "Bangalore City Market", "City Market Bangalore"],
    "chitrakala-parishat": ["Karnataka Chitrakala Parishat", "Chitrakala Parishath"],
    "government-museum": ["Government Museum Bangalore", "Government Museum and Art Gallery Bangalore"],
    "kanteerava-stadium": ["Sree Kanteerava Stadium", "Kanteerava Stadium"],
    "manyata-tech-park": ["Manyata Tech Park"],
    "electronic-city": ["Electronic City Bangalore", "Electronic City, Bangalore"],
    "bangalore-university": ["Bangalore University", "Bengaluru City University", "Central College Bangalore"],
    "world-trade-center": ["World Trade Center Bangalore", "World Trade Centre Bangalore"],
    "iim-bangalore": ["Indian Institute of Management Bangalore", "IIM Bangalore"],
    "airport": ["Kempegowda International Airport", "Bangalore International Airport", "Bengaluru International Airport"],
    "mg-road": ["MG Road Bangalore", "Mahatma Gandhi Road Bangalore"],
    "brigade-road": ["Brigade Road", "Brigade Road Bangalore"],
    "church-street": ["Church Street Bangalore", "Church Street, Bangalore"],
    "commercial-street": ["Commercial Street Bangalore", "Commercial Street, Bangalore"],
    "palace-road": ["Bangalore Palace Road", "Palace Road, Bangalore"],
}

if __name__ == "__main__":
    out = {}
    for slug, cats in LANDMARKS.items():
        found_cats = []
        for c in cats:
            members = cat_members("Category:" + c)
            if members:
                found_cats.append(("Category:" + c, len(members)))
        subs = []
        for c in cats:
            for s in subcats("Category:" + c):
                subs.append(s)
        # search for categories too
        extra = search_categories(cats[0].split()[0])
        print(f"{slug}: cats={found_cats} subs={subs[:6]} searchcats={[e for e in extra if 'Bangal' in e or 'Bang' in e or slug.split('-')[0].title() in e][:6]}")
        out[slug] = {"cats": found_cats, "subs": subs}
    with open("scripts/_discovery.json", "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
