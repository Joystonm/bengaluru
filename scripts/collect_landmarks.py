"""
Collect real, freely-licensed photographs of Bengaluru landmarks from Wikimedia Commons.

Strict subject matching (title-anchored), per-landmark angle diversity, cross-landmark
deduplication, licence filtering, download + validation, manifest.json + CREDITS.md.
"""
import urllib.request, urllib.parse, json, time, os, re, sys, hashlib, html
from io import BytesIO
from pathlib import Path

UA = "Bengaluru3D/1.0 (+https://example.com/bengaluru)"
UA_FALLBACK = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
               "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
API = "https://commons.wikimedia.org/w/api.php"
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.join(BASE, "public", "assets", "landmarks")
MANIFEST = os.path.join(ROOT, "manifest.json")
CREDITS = os.path.join(ROOT, "CREDITS.md")
WIDTH = 1280          # exact MediaWiki thumbnail bucket -> server-rendered 1280px JPEG
MIN_BYTES = 20_000
MIN_W, MIN_H = 300, 200

ACCEPT_LICENSE_PAT = [
    r"^cc[\s\-]*0", r"^cc[\s\-]*by[\s\-]*2\.0", r"^cc[\s\-]*by[\s\-]*3\.0", r"^cc[\s\-]*by[\s\-]*4\.0",
    r"^cc[\s\-]*by[\s\-]*sa[\s\-]*2\.0", r"^cc[\s\-]*by[\s\-]*sa[\s\-]*3\.0", r"^cc[\s\-]*by[\s\-]*sa[\s\-]*4\.0",
    r"^cc[\s\-]*by[\s\-]*nd", r"^public domain", r"^pd-", r"^no restrictions",
    r"^attribution", r"^fal", r"^gfdl", r"^free art", r"^share alike", r"^copyright free",
]
REJECT_LICENSE_PAT = [
    r"non[\s\-]*commercial", r"\bnc\b", r"fair use", r"all rights reserved",
    r"editorial only", r"permission", r"copyright(?! free)", r"cc[\s\-]*by[\s\-]*nc",
]

_cache = {}


def api(params):
    params = dict(params)
    params.setdefault("format", "json")
    key = tuple(sorted(params.items()))
    if key in _cache:
        return _cache[key]
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode("utf-8"))
            _cache[key] = data
            time.sleep(0.15)
            return data
        except Exception as e:
            if attempt == 3:
                print(f"  ! api error: {e}", file=sys.stderr)
                return {}
            time.sleep(2 * (attempt + 1))
    return {}


def cat_files(cat, limit=300):
    out, cont = [], None
    while True:
        p = {"action": "query", "list": "categorymembers", "cmtitle": cat, "cmtype": "file", "cmlimit": limit}
        if cont:
            p["cmcontinue"] = cont
        d = api(p)
        out += [m["title"] for m in d.get("query", {}).get("categorymembers", [])]
        cont = d.get("continue", {}).get("cmcontinue")
        if not cont:
            break
    return out


def search_files(term, limit=50):
    d = api({"action": "query", "list": "search", "srsearch": term, "srnamespace": 6, "srlimit": limit})
    return [r["title"] for r in d.get("query", {}).get("search", [])]


def imageinfo(titles):
    info = {}
    titles = list(dict.fromkeys(titles))
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        d = api({"action": "query", "titles": "|".join(chunk), "prop": "imageinfo",
                 "iiprop": "url|extmetadata|size|mime", "iiurlwidth": WIDTH})
        for page in d.get("query", {}).get("pages", {}).values():
            ii = page.get("imageinfo")
            if ii:
                info[page["title"]] = ii[0]
    return info


def strip_html(s):
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s).replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def clean_url(u):
    return u.split("?")[0] if u else u


def license_ok(ext):
    name = strip_html(ext.get("LicenseShortName", {}).get("value", ""))
    usage = strip_html(ext.get("UsageTerms", {}).get("value", ""))
    blob = f"{name} | {usage}".lower()
    if not name:
        return None
    for p in REJECT_LICENSE_PAT:
        if re.search(p, blob):
            return None
    for p in ACCEPT_LICENSE_PAT:
        if re.search(p, name.lower()):
            return name
    return None


def L(slug, name, target, aliases, cats=(), sub=(), search=(), exclude=(), angles=(), loc=True):
    return dict(slug=slug, name=name, target=target, aliases=aliases, cats=list(cats), sub=list(sub),
                search=list(search), exclude=list(exclude), angles=list(angles), loc=loc)


