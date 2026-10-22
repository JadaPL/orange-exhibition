"""Gather candidates and context for "Find similar works".

Vercel runs this file as /api/similar?id=323544. It looks the work up in the Harvard Art
Museums API (with the HARVARD_API_KEY environment variable), then gathers candidate works
from Harvard that share its artist, exhibitions, type and period, technique or colors. It
also asks Wikidata for the artist's art movements and genres, adds works at Harvard by other
artists in those movements, and fetches short Wikipedia summaries for context.

The page then compares the candidates' images with the selected work's image in the browser
and ranks them by style, theme or context. Only works the museum allows at any size
(imagepermissionlevel 0) are candidates, because the API leaves out images of restricted works.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler

HARVARD = "https://api.harvardartmuseums.org/"
IMAGES = "https://nrs.harvard.edu/"
WIKIDATA = "https://www.wikidata.org/w/api.php"
SPARQL = "https://query.wikidata.org/sparql"
WIKIPEDIA = "https://en.wikipedia.org/api/rest_v1/page/summary/"
USER_AGENT = "orange-exhibition/1.0 (https://github.com/JadaPL/orange-exhibition)"

MAX_CANDIDATES = 60
WORK_FIELDS = ("objectid,title,dated,datebegin,people,primaryimageurl,imagepermissionlevel,colors,url,"
               "classification,culture,century,technique,period,exhibitions")
CANDIDATE_FIELDS = "objectid,title,dated,datebegin,people,primaryimageurl,colors,url,classification,culture,century,technique,period"

# How much each shared trait adds to a candidate's context score (capped at 1).
WEIGHTS = {"artist": 0.6, "movement": 0.45, "exhibition": 0.35, "technique": 0.2,
           "culture": 0.15, "period": 0.15, "classification": 0.1, "colors": 0.15}


def get_json(url, params=None, timeout=10):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def harvard(path, key, **params):
    return get_json(HARVARD + path, {"apikey": key, **params})


def quietly(fn, *args, default=None):
    """Context from outside sources is a bonus; a failure there shouldn't break the search."""
    try:
        return fn(*args)
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError, IndexError, TypeError):
        return default


def thumbnail(base):
    parts = (base or "").rsplit("/", 1)[-1].split(":", 2)
    if len(parts) != 3 or parts[0].lower() != "urn-3":
        return None
    return f"{IMAGES}urn-3:HUAM:{parts[2]}/full/!480,480/0/default.jpg"


def artist_of(record):
    people = record.get("people") or []
    artists = [p for p in people if p.get("role") == "Artist"] or people
    return artists[0] if artists else {}


def years(text):
    found = [int(y) for y in re.findall(r"\d{4}", text or "")]
    return found[0] if found else None


# ---------- Harvard candidates ----------

def harvard_objects(key, size, **params):
    query = params.pop("q", None)
    q = "imagepermissionlevel:0" + (f" AND ({query})" if query else "")
    data = harvard("object", key, hasimage=1, size=size, fields=CANDIDATE_FIELDS,
                   sort="totalpageviews", sortorder="desc", q=q, **params)
    return data.get("records") or []


def candidate_queries(work, key):
    """(source, function) pairs; each returns Harvard records."""
    queries = []
    person = artist_of(work).get("personid")
    if person:
        queries.append(("artist", lambda: harvard_objects(key, 30, person=person)))
    for exhibition in (work.get("exhibitions") or [])[:2]:
        exhibition_id = exhibition.get("exhibitionid")
        if exhibition_id:
            queries.append((f"exhibition:{exhibition_id}", lambda e=exhibition_id: harvard_objects(key, 30, exhibition=e)))
    facets = {k: work.get(k) for k in ("classification", "century", "culture") if work.get(k)}
    if facets:
        queries.append(("facets", lambda: harvard_objects(key, 60, **facets)))
    if work.get("technique"):
        same = {"technique": work["technique"], **({"century": work["century"]} if work.get("century") else {})}
        queries.append(("technique", lambda: harvard_objects(key, 30, **same)))
    colors = [c["color"] for c in (work.get("colors") or [])[:3] if c.get("color")]
    if colors:
        queries.append(("colors", lambda: harvard_objects(key, 30, color="|".join(colors))))
    return queries


# ---------- Wikidata and Wikipedia context ----------

def wikipedia_summary(title):
    data = get_json(WIKIPEDIA + urllib.parse.quote(title.replace(" ", "_")), timeout=8)
    extract = (data.get("extract") or "").strip()
    if not extract or data.get("type") == "disambiguation":
        return None
    return {"title": data.get("title") or title, "extract": extract,
            "url": data.get("content_urls", {}).get("desktop", {}).get("page")}


