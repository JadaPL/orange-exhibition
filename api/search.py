"""Search the Harvard Art Museums collection by color.

Vercel runs this file as /api/search. It calls the Harvard Art Museums API with the
HARVARD_API_KEY environment variable, so the key never reaches the browser.

  /api/search?color=%23e8590c   works whose palette has a color close to this one
  &spread=0                     only the single closest museum color (default 1, up to 2)
  &batch=2                      the next MAX_WORKS matches, by views on the museum's website

It gathers a batch of up to MAX_WORKS matches, so the page can sort all of them. Batches
follow the most viewed on the museum's website: batch 1 is the most viewed, and so on. Only works the museum allows at any
size (imagepermissionlevel 0) are returned, because the API leaves out images of restricted works.
"""

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler

API = "https://api.harvardartmuseums.org/object"
IMAGES = "https://nrs.harvard.edu/"
PAGE_SIZE = 100  # the most the API returns per request
MAX_WORKS = 2000  # works gathered per search
WORKERS = 10      # API requests made at the same time
MAX_DEPTH = 1_000_000  # how far into the matches the API can page
FIELDS = "objectid,title,dated,people,primaryimageurl,colors,url"


def museum_color(hex_color):
    """Round a color to the museum's palette, whose channels step by 25 (0, 25, ... 250)."""
    return tuple(min(250, round(int(hex_color[i:i + 2], 16) / 25) * 25) for i in (0, 2, 4))


def nearby_colors(center, spread):
    """The palette colors within `spread` steps of the center on every channel, closest first."""
    steps = range(-spread, spread + 1)
    colors = {
        tuple(min(250, max(0, c + d * 25)) for c, d in zip(center, (dr, dg, db)))
        for dr in steps for dg in steps for db in steps
    }
    ordered = sorted(colors, key=lambda rgb: sum((a - b) ** 2 for a, b in zip(rgb, center)))
    return ["#" + "".join(f"{c:02x}" for c in rgb) for rgb in ordered]


def fetch(params):
    url = API + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "orange-exhibition-search"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def fetch_page(params, page):
    """One page of results, retried once if the API is busy."""
    try:
        return fetch({**params, "page": page})
    except urllib.error.HTTPError as err:
        if err.code not in (429, 500, 502, 503, 504):
            raise
        time.sleep(1)
        return fetch({**params, "page": page})


def thumbnail(base):
    urn = (base or "").rsplit("/", 1)[-1]
    parts = urn.split(":", 2)
    if len(parts) != 3 or parts[0].lower() != "urn-3":
        return None
    return f"{IMAGES}urn-3:HUAM:{parts[2]}/full/!480,480/0/default.jpg"


def result_of(record, matches):
    people = record.get("people") or []
    artist = next((p.get("name") for p in people if p.get("role") == "Artist"), None)
    if not artist and people:
        artist = people[0].get("name")
    colors = record.get("colors") or []
    return {
        "id": record.get("objectid"),
        "title": record.get("title") or "Untitled",
        "artist": artist or "Unknown artist",
        "dated": record.get("dated") or "",
        "url": record.get("url") or f"https://harvardartmuseums.org/collections/object/{record.get('objectid')}",
        "image": thumbnail(record.get("primaryimageurl")),
        "share": round(sum(c.get("percent", 0) for c in colors if matches(c)), 3),
        "colors": [{"color": c.get("color"), "percent": round(c.get("percent", 0), 3)} for c in colors],
    }


def search(query, key):
    """Return (status, body) for the parsed query string."""
    color = (query.get("color") or [""])[0].strip().lstrip("#")
    try:
        spread = max(0, min(2, int((query.get("spread") or ["1"])[0])))
        batch = max(1, int((query.get("batch") or ["1"])[0]))
    except ValueError:
        spread, batch = 1, 1
    pages_per_batch = MAX_WORKS // PAGE_SIZE
    first_page = (batch - 1) * pages_per_batch + 1
    if (first_page - 1) * PAGE_SIZE >= MAX_DEPTH:
        return 400, {"error": f"The museum's search only reaches its first {MAX_DEPTH:,} matches."}
    if not re.fullmatch(r"[0-9a-fA-F]{6}", color):
        return 400, {"error": "Choose a color, for example #e8590c."}

    params = {"apikey": key, "hasimage": 1, "size": PAGE_SIZE, "fields": FIELDS,
              "sort": "totalpageviews", "sortorder": "desc", "q": "imagepermissionlevel:0"}
    colors = nearby_colors(museum_color(color.lower()), spread)
    params["color"] = "|".join(colors)
    wanted = set(colors)
    matches = lambda c: (c.get("color") or "").lower() in wanted

    try:
        first = fetch_page(params, first_page)
        info = first.get("info") or {}
        last_page = min(info.get("pages") or 0, first_page + pages_per_batch - 1, MAX_DEPTH // PAGE_SIZE)
        records = list(first.get("records") or [])
        if last_page > first_page:
            with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                for data in pool.map(lambda page: fetch_page(params, page), range(first_page + 1, last_page + 1)):
                    records.extend(data.get("records") or [])
    except urllib.error.HTTPError as err:
        return 502, {"error": f"The museum's collection search returned an error (HTTP {err.code}). Try again in a minute."}
    except (urllib.error.URLError, TimeoutError):
        return 502, {"error": "The museum's collection search didn't respond. Try again in a minute."}

    results, ids = [], set()
    for record in records:
        result = result_of(record, matches)
        if result["image"] and result["id"] not in ids:
            ids.add(result["id"])
            results.append(result)
    # Closest first; ties keep the API's most-viewed order.
    results.sort(key=lambda r: r["share"], reverse=True)
    total = info.get("totalrecords", 0)
    return 200, {"query": {"color": colors[0], "colors": colors}, "total": total, "limit": MAX_WORKS,
                 "batch": batch, "batches": max(1, -(-min(total, MAX_DEPTH) // MAX_WORKS)), "results": results}


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        # The GitHub Pages copy of the site calls this from another address.
        self.send_header("Access-Control-Allow-Origin", "*")
        # Vercel caches each search for a day, which keeps calls to the museum's API low.
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
            self.send_json(500, {"error": "Search isn't set up: HARVARD_API_KEY is missing on Vercel."})
            return
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        self.send_json(*search(query, key))