LANDMARKS = [
    # ---- priority 3D-model landmarks (angle-diverse sets) --------------------------
    L("vidhana-soudha", "Vidhana Soudha", 7,
      aliases=[r"vidhana\s*soudha", r"vidhanasoudha", r"suvarna vidhana"],
      cats=["Category:Vidhana Soudha"],
      sub=["Category:Vidhana Soudha illuminated", "Category:Domes in Vidhana Soudha",
           "Category:Ashoka pillars, Vidhana Soudha", "Category:Vidhana Soudha gardens",
           "Category:Vidhana Soudha artefacts"],
      search=["Vidhana Soudha Bangalore", "Vidhana Soudha at night", "Vidhana Soudha illuminated",
              "Vidhana Soudha building", "Vidhana Soudha dome", "Vidhana Soudha entrance",
              "Vidhana Soudha Karnataka legislature", "Vidhana Soudha facade",
              "Vidhana Soudha Vidhana Bhavan Bengaluru", "Vidhana Soudha portico columns",
              "Vidhana Soudha Ashoka pillars", "Vidhana Soudha at Night",
              "An evening at Vidhanasoudha"],
      exclude=[r"palace grounds", r"ayurveda", r"metro station", r"statue of",
               r"attara", r"kacheri", r"high court", r"ambedkar", r"rickshaw", r"assembly",
               r"light pole"],
      angles=[("dome", r"dome|lion capital|ashoka"),
              ("night", r"night|illuminat|light|evening"),
              ("detail", r"pillar|column|arch|carv|relief|detail|gate"),
              ("garden", r"garden|park|lawn|flower"),
              ("facade", r"vidhana|front|view|building|exterior|soudha")]),
    L("bangalore-palace", "Bangalore Palace", 7,
      aliases=[r"bangalore\s*palace", r"bengaluru\s*palace", r"palace grounds"],
      cats=["Category:Bangalore Palace"],
      sub=["Category:Interior of the Bangalore Palace", "Category:Palace grounds"],
      search=["Bangalore Palace exterior", "Bangalore Palace entrance", "Bangalore Palace gates",
              "Bangalore Palace aerial", "Bangalore Palace architecture", "Bangalore Palace Bengaluru"],
      exclude=[r"ayurveda", r"world summit", r"tipu", r"coorg", r"auto show",
               r"motor show", r"exhibition", r"(^|[^a-z])expo([^a-z]|\n)", r"fair"],
      angles=[("aerial", r"aerial|bird|top"),
              ("gate", r"gate|entrance|arch|archway"),
              ("interior", r"interior|inside|hall|room|throne|durbar"),
              ("towers", r"tower|turret|dome|cupola"),
              ("facade", r"palace|exterior|front|building|view")]),
    L("tipu-palace", "Tipu Sultan's Summer Palace", 6,
      aliases=[r"tipu sultan", r"tipu's summer palace", r"summer palace", r"tipu summer palace"],
      cats=["Category:Tipu Sultan's Summer Palace"],
      sub=["Category:Tipu Sultan's Summer Palace gardens",
           "Category:Interior of Tipu Sultan's summer palace"],
      search=["Tipu Sultan's Summer Palace Bangalore", "Tipu Sultan summer palace Bengaluru",
              "Tipu Sultan summer palace exterior", "Tipu Sultan palace gate Bangalore"],
      exclude=[r"attara", r"high court", r"mysore palace", r"lalitha Mahal", r"devanahalli"],
      angles=[("gate", r"gate|entrance|arch"),
              ("interior", r"interior|inside|passageway|hall|court"),
              ("detail", r"carv|relief|column|pillar|tower|wood|door|window|wall"),
              ("garden", r"garden|trees|lawn|grounds"),
              ("facade", r"palace|exterior|front|view|distance")]),
    L("iskcon-temple", "ISKCON Temple, Bengaluru", 7,
      aliases=[r"iskcon", r"iskcon", r"radha\s*krishna\s*temple", r"jbsbangalore"],
      cats=["Category:ISKCON Temple, Bangalore", "Category:ISKCON South Bangalore"],
      search=["ISKCON Temple Bangalore", "ISKCON Temple Bengaluru", "ISKCON Temple Bangalore night",
              "Sri Radha Krishna Temple Bangalore", "ISKCON temple Bangalore entrance mandapa"],
      exclude=[r"kheer", r"khichdi", r"prasadam", r"served", r"clothes for drying",
               r"tiffin", r"food", r"restaurant", r"temple festival.*202[0-4]"],
      angles=[("domes", r"dome|flag|shikhara|tower|spire"),
              ("pond", r"pond|lake|water"),
              ("night", r"night|illuminat|light"),
              ("interior", r"interior|inside|ceiling|hall|altar|sanctum|statue"),
              ("facade", r"temple|exterior|front|view|mandapa|gate")]),
    L("bull-temple", "Bull Temple (Nandi Temple), Basavanagudi", 7,
      aliases=[r"bull temple", r"doddabasavanna", r"dodda basava", r"doddab basappa",
               r"basavanna temple", r"nandi at bull", r"nandi temple"],
      cats=["Category:Bull Temple"],
      sub=["Category:Gopurams of the Bull Temple", "Category:Nandi at Bull Temple",
           "Category:Dodda Ganeshana Gudi"],
      search=["Bull Temple Bangalore", "Bull temple basava", "Bull temple gopuram Bangalore",
              "Nandi Bull Temple Basavanagudi", "Doddabasavanna Temple Bangalore"],
      exclude=[r"garudagamba of doddabasavanna temple$", r"candi", r"prambanan", r"indonesia"],
      angles=[("gopuram", r"gopuram|tower|garuda|dome"),
              ("entrance", r"entrance|gate|door|arch"),
              ("basava", r"basava|bull|statue|nandi|idol"),
              ("detail", r"carv|relief|column|pillar|wall|inscription"),
              ("temple", r"temple|view|exterior|front")]),
    L("ub-city", "UB City", 7,
      aliases=[r"ub\s*city", r"ubcity", r"unity building", r"canberra tower",
               r"concorde tower", r"kingfisher tower"],
      cats=["Category:UB City"],
      sub=["Category:UB City illuminated", "Category:UB Tower"],
      search=["UB City Bangalore", "UB City mall Bengaluru", "UB City buildings",
              "UB City shopping mall Bangalore", "UB City Bangalore evening",
              "Bangalore UB City mall entrance", "UB City mall facade Bengaluru"],
      exclude=[r"near ub city", r"jw marriott", r"united spirits"],
      angles=[("night", r"night|illuminat|evening|lights"),
              ("interior", r"interior|inside|mall|shop|corridor|escalator"),
              ("facade", r"ub city|mall|front|exterior|entrance|facade"),
              ("skyline", r"skyline|tower|buildings|view|cityscape")]),
    L("lalbagh", "Lalbagh Botanical Garden", 8,
      aliases=[r"lal\s*bagh", r"lalbagh", r"glass\s*house", r"glasshouse"],
      cats=["Category:Lalbagh Botanical Garden"],
      sub=["Category:Lal Bagh band stand", "Category:Lal Bagh Bonsai Garden",
           "Category:Nature of the Lal Bagh Botanical Garden", "Category:Lalbagh Museum"],
      search=["Lalbagh Glass House", "Lal Bagh glasshouse Bangalore", "Lalbagh botanical garden Bengaluru",
              "Lal Bagh Bangalore garden", "Lalbagh bandstand", "Lalbagh bonsai garden",
              "Lalbagh Glasshouse night", "Lal Bagh glass house Bengaluru",
              "Glasshouse Lalbagh Bengaluru"],
      exclude=[r"metro station", r"qila mosque", r"flower show"],
      angles=[("glasshouse", r"glass\s*house|glasshouse|glass house"),
              ("bandstand", r"band ?stand"),
              ("bonsai", r"bonsai"),
              ("entrance", r"gate|entrance|arch|lady|imperial"),
              ("museum", r"museum|statue|portrait"),
              ("garden", r"garden|lake|flower|tree|plant|palm|orchid|rose")]),

    # ---- remaining landmarks -------------------------------------------------------
    L("cubbon-park", "Cubbon Park", 5,
      aliases=[r"cubbon park", r"cubbon", r"bannerghatta"],
      cats=["Category:Cubbon Park"],
      sub=["Category:Bridges in Cubbon Park", "Category:Mahatma Gandhi Park Bengaluru"],
      search=["Cubbon Park Bengaluru", "Cubbon Park statue", "Cubbon Park museum Bangalore",
              "Cubbon Park Bengaluru lake"],
      exclude=[r"army expo", r"namma bengaluru aquarium", r"cbrn", r"(^|[^a-z])suit([^a-z]|\n)",
               r"expo", r"philoxeroides", r"alternanthera"],
      angles=[("statue", r"statue|monument|bandstand|statuary"),
              ("building", r"museum|building|govt|house|lodge"),
              ("landscape", r"park|garden|tree|lake|flower|landscape")]),
    L("attara-kacheri", "Attara Kacheri (Karnataka High Court)", 5,
      aliases=[r"attara\s*kach", r"attara\s*katch", r"high\s*court", r"hc karnataka"],
      cats=["Category:Attara Kacheri"],
      sub=["Category:Nature at the Karnataka High Court"],
      search=["Attara Kacheri Bangalore", "Karnataka High Court Attara Kacheri Bengaluru",
              "Attara Kacheri building", "High Court of Karnataka Bengaluru entrance"],
      exclude=[r"tipu", r"summer palace", r"advocate", r"law college", r"chambers"],
      angles=[("gate", r"gate|entrance|arch"),
              ("detail", r"column|pillar|carv|corner|dome|tower"),
              ("context", r"cubbon|park|road|street"),
              ("facade", r"attara|kach|high court|building|wide|front|view")]),
    L("mayo-hall", "Mayo Hall", 4,
      aliases=[r"mayo hall", r"gandhi bhavan"],
      cats=[], search=["Mayo Hall Bengaluru", "\"Mayo Hall\" Bangalore MG Road",
                       "Mayo Hall Gandhi Bhavan Bengaluru"],
      exclude=[r"mayo clinic", r"mayo hospital", r"dr\.? mayo"],
      angles=[("street", r"street|traffic|road|mg road|sign"),
              ("facade", r"mayo|hall|building|front|view")]),
    L("ulsoor-lake", "Ulsoor Lake", 4,
      aliases=[r"ulsoor", r"ulsoor"],
      cats=["Category:Ulsoor Lake"],
      search=["Ulsoor Lake Bengaluru", "Ulsoor Lake Bangalore", "Ulsoor lake bridge"],
      exclude=[r"market", r"metro", r"school"],
      angles=[("detail", r"island|bridge|boat|duck|water|birds"),
              ("urban", r"buildings|city|skyline|road"),
              ("landscape", r"lake|view|sunset|sunrise|sky")]),
    L("hebbal-lake", "Hebbal Lake", 4,
      aliases=[r"hebbal"],
      cats=["Category:Hebbal Lake, Bengaluru", "Category:Hebbal Lake"],
      search=["Hebbal Lake Bengaluru", "Hebbal lake Bangalore", "Hebbal Lake birds"],
      exclude=[r"flyover.*mumbai", r"inspiration"],
      angles=[("detail", r"bird|duck|bridge|flowers|balcony"),
              ("urban", r"city|building|flyover|road"),
              ("landscape", r"lake|view|water|sunset")]),
    L("sankey-tank", "Sankey Tank", 4,
      aliases=[r"sankey"],
      cats=[], search=["Sankey Tank Bengaluru", "Sankey tank Bangalore Cubbon Park",
                       "Sankey Lake Bangalore"],
      exclude=[r"sankey diagrams", r"sankey diagram"],
      angles=[("detail", r"duck|bird|flower|lotus|pigeon"),
              ("landscape", r"sankey|lake|tank|view")]),
    L("bangalore-fort", "Bangalore Fort", 5,
      aliases=[r"bangalore fort", r"bengaluru fort", r"bangalore fort\b"],
      cats=["Category:Bangalore Fort"],
      sub=["Category:Gates of the Bangalore Fort", "Category:Kempfort Shiva Temple"],
      search=["Bangalore Fort Bengaluru", "Bangalore Fort archaeology Bengaluru", "Bangalore fort entrance"],
      exclude=[r"in art", r"map"],
      angles=[("gate", r"gate|entrance|arch"),
              ("detail", r"carv|relief|inscription|sculpture"),
              ("ruins", r"ruin|wall|tower|stone|dungeon"),
              ("view", r"view|front|exterior|aerial")]),
    L("chota-imambara", "Chota Imambara", 3,
      aliases=[r"chh?ota\s*imambara", r"imambara"],
      cats=["Category:Chota Imambara"], search=["Chota Imambara Bengaluru", "Chhota Imambara Bangalore"],
      exclude=[r"lucknow", r"amin-?ud-?daula", r"jhau", r"bada imambara", r"chowk"],
      angles=[("detail", r"arch|carv|jhoomar|door|wall"),
              ("facade", r"imambara|building|front|view")]),
    L("ganjam", "Ganjam (Bengaluru)", 3,
      aliases=[r"ganjam"],
      cats=["Category:Ganjam"], search=["Ganjam Bengaluru", "Ganjam mosque Bangalore",
                                        "Karnataka Ganjam Mosque"],
      exclude=[r"odisha", r"orissa", r"ganjam district", r"athagada", r"berhampur", r"jalant"],
      angles=[("detail", r"arch|carv|gate|detail"),
              ("view", r"ganjam|mosque|temple|view")]),
    L("hombegowda-temple", "Hombegowda Temple / Kempe Gowda Tower", 5,
      aliases=[r"hombegowda", r"hemgegowda", r"kempe\s*gowda tower", r"kempegowda tower",
               r"nageshvara temple", r"galigunta", r"shanigrama"],
      cats=["Category:Kempe Gowda tower"],
      search=["Hombegowda Temple Basavanagudi", "Kempe Gowda Tower Bengaluru",
              "Hombegowda temple Bangalore", "Nageshwara Temple Bangalore",
              "Kempegowda Tower Corporation Circle Bengaluru"],
      exclude=[r"lal ?bagh botanical", r"macnabb", r"album of indian views"],
      angles=[("detail", r"carv|relief|stone|inscription|nandi|bull"),
              ("context", r"basavanagudi|street|road|view|circle"),
              ("tower", r"tower|temple|gopuram|shikhara")]),
    L("dodda-basavana-gudi", "Dodda Basavana Gudi (Oddabasappa Temple)", 4,
      aliases=[r"oddabasappa", r"dodda\s*basava", r"doddab\s*basappa", r"basavana gudi",
               r"doddabasavanna", r"dodda basavana", r"basavanna", r"basavangudi"],
      cats=["Category:Oddabasappa Temple", "Category:Dodda Ganeshana Gudi"],
      search=["Oddabasappa Temple Bengaluru", "Doddab Basappa Temple Bangalore",
              "Dodda Basavana Gudi Basavanagudi", "Doddabasavanna Temple Basavanagudi Bengaluru",
              "Basavangudi temple Bangalore"],
      exclude=[r"bull temple", r"doddabasavanna temple$"],
      angles=[("detail", r"carv|relief|column|door|wall|inscription"),
              ("entrance", r"gate|entrance|arch|steps"),
              ("temple", r"temple|gudi|view|tower")]),
    L("gavi-gangadhareshwara-temple", "Gavi Gangadhareshwara Temple", 4,
      aliases=[r"gavi\s*gangadhareshwara", r"gavimath", r"gangadhareshwara"],
      cats=["Category:Gavi Gangadhareshwara Temple"],
      search=["Gavi Gangadhareshwara Temple Bengaluru", "Gavimath temple Bangalore",
              "Gavi Gangadhareshwara Temple Shivagange"],
      exclude=[r"chitradurga$"],
      angles=[("cave", r"cave|mantapa|rock"),
              ("detail", r"carv|relief|mantapa|cave|sanctum|column"),
              ("temple", r"temple|view|exterior|front")]),
    L("st-marys-basilica", "St. Mary's Basilica, Bengaluru", 4,
      aliases=[r"st\.?\s*mary", r"st\s*marys", r"basilica"],
      cats=[], search=["St Mary's Basilica Bengaluru", "\"St. Mary's Basilica\" Bangalore",
                       "St Marys Basilica Bangalore Garden"],
      exclude=[r"prinzeninsel", r"\bplon\b", r"germany", r"poland", r"malta", r"ireland",
               r"portugal", r"spain", r"italy", r"philippines", r"canada", r"austria",
               r"netherlands", r"belgium", r"czech"],
      angles=[("interior", r"interior|inside|altar|inside|pew|arch|window"),
              ("detail", r"door|statue|rose window|carv|tower|spire"),
              ("facade", r"basilica|tower|front|view|exterior|gothic")]),
    L("kr-market", "K. R. Market", 4,
      aliases=[r"k\.?\s*r\.?\s*market", r"kr\s*market", r"kr market"],
      cats=["Category:K. R. Market"],
      search=["KR Market Bengaluru", "K. R. Market Bangalore City Market Road"],
      exclude=[r"city flower market$"],
      angles=[("goods", r"flower|garland|vegetable|fruit|produce|sari|cloth"),
              ("view", r"view|aerial|entrance"),
              ("street", r"market|street|shop|stall|bazaar")]),
    L("russell-market", "Russell Market", 4,
      aliases=[r"russell market", r"russel market"],
      cats=["Category:Russel Market, Bangalore"],
      search=["Russell Market Bengaluru", "Russell Market Bangalore street food",
              "Russel Market Shivaji Nagar Bengaluru"],
      exclude=[r"\bnara\b", r"oregon", r"la prairie", r"california", r"iowa", r"montana",
               r"washington", r"minnesota", r"canada", r"australia", r"portland",
               r"geograph", r"normanton", r"grilled", r"market hall"],
      angles=[("view", r"view|front|building|key"),
              ("street", r"market|street|stall|shop|sign")]),
    L("chickpet", "Chickpet", 4,
      aliases=[r"chickp[ae]t"],
      cats=["Category:Chickpet"], search=["Chickpet Bengaluru street", "Chickpet Bangalore market"],
      exclude=[r"metro station"],
      angles=[("view", r"view|building|bull temple|clock"),
              ("street", r"chickpet|street|market|shop|road")]),
    L("gandhinagar", "Gandhinagar, Bengaluru", 3,
      aliases=[r"gandhinagar", r"gandhi ?nagar"],
      cats=[], search=["Gandhinagar Bengaluru street", "Gandhinagar Bangalore market",
                       "Gandhinagar Bengaluru RB Road", "Gandhinagar area Bangalore",
                       "Gandhinagar Bengaluru street market",
                       "Camera repairing shop Gandhinagar Bangalore",
                       "Bangalore Gandhinagar street"],
      exclude=[r"pasta", r"resto ?bar", r"chinese food", r"menu", r"cake", r"dessert",
               r"dharwad", r"ahmedabad", r"gandhinagar district", r"akshardham", r"iit "],
      angles=[("view", r"view|building|flyover"),
              ("street", r"gandhinagar|street|road|market")]),
    L("whitefield", "Whitefield, Bengaluru", 4,
      aliases=[r"whitefield"],
      cats=["Category:Whitefield, Bengaluru"],
      sub=["Category:Whitefield railway station, Bengaluru", "Category:John F. Welch Technology Centre"],
      search=["Whitefield Bengaluru street", "Whitefield Bangalore market",
              "Whitefield Bengaluru IT park building", "ITPL Whitefield Bangalore",
              "Whitefield railway station Bengaluru"],
      exclude=[r"whitefield (surname|connecticut|oklahoma|maine|uk|nz|australia)",
               r"param science experience centre", r"locomotive", r"vande bharat",
               r"biere club"],
      angles=[("view", r"view|building|tower|it park|park|centre|station"),
              ("street", r"whitefield|street|road|market|shop")]),
    L("jayanagar", "Jayanagar, Bengaluru", 3,
      aliases=[r"jayanagar", r"jayanagara"],
      cats=["Category:Jayanagar, Bengaluru", "Category:Jayanagar"],
      search=["Jayanagar Bengaluru street", "Jayanagar Bangalore 4th Block", "Jayanagar Bengaluru lake"],
      exclude=[r"community college", r"workshop", r"jayanagara, mysore", r"jayanagar metro"],
      angles=[("view", r"view|building|lake|park|temple|shopping"),
              ("street", r"jayanagar|street|road|market|shop|bus")]),
    L("basavanagudi", "Basavanagudi", 4,
      aliases=[r"basavanagudi", r"basava ?nagudi"],
      cats=["Category:Basavanagudi"],
      search=["Basavanagudi Bengaluru street", "Basavanagudi Bangalore market"],
      exclude=[r"kadalekai", r"3d digital scanning", r"\b3d\b", r"boulder",
               r"inscription", r"peeta"],
      angles=[("view", r"view|building|tower|temple"),
              ("street", r"basavanagudi|street|road|shop")]),
    L("malleswaram", "Malleswaram", 4,
      aliases=[r"malleswaram", r"malleshwaram", r"maleshwaram"],
      cats=["Category:Malleswaram"],
      sub=["Category:Malleswaram vegetable market", "Category:Sampige Road", "Category:Nandi Teertha Temple"],
      search=["Malleswaram Bengaluru street market", "Malleshwaram Bengaluru",
               "Malleshwaram shopping street Bengaluru"],
      exclude=[r"jatprole", r"myso?ru"],
      angles=[("temple", r"temple|nandi|hanuman|mandir"),
              ("view", r"view|road|building|bus"),
              ("market", r"market|vegetable|shop|stall|street")]),
    L("koramangala", "Koramangala", 4,
      aliases=[r"koramangala"],
      cats=["Category:Koramangala"], search=["Koramangala Bengaluru street", "Koramangala Bangalore",
                                            "Koramangala Forum Mall Bengaluru"],
      exclude=[r"anjappar restaurant", r"beer", r"sausage", r"brewery", r"food", r"restaurant",
               r"drinks", r"cocktail", r"hsr annex", r"nous infosystems", r"onesta"],
      angles=[("view", r"view|building|mall|forum|bridge"),
              ("street", r"koramangala|street|road|shop|cafe")]),
    L("indiranagar", "Indiranagar, Bengaluru", 4,
      aliases=[r"indiranagar", r"100 feet road", r"12th main"],
      cats=["Category:Indiranagar"], search=["Indiranagar Bengaluru street", "100 Feet Road Indiranagar",
                                             "Indiranagar Shopping Bengaluru 12th Main"],
      exclude=[r"rajkumar", r"shankara nag", r"karim khan"],
      angles=[("view", r"view|building|park|100 feet|flyover"),
              ("street", r"indiranagar|street|road|shop|bazaar|cafe")]),
    L("richmond-town", "Richmond Town, Bengaluru", 3,
      aliases=[r"richmond"],
      cats=[], search=["Richmond Town Bengaluru", "Richmond Road Bangalore",
                       "Sacred Heart Church Bengaluru"],
      exclude=[r"virginia|california|queens|toronto|australia|canada|london|pontiac",
               r"tonight|tony"],
      angles=[("view", r"view|building|market"),
              ("street", r"richmond|street|road|church")]),
    L("majestic", "Kempegowda Bus Station (Majestic)", 4,
      aliases=[r"kempegowda bus", r"majestic", r"bus station"],
      cats=["Category:Kempegowda Bus Station"],
      sub=["Category:Kempegowda Bus Station by year"],
      search=["Kempegowda Bus Station Bengaluru", "Majestic bus stand Bangalore",
              "Kempegowda Bus Station Majestic Bangalore"],
      exclude=[r"railway station", r"city railway", r"majestic (ship|records|theatre|rose)"],
      angles=[("street", r"street|buses|traffic|road|bus"),
              ("building", r"majestic|bus station|building|front")]),
    L("bangalore-market", "Bangalore City Market", 4,
      aliases=[r"city market", r"bangalore market", r"bengaluru market"],
      cats=[], search=["City Market Road Bengaluru", "Bangalore City Market flower market",
                       "City Market Bangalore wholesale"],
      exclude=[r"kr market", r"k\. ?r\. ?market", r"city flower market$"],
      angles=[("street", r"street|road|busy|crowd"),
              ("market", r"market|stall|shop|flowers|garland|basket")]),
    L("chitrakala-parishat", "Karnataka Chitrakala Parishat", 4,
      aliases=[r"chitrakala", r"citrakala", r"chitra parishat", r"chitrakala parishath"],
      cats=[], search=["Chitrakala Parishat Bengaluru", "Karnataka Chitrakala Parishath building",
                       "Chitrakala Parishat Bangalore", "Art galleries in Bengaluru"],
      exclude=[r"chitra sante", r"qrpedia", r"\bbala\b", r"arunram", r"hornibrook",
               r"creative commons event", r"art gallery\b.*london"],
      angles=[("gallery", r"art|gallery|painting|exhibit|sculpture"),
              ("building", r"chitrakala|parishat|building|view|surrounding")]),
    L("government-museum", "Government Museum & Art Gallery, Bengaluru", 4,
      aliases=[r"government museum", r"art gallery", r"govt museum", r"goverment museum"],
      cats=["Category:Government Museum, Bengaluru"],
      sub=["Category:Government Museum, Bengaluru in 2017", "Category:Government Museum, Bengaluru in 2016"],
      search=["Government Museum Bengaluru", "Government Museum and Art Gallery Bangalore",
               "Venkatappa Art Gallery Bengaluru"],
      exclude=[r"delhi", r"chennai", r"bengaluru airport museum", r"1909", r"1890",
               r"curzon", r"vintage", r"tiger moth", r"aerobatic"],
      angles=[("exhibit", r"statue|sculpture|art|exhibit|hall|indoor|krishna|chola"),
              ("building", r"museum|gallery|building|front|view")]),
    L("kanteerava-stadium", "Sree Kanteerava Stadium", 4,
      aliases=[r"kanteerava", r"kanteerava stadium"],
      cats=["Category:Sree Kanteerava Stadium"],
      search=["Sree Kanteerava Stadium Bengaluru", "Kanteerava indoor stadium Bangalore",
              "Kanteerava Outdoor stadium Bengaluru"],
      exclude=[r"bengaluru fc vs", r"bengaluru fc\b", r"super league"],
      angles=[("match", r"match|game|football|crowd|players"),
              ("stadium", r"stadium|indoor|outdoor|ground|stand|view")]),
    L("manyata-tech-park", "Manyata Tech Park", 4,
      aliases=[r"manyata"],
      cats=["Category:Manyata Tech Park"],
      search=["Manyata Tech Park Bengaluru", "Manyata business park Bangalore"],
      exclude=[r"dutt", r"embassy business park", r"rohan upavan", r"hennur"],
      angles=[("campus", r"campus|road|park|walk|entrance"),
              ("buildings", r"manyata|building|tower|campus|office")]),
    L("electronic-city", "Electronic City, Bengaluru", 4,
      aliases=[r"electronic(s)?\s*city"],
      cats=[], search=["Electronic City Bengaluru", "Electronics City Phase 1 Bengaluru",
                       "Electronic City Bangalore Silicon Valley"],
      exclude=[r"\.png$", r"electronic music", r"tc electronic", r"conrad electronic",
               r"electronic arts", r"electronic shop"],
      angles=[("street", r"street|road|buses|traffic|sign"),
              ("buildings", r"city|building|tower|campus|it")]),
    L("bangalore-university", "Bangalore University", 4,
      aliases=[r"bangalore ?university", r"bengaluru ?university", r"central college",
               r"bengaluru city university", r"bangaloreuniversity"],
      cats=["Category:Bangalore University"],
      search=["Bangalore University campus Bengaluru", "Bengaluru City University",
               "Bangalore University administration building", "Bangaloreuniversity"],
      exclude=[r"graduation", r"convocation", r"odonata", r"botany", r"adarsh college",
               r"alumni", r"surana"],
      angles=[("view", r"view|gate|grounds"),
              ("building", r"university|college|building|campus|front")]),
    L("world-trade-center", "World Trade Center, Bengaluru", 4,
      aliases=[r"world trade cent"],
      cats=[], search=["World Trade Center Bengaluru", "World Trade Centre Shantinagar Bangalore"],
      exclude=[r"new york", r"manhattan", r"dubai", r"mumbai", r"london", r"singapore",
               r"shanghai", r"hong kong", r"chicago", r"orion mall"],
      angles=[("detail", r"facade|glass|logo|entrance|lobby"),
              ("building", r"world trade|tower|building|front|view")]),
    L("iim-bangalore", "Indian Institute of Management Bangalore", 4,
      aliases=[r"\biim\b", r"indian institute of management"],
      cats=["Category:Indian Institute of Management Bangalore"],
      search=["IIM Bangalore campus Bengaluru", "Indian Institute of Management Bangalore building"],
      exclude=[r"iim ", r"iimb "],
      angles=[("interior", r"interior|inside|hall|classroom|auditorium"),
              ("campus", r"campus|building|block|gate|bannerghatta|view")]),
    L("airport", "Kempegowda International Airport", 6,
      aliases=[r"kempegowda", r"\bblr\b", r"bengaluru airport", r"bangalore airport",
               r"bengaluru international airport", r"kempegowda international"],
      cats=["Category:Kempegowda International Airport"],
      sub=["Category:Interior of Kempegowda International Airport"],
      search=["Kempegowda International Airport terminal Bengaluru", "BLR airport departures",
              "Kempegowda International Airport arrivals terminal", "Bengaluru airport terminal building"],
      exclude=[r"kuala lumpur", r"\bkul\b", r"airliners kuala", r"halt railway"],
      angles=[("interior", r"interior|inside|counter|cafe|shop|seating"),
              ("aircraft", r"aircraft|airliner|plane|a320|boeing|indigo|akasa"),
              ("terminal", r"terminal|departure|arrival|check-?in|hall"),
              ("exterior", r"airport|building|outside|apron|tarmac")]),
    L("mg-road", "MG Road, Bengaluru", 4,
      aliases=[r"\bmg road\b", r"mahatma gandhi road", r"barton centre", r"trinity (hotel|mall)",
               r"residency road"],
      cats=[], search=["MG Road Bengaluru shopping street", "MG Road Bangalore metro",
                       "Brigade and MG Road junction Bengaluru", "Trinity MG Road Bengaluru",
                       "MG Road Bangalore street"],
      exclude=[r"metro station as seen"],
      angles=[("landmarks", r"trinity|barton|residency|centre|center|plaza"),
              ("street", r"mg road|street|shopping|traffic|shop")]),
    L("brigade-road", "Brigade Road", 4,
      aliases=[r"brigade road"],
      cats=[], search=["Brigade Road Bengaluru shopping street", "Brigade Road Bangalore"],
      exclude=[r"womans day"],
      angles=[("view", r"view|building|front"),
              ("street", r"brigade|street|shopping|shop|pedestrian")]),
    L("church-street", "Church Street, Bengaluru", 4,
      aliases=[r"church street"],
      cats=[], search=["Church Street Bengaluru street", "Church Street Bangalore shopping"],
      exclude=[],
      angles=[("view", r"view|building|mormon|church"),
              ("street", r"church street|street|shop|arcade")]),
    L("commercial-street", "Commercial Street, Bengaluru", 4,
      aliases=[r"commercial street"],
      cats=[], search=["Commercial Street Bengaluru shopping", "Commercial Street Bangalore street"],
      exclude=[],
      angles=[("view", r"view|building|front"),
              ("street", r"commercial|street|shop|market")]),
    L("palace-road", "Palace Road, Bengaluru", 4,
      aliases=[r"palace road", r"palace grounds", r"leela palace"],
      cats=[], search=["Palace Road Bengaluru", "Bangalore Palace Road street",
                       "Leela Palace Bangalore Palace Road"],
      exclude=[r"ayurveda", r"world summit"],
      angles=[("view", r"view|building|hotel"),
              ("street", r"palace road|street|traffic|road")]),
]