def claim_ids(entity, prop):
    return [c["mainsnak"]["datavalue"]["value"]["id"] for c in entity.get("claims", {}).get(prop, [])
            if c.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id")]


def wikidata_artist(name, birth_year):
    """The Wikidata person matching the artist's name and, when known, birth year."""
    found = get_json(WIKIDATA, {"action": "wbsearchentities", "search": name, "language": "en",
                                "type": "item", "limit": 7, "format": "json"}).get("search") or []
    ids = [f["id"] for f in found]
    if not ids:
        return None
    entities = get_json(WIKIDATA, {"action": "wbgetentities", "ids": "|".join(ids), "format": "json",
                                   "props": "claims|labels|descriptions|sitelinks", "languages": "en"})["entities"]
    for qid in ids:
        entity = entities.get(qid) or {}
        if "Q5" not in claim_ids(entity, "P31"):
            continue
        born = None
        for claim in entity.get("claims", {}).get("P569", []):
            value = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {})
            born = years(value.get("time", "")) or born
        if birth_year and born and abs(born - birth_year) > 1:
            continue
        return entity
    return None


def labels_for(ids):
    if not ids:
        return {}
    entities = get_json(WIKIDATA, {"action": "wbgetentities", "ids": "|".join(ids[:20]), "format": "json",
                                   "props": "labels|sitelinks", "languages": "en"})["entities"]
    return {qid: {"label": e.get("labels", {}).get("en", {}).get("value", qid),
                  "enwiki": e.get("sitelinks", {}).get("enwiki", {}).get("title")}
            for qid, e in entities.items()}


def movement_artists(movement_id, limit=30):
    """The best-known artists Wikidata lists in a movement."""
    query = f"""SELECT ?artistLabel WHERE {{
      ?artist wdt:P135 wd:{movement_id}; wdt:P31 wd:Q5; wikibase:sitelinks ?links.
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }} ORDER BY DESC(?links) LIMIT {limit}"""
    data = get_json(SPARQL, {"query": query, "format": "json"}, timeout=12)
    return [b["artistLabel"]["value"] for b in data["results"]["bindings"]
            if not re.fullmatch(r"Q\d+", b["artistLabel"]["value"])]


def outside_context(work):
    """Artist, movements and genres from Wikidata, with Wikipedia summaries."""
    person = artist_of(work)
    name = person.get("displayname") or person.get("name")
    context = {"artist": None, "movements": [], "genres": [], "period": None}
    if name and not re.search(r"unknown|unidentified|anonymous", name, re.I):
        entity = quietly(wikidata_artist, name, years(person.get("displaydate")))
        if entity:
            qid = entity["id"]
            title = entity.get("sitelinks", {}).get("enwiki", {}).get("title")
            context["artist"] = {
                "name": entity.get("labels", {}).get("en", {}).get("value", name),
                "description": entity.get("descriptions", {}).get("en", {}).get("value"),
                "wikidata": f"https://www.wikidata.org/wiki/{qid}",
                "wikipedia": quietly(wikipedia_summary, title) if title else None,
            }
            movement_ids = claim_ids(entity, "P135")[:3]
            genre_ids = claim_ids(entity, "P136")[:4]
            labels = quietly(labels_for, movement_ids + genre_ids, default={})
            for qid in movement_ids:
                info = labels.get(qid, {"label": qid, "enwiki": None})
                context["movements"].append({"id": qid, "label": info["label"],
                                             "wikidata": f"https://www.wikidata.org/wiki/{qid}", "enwiki": info["enwiki"]})
            context["genres"] = [labels.get(qid, {}).get("label", qid) for qid in genre_ids]
            if context["movements"] and context["movements"][0]["enwiki"]:
                context["movements"][0]["wikipedia"] = quietly(wikipedia_summary, context["movements"][0]["enwiki"])
    if not context["artist"] and work.get("period"):
        # No known artist, as for many older works: describe the period instead.
        period = re.split(r",|\(|\d", work["period"])[0].strip()
        summary = quietly(wikipedia_summary, period) if period else None
        if summary:
            context["period"] = {"label": period, "wikipedia": summary}
    return context


def movement_candidates(context, work, key):
    """Works at Harvard by other artists in the work's movements, found through Harvard's person records."""
    own = artist_of(work).get("personid")
    found = []
    for movement in context["movements"][:2]:
        names = quietly(movement_artists, movement["id"], default=[]) or []
        names = [n.replace('"', "") for n in names][:25]
        if not names:
            continue
        people = quietly(lambda: harvard("person", key, size=40, fields="personid,displayname",
                                         q="displayname:(" + " OR ".join(f'"{n}"' for n in names) + ")").get("records") or [],
                         default=[]) or []
        ids = [str(p["personid"]) for p in people if p.get("personid") and p["personid"] != own]
        if ids:
            records = quietly(lambda: harvard_objects(key, 40, person="|".join(ids[:20])), default=[]) or []
            found.append((movement["label"], records))
    return found


