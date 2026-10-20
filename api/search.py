"""Search the Harvard Art Museums collection by color.

Vercel runs this file as /api/search. It calls the Harvard Art Museums API with the
HARVARD_API_KEY environment variable, so the key never reaches the browser.

  /api/search?color=%23e8590c   works whose palette has the closest museum color
  /api/search?hue=Orange        works whose palette has that hue
  &page=2                       the next page of results

Only works the museum allows at any size (imagepermissionlevel 0) are returned,
because the API leaves out images of restricted works.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

API = "https://api.harvardartmuseums.org/object"
IMAGES = "https://nrs.harvard.edu/"
HUES = ["Red", "Orange", "Yellow", "Green", "Blue", "Violet", "Brown", "Grey", "Black", "White"]
PAGE_SIZE = 48
MAX_PAGE = 50
FIELDS = "objectid,title,dated,people,primaryimageurl,colors,url"


def museum_color(hex_color):
    """Round a color to the museum's palette, whose channels step by 25 (0, 25, ... 250)."""
    channels = [int(hex_color[i:i + 2], 16) for i in (0, 2, 4)]
    return "#" + "".join(f"{min(250, round(c / 25) * 25):02x}" for c in channels)


def fetch(params):
    url = API + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "orange-exhibition-search"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


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
        "colors": [{"color": c.get("color"), "percent": round(c.get("percent", 0), 3)} for c in colors[:8]],
    }


def search(query, key):
    """Return (status, body) for the parsed query string."""
    color = (query.get("color") or [""])[0].strip().lstrip("#")
    hue = (query.get("hue") or [""])[0].strip().capitalize()
    try:
        page = max(1, min(MAX_PAGE, int((query.get("page") or ["1"])[0])))
    except ValueError:
        page = 1

    params = {"apikey": key, "hasimage": 1, "size": PAGE_SIZE, "page": page, "fields": FIELDS,
              "sort": "totalpageviews", "sortorder": "desc", "q": "imagepermissionlevel:0"}
    if re.fullmatch(r"[0-9a-fA-F]{6}", color):
        value = museum_color(color.lower())
        params["color"] = value
        label = {"type": "color", "value": value}
        matches = lambda c: (c.get("color") or "").lower() == value
    elif hue in HUES:
        params["q"] += f" AND colors.hue:{hue}"
        label = {"type": "hue", "value": hue}
        matches = lambda c: c.get("hue") == hue
    else:
        return 400, {"error": "Choose a color, such as #e8590c, or a color name: " + ", ".join(HUES) + "."}

    try:
        data = fetch(params)
    except urllib.error.HTTPError as err:
        return 502, {"error": f"The museum's collection search returned an error (HTTP {err.code}). Try again in a minute."}
    except (urllib.error.URLError, TimeoutError):
        return 502, {"error": "The museum's collection search didn't respond. Try again in a minute."}

    info = data.get("info") or {}
    results = [r for r in (result_of(rec, matches) for rec in data.get("records") or []) if r["image"]]
    results.sort(key=lambda r: r["share"], reverse=True)
    return 200, {"query": label, "total": info.get("totalrecords", 0), "page": page,
                 "pages": min(info.get("pages", 0), MAX_PAGE), "results": results}


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