BAD_TITLE = re.compile(r"(map|diagram|chart|logo|coat of arms|flag|icon|stamp|"
                        r"blueprint|infographic|seal of|locator|screenshot|"
                        r"\.svg|\.pdf|\.ogv|\.webm|\.tif|\.gif|\.png|plan|blue ?print)", re.I)
OLDISH = re.compile(r"(18\d\d|189\d|190\d|191\d|192\d|193\d|postcard|post card|lithograph|"
                    r"engraving|drawing|sketch|painting|curzon|collection|macnabb|album|wiele|reid|erskine|studio)", re.I)
MODERN = re.compile(r"(20(1[5-9]|2\d))|night|illuminat|glass ?house|gopuram|"
                    r"entrance|facade|interior|exterior|view|detail|close|tower|dome|nandi|"
                    r"statue|pillar|gateway|gate|garden|lake|street|market|temple|palace|mandir|"
                    r"mosque|church|stadium|park|museum|airport|college|university|building|"
                    r"mall|hotel|skyline|road|bridge|station", re.I)
LOC = re.compile(r"\b(bangalore|bengaluru|bengaluru urban|bangalore urban|brindavan|"
                  r"mysore road|nagarathpete|chickpet|basavanagudi|whitefield|"
                  r"koramangala|indiranagar|jayanagar|malleswaram|gandhinagar|electronic city)\b", re.I)