# ---------- Scoring and response ----------

def palette_overlap(a, b):
    mine = {c["color"]: c.get("percent", 0) for c in a or [] if c.get("color")}
    return sum(min(mine.get(c.get("color"), 0), c.get("percent", 0)) for c in b or [])


def candidate_of(record, work, reasons):
    person = artist_of(record)
    image = thumbnail(record.get("primaryimageurl"))
    if not image:
        return None
    reasons = dict(reasons)
    for field, kind in (("culture", "culture"), ("century", "period"), ("classification", "classification"),
                        ("technique", "technique")):
        if work.get(field) and record.get(field) == work.get(field):
            reasons.setdefault(kind, record[field])
    if artist_of(work).get("personid") and person.get("personid") == artist_of(work).get("personid"):
        reasons["artist"] = person.get("displayname") or person.get("name")
    overlap = palette_overlap(work.get("colors"), record.get("colors"))
    if overlap >= 0.2:
        reasons["colors"] = f"{round(overlap * 100)}% shared palette"
    score = min(1.0, sum(WEIGHTS.get(kind, 0) for kind in reasons))
    return {
        "id": record.get("objectid"),
        "title": record.get("title") or "Untitled",
        "artist": person.get("displayname") or person.get("name") or "Unknown artist",
        "dated": record.get("dated") or "",
        "url": record.get("url") or f"https://harvardartmuseums.org/collections/object/{record.get('objectid')}",
        "image": image,
        "colors": [{"color": c.get("color"), "percent": round(c.get("percent", 0), 3)} for c in record.get("colors") or []],
        "contextScore": round(score, 3),
        "reasons": [{"kind": kind, "label": label} for kind, label in reasons.items()],
    }


def similar(object_id, key):
    work = harvard(f"object/{object_id}", key, fields=WORK_FIELDS)
    if not work.get("objectid"):
        return 404, {"error": "The museum has no work with that number."}
    exhibitions = {e.get("exhibitionid"): e.get("title") for e in work.get("exhibitions") or []}

    with ThreadPoolExecutor(max_workers=8) as pool:
        context_job = pool.submit(outside_context, work)
        jobs = [(source, pool.submit(quietly, fn, default=[])) for source, fn in candidate_queries(work, key)]
        context = context_job.result()
        movement_job = pool.submit(movement_candidates, context, work, key)
        batches = [(source, job.result() or []) for source, job in jobs]
        movement_batches = movement_job.result()

    candidates, counts = {}, {}
    def add(records, source, reasons):
        counts[source] = counts.get(source, 0) + len(records)
        for record in records:
            if record.get("objectid") == work["objectid"]:
                continue
            entry = candidates.setdefault(record["objectid"], {"record": record, "reasons": {}, "sources": []})
            entry["reasons"].update(reasons)
            entry["sources"].append(source)
    for source, records in batches:
        reasons = {}
        if source.startswith("exhibition:"):
            reasons = {"exhibition": exhibitions.get(int(source.split(":")[1]), "the same exhibition")}
            source = "exhibition"
        add(records, source, reasons)
    for movement, records in movement_batches:
        add(records, "movement", {"movement": movement})

    scored = [c for c in (candidate_of(e["record"], work, e["reasons"]) for e in candidates.values()) if c]
    scored.sort(key=lambda c: c["contextScore"], reverse=True)
    return 200, {"id": work["objectid"], "context": context, "counts": counts,
                 "candidates": scored[:MAX_CANDIDATES]}


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        # The GitHub Pages copy of the site calls this from another address.
        self.send_header("Access-Control-Allow-Origin", "*")
        # Vercel caches each work's candidates for a day, which keeps calls to the APIs low.
        self.send_header("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800"
                         if status == 200 else "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET")
        self.end_headers()

    def do_GET(self):
        key = os.environ.get("HARVARD_API_KEY")
        if not key:
            self.send_json(500, {"error": "Similar works aren't set up: HARVARD_API_KEY is missing on Vercel."})
            return
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        object_id = (query.get("id") or [""])[0]
        if not object_id.isdigit():
            self.send_json(400, {"error": "Choose a work by its object number, for example ?id=323544."})
            return
        try:
            self.send_json(*similar(object_id, key))
        except urllib.error.HTTPError as err:
            message = ("The museum has no work with that number." if err.code == 404 else
                       f"The museum's collection returned an error (HTTP {err.code}). Try again in a minute.")
            self.send_json(404 if err.code == 404 else 502, {"error": message})
        except (urllib.error.URLError, TimeoutError):
            self.send_json(502, {"error": "The museum's collection didn't respond. Try again in a minute."})
