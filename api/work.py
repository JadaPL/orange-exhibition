"""Look up one work in the Harvard Art Museums collection, with its wall label.

Vercel runs this file as /api/work?id=323544. It calls the Harvard Art Museums API with
the HARVARD_API_KEY environment variable, so the key never reaches the browser, and
returns the details the page shows for a selected search result.

Images are only included for works the museum allows at any size (imagepermissionlevel 0).
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

API = "https://api.harvardartmuseums.org/object/"
IMAGES = "https://nrs.harvard.edu/"
FIELDS = ("objectid,title,dated,people,primaryimageurl,images,imagepermissionlevel,colors,url,"
          "labeltext,contextualtext,creditline,objectnumber,medium,gallery,copyright,classification,technique,dimensions")


def fetch(object_id, key):
    params = urllib.parse.urlencode({"apikey": key, "fields": FIELDS})
    request = urllib.request.Request(f"{API}{object_id}?{params}",
                                     headers={"User-Agent": "orange-exhibition-search"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def image_url(base, px):
    parts = (base or "").rsplit("/", 1)[-1].split(":", 2)
    if len(parts) != 3 or parts[0].lower() != "urn-3":
        return None
    return f"{IMAGES}urn-3:HUAM:{parts[2]}/full/!{px},{px}/0/default.jpg"


def plain(text):
    """Label text as plain paragraphs separated by blank lines."""
    text = re.sub(r"<br\s*/?>|</p>", "\n\n", text or "", flags=re.I)
    text = re.sub(r"<[^>]+>", "", text).replace("\r\n", "\n")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def labels_of(record):
    """The museum's wall label, or other label or gallery texts it has published for the work.

    Other texts, such as catalogue entries, aren't wall labels and are left out.
    """
    if plain(record.get("labeltext")):
        return [{"source": "Wall label · Harvard Art Museums", "text": plain(record["labeltext"])}]
    labels = []
    for item in record.get("contextualtext") or []:
        kind = item.get("type") or item.get("context") or ""
        text = plain(item.get("text"))
        if text and re.search(r"label|gallery", kind, re.I):
            labels.append({"source": f"{kind} · Harvard Art Museums", "text": text})
    return labels[:2]


def detail_of(record):
    people = record.get("people") or []
    artists = [p for p in people if p.get("role") == "Artist"] or people
    person = artists[0] if artists else {}
    artist = person.get("displayname") or person.get("name") or "Unknown artist"
    dates = (person.get("displaydate") or "").replace(" - ", "–")
    level = record.get("imagepermissionlevel", 2)
    images = sorted(record.get("images") or [], key=lambda im: im.get("displayorder") or 99)
    image = images[0] if images else {}
    base = image.get("baseimageurl") or record.get("primaryimageurl")
    title = record.get("title") or "Untitled"
    museum, _, credit = (record.get("creditline") or "").partition(", ")
    gallery = record.get("gallery") or {}
    where = None
    if gallery:
        where = (f"Level {gallery['floor']}, Room {gallery['gallerynumber']}"
                 if gallery.get("floor") and gallery.get("gallerynumber") else gallery.get("displayname"))
    caption = " · ".join(part for part in (record.get("copyright"), "Photo: Harvard Art Museums") if part)
    return {
        "id": record.get("objectid"),
        "level": level,
        "title": title,
        "artist": artist,
        "artistDetail": ", ".join(part for part in (person.get("culture"), dates) if part),
        "dated": record.get("dated") or "",
        "image": image_url(base, 480) if level == 0 else None,
        "large": image_url(base, 1200) if level == 0 else None,
        "alt": image.get("alttext") or f"{title} by {artist}",
        "caption": caption,
        "colors": [{"color": c.get("color"), "percent": round(c.get("percent", 0), 3)}
                   for c in record.get("colors") or []],
        "museum": museum.replace("/", " / "),
        "credit": credit,
        "objectnumber": record.get("objectnumber") or "",
        "medium": record.get("medium") or "",
        "classification": record.get("classification") or "",
        "technique": record.get("technique") or "",
        "dimensions": record.get("dimensions") or "",
        "gallery": where,
        "labels": labels_of(record),
        "url": record.get("url") or f"https://harvardartmuseums.org/collections/object/{record.get('objectid')}",
    }


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        # The GitHub Pages copy of the site calls this from another address.
        self.send_header("Access-Control-Allow-Origin", "*")
        # Vercel caches each work for a day, which keeps calls to the museum's API low.
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
            self.send_json(500, {"error": "Work details aren't set up: HARVARD_API_KEY is missing on Vercel."})
            return
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        object_id = (query.get("id") or [""])[0]
        if not object_id.isdigit():
            self.send_json(400, {"error": "Choose a work by its object number, for example ?id=323544."})
            return
        try:
            record = fetch(object_id, key)
        except urllib.error.HTTPError as err:
            message = ("The museum has no work with that number." if err.code == 404 else
                       f"The museum's collection returned an error (HTTP {err.code}). Try again in a minute.")
            self.send_json(404 if err.code == 404 else 502, {"error": message})
            return
        except (urllib.error.URLError, TimeoutError):
            self.send_json(502, {"error": "The museum's collection didn't respond. Try again in a minute."})
            return
        if not record.get("objectid"):
            self.send_json(404, {"error": "The museum has no work with that number."})
            return
        self.send_json(200, detail_of(record))