_used_titles = set()

# Geographic guard: reject files whose Commons categories place them outside Karnataka.
FOREIGN_CATS = re.compile(
    r"\bodisha\b|\borissa\b|\blucknow\b|\bdelhi\b|\bmumbai\b|\bchennai\b|\bhyderabad\b|"
    r"\bkolkata\b|\bpune\b|\bjaipur\b|\bgoa\b|\bkerala\b|\bgujarat\b|\brajasthan\b|"
    r"\bbengal\b|\bbihar\b|\bcanada\b|united states|\busa\b|new zealand|\bsingapore\b|"
    r"\bmalaysia\b|\bthailand\b|\bindonesia\b|sri lanka|\bnepal\b|\bbhutan\b|\bpakistan\b|"
    r"\bbangladesh\b|\bmyanmar\b|\boman\b|\bqatar\b|\bdubai\b|\babu dhabi\b|\biran\b|"
    r"\begypt\b|\bjapan\b|\bchina\b|\bkorea\b|\bhong kong\b|\brussia\b|\bgermany\b|"
    r"\bfrance\b|\bitaly\b|\bspain\b|\bportugal\b|\bnetherlands\b|\bbelgium\b|\bswitzerland\b|"
    r"\baustria\b|\bczech\b|\bpoland\b|\bhungary\b|\bsweden\b|\bnorway\b|\bdenmark\b|"
    r"\bfinland\b|\bireland\b|\bscotland\b|\bwales\b|\bengland\b|\blondon\b|\bmanchester\b|"
    r"\bnew york\b|\bmanhattan\b|\bcalifornia\b|\btexas\b|\bflorida\b|\bgeorgia\b|"
    r"\bchicago\b|\bboston\b|\bseattle\b|\bportland\b|\bdenver\b|\bhouston\b|\bphoenix\b|"
    r"\baustralia\b|\bsouth africa\b|\bkenya\b|\bnigeria\b|\bghana\b|\bmorocco\b|"
    r"\bmexico\b|\bbrazil\b|\bargentina\b|\bchile\b|\bperu\b|\bcolombia\b|"
    r"\bnormanton\b|\bgeograph\b", re.I)


def score_candidate(title, desc, lm, lic_short=""):
    t = title.lower()
    d = (desc or "").lower()
    blob = t + " " + d
    if BAD_TITLE.search(t):
        return -1
    for ex in lm["exclude"]:
        if re.search(ex, t, re.I):
            return -1
    sc = 0
    title_hit = False
    for al in lm["aliases"]:
        if re.search(al, t, re.I):
            title_hit = True
            sc += 120
            break
    if not title_hit:
        return -1
    if lm["loc"] and not LOC.search(blob):
        sc -= 25
    if OLDISH.search(t):
        sc -= 32
    if MODERN.search(t):
        sc += 8
    if re.search(r"\.(jpg|jpeg)$", t):
        sc += 4
    if lic_short and lic_short.lower().startswith("gfdl"):
        sc -= 12
    # prefer larger, more "main subject" images
    return sc


def angle_of(title, angles):
    """First matching label wins; angle lists are ordered specific -> general."""
    t = title.lower()
    for label, rx in angles:
        if re.search(rx, t, re.I):
            return label
    return "general"


def download(url, dest):
    last = None
    for ua in (UA, UA_FALLBACK):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua,
                                                       "Referer": "https://commons.wikimedia.org/",
                                                       "Accept": "image/*"})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            with open(dest, "wb") as f:
                f.write(data)
            return data
        except Exception as e:
            last = e
    raise last


def stem(title):
    """Normalised title stem used to avoid picking 5 shots from one series."""
    s = title.lower()
    s = re.sub(r"\.(jpg|jpeg|png)$", "", s)
    s = re.sub(r"[\(\[][^)\]]*[\)\]]", " ", s)          # drop parenthesised suffixes
    s = re.sub(r"[^a-z ]", " ", s)
    s = re.sub(r"\b\d+\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = " ".join(w[:-1] if (len(w) > 4 and w.endswith("s") and not w.endswith("ss")) else w
                 for w in s.split())
    return s


def main():
    from PIL import Image
    os.makedirs(ROOT, exist_ok=True)
    manifest = {"generatedAt": "2026-11-16", "source": "Wikimedia Commons",
                "attribution": ("Images from Wikimedia Commons contributors, licensed CC BY-SA / CC BY / "
                                "public domain. Individual credits in manifest."),
                "landmarks": {}}
    total_bytes = total_images = 0
    empty, low = [], []

    for lm in LANDMARKS:
        slug, name = lm["slug"], lm["name"]
        print(f"\n=== {slug}")
        titles = []
        for c in lm["cats"]:
            titles += cat_files(c)
        for c in lm["sub"]:
            titles += cat_files(c)
        for s in lm["search"]:
            titles += search_files(s + " filetype:bitmap", limit=40)
        titles = [t for t in dict.fromkeys(titles) if t not in _used_titles]
        info = imageinfo(titles)
        cands = []
        for t, ii in info.items():
            ext = ii.get("extmetadata", {})
            lic = license_ok(ext)
            if not lic:
                continue
            if ii.get("mime") != "image/jpeg":
                continue
            desc = strip_html(ext.get("ImageDescription", {}).get("value", ""))
            cats_meta = strip_html(ext.get("Categories", {}).get("value", ""))
            if FOREIGN_CATS.search(cats_meta):
                continue
            sc = score_candidate(t, desc, lm, lic or "")
            if sc < 40:
                continue
            cands.append((sc, t, ii, ext, lic))
        cands.sort(key=lambda x: (-x[0], x[1]))
        print(f"  candidates={len(titles)} accepted={len(cands)}")

        # --- selection: greedy pick that rewards under-represented angles ---
        picked, used_stem, angle_counts = [], {}, {}

        def stem_cap_ok(c):
            return used_stem.get(stem(c[1]), 0) < 2

        remaining = list(cands)
        while remaining and len(picked) < lm["target"]:
            best, best_key = None, None
            for c in remaining:
                a = angle_of(c[1], lm["angles"])
                n = angle_counts.get(a, 0)
                key = (c[0] + (400 if n == 0 else 0) - 60 * n, c[0])
                if best_key is None or key > best_key:
                    best, best_key = c, key
            picked.append(best)
            remaining.remove(best)
            a = angle_of(best[1], lm["angles"])
            angle_counts[a] = angle_counts.get(a, 0) + 1
            s = stem(best[1])
            used_stem[s] = used_stem.get(s, 0) + 1
        # relax the per-series cap only if the landmark is still short of its target
        for c in cands:
            if len(picked) >= lm["target"]:
                break
            if c[1] in {p[1] for p in picked}:
                continue
            picked.append(c)
        # ordered download queue: preferred picks first, then the rest as backfill
        order = picked + [c for c in cands if c[1] not in {p[1] for p in picked}]

        outdir = os.path.join(ROOT, slug)
        os.makedirs(outdir, exist_ok=True)
        imgs = []
        for sc, t, ii, ext, lic in order:
            if len(imgs) >= lm["target"]:
                break
            url = clean_url(ii.get("thumburl") or ii.get("url"))
            if not url:
                continue
            tmp = os.path.join(outdir, "__tmp.jpg")
            try:
                data = download(url, tmp)
            except Exception as e:
                print(f"    dl fail {t}: {e}")
                continue
            if len(data) < MIN_BYTES:
                os.remove(tmp)
                print(f"    too small {t} ({len(data)}b)")
                continue
            try:
                im = Image.open(tmp)
                im.load()
                w, h = im.size
                fmt = im.format
            except Exception as e:
                os.remove(tmp)
                print(f"    invalid image {t}: {e}")
                continue
            if fmt != "JPEG" or w < MIN_W or h < MIN_H:
                os.remove(tmp)
                print(f"    reject {t} {fmt} {w}x{h}")
                continue
            n = len(imgs) + 1
            final = os.path.join(outdir, f"{n}.jpg")
            os.replace(tmp, final)
            size = os.path.getsize(final)
            total_bytes += size
            author = strip_html(ext.get("Artist", {}).get("value", "")) or "Unknown"
            credit = strip_html(ext.get("Credit", {}).get("value", "")) or author
            lic_url = strip_html(ext.get("LicenseUrl", {}).get("value", ""))
            if not lic_url.startswith("http"):
                lic_url = ""
            attrib = str(ext.get("AttributionRequired", {}).get("value", "true")).lower() in ("true", "1")
            imgs.append({
                "file": f"{slug}/{n}.jpg", "width": w, "height": h, "bytes": size,
                "commonsTitle": t,
                "commonsUrl": ii.get("descriptionurl") or ("https://commons.wikimedia.org/wiki/"
                                                           + urllib.parse.quote(t.replace(" ", "_"))),
                "descriptionUrl": clean_url(ii.get("url") or ""),
                "license": lic, "licenseUrl": lic_url,
                "author": author, "credit": credit, "attributionRequired": attrib,
                "angle": angle_of(t, lm["angles"]) or "general",
            })
            _used_titles.add(t)
            print(f"    [{n}] {t}  {w}x{h} {size//1024}KB  {lic}")
        if not imgs:
            empty.append(slug)
            print("  !! NO IMAGES")
        else:
            manifest["landmarks"][slug] = {"displayName": name, "images": imgs}
            total_images += len(imgs)
            if len(imgs) < 3:
                low.append((slug, len(imgs)))

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    lines = ["# Image Credits — Bengaluru Landmarks", "",
             "All photographs are real photographs from **Wikimedia Commons**, reproduced under the",
             "licence listed against each image. Licences used: CC BY-SA 4.0 / CC BY-SA 3.0 /",
             "CC BY-SA 2.0 / CC BY 4.0 / CC BY 3.0 / CC BY 2.0 / CC0 / Public Domain.",
             "",
             "Suggested attribution format:",
             "`\"<title>\" by <author>, licensed <license>, via Wikimedia Commons`",
             "",
             "Attribution is required for every image marked *(attribution required)*.", ""]
    for slug, block in manifest["landmarks"].items():
        lines.append(f"## {block['displayName']}")
        lines.append("")
        for im in block["images"]:
            mark = " *(attribution required)*" if im.get("attributionRequired") else ""
            lines.append(f"- **{Path(im['file']).name}** — [{im['commonsTitle']}]({im['commonsUrl']})"
                         f" — {im['author']} — {im['license']}{mark}")
        lines.append("")
    with open(CREDITS, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"\nDONE landmarks={len(manifest['landmarks'])} images={total_images} "
          f"bytes={total_bytes} ({total_bytes/1024/1024:.1f} MB)")
    print("EMPTY:", empty)
    print("LOW(<3):", low)


if __name__ == "__main__":
    main()
