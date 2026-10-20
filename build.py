"""Build the exhibition page from works.json and the Harvard Art Museums API.

Reads the API key from the HARVARD_API_KEY environment variable, looks up every
work listed in works.json, and writes site/index.html from template.html.
"""

import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
API = "https://api.harvardartmuseums.org/object/"
IMAGES = "https://nrs.harvard.edu/"

# The museum's imagepermissionlevel: 0 = any size, 1 = at most 256px, 2 = no image.
RESTRICTED_PX = 256
FULL_PX = 1600


def esc(text):
    return html.escape(str(text), quote=True)


def fetch_object(object_id, key):
    url = API + str(object_id) + "?" + urllib.parse.urlencode({"apikey": key})
    request = urllib.request.Request(url, headers={"User-Agent": "orange-exhibition-build"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as err:
        hints = {401: " Check the HARVARD_API_KEY value.", 403: " Check the HARVARD_API_KEY value.",
                 404: " Check the object number in works.json."}
        sys.exit(f"Could not load object {object_id} from the Harvard Art Museums API "
                 f"(HTTP {err.code}).{hints.get(err.code, '')}")
    except urllib.error.URLError as err:
        sys.exit(f"Could not reach the Harvard Art Museums API for object {object_id}: {err.reason}")


def artist_of(obj):
    people = obj.get("people") or []
    artists = [p for p in people if p.get("role") == "Artist"] or people
    if not artists:
        return "Unknown artist", ""
    person = artists[0]
    dates = (person.get("displaydate") or "").replace(" - ", "–")
    detail = ", ".join(part for part in (person.get("culture"), dates) if part)
    return person.get("displayname") or person.get("name") or "Unknown artist", detail


def image_source(obj, work):
    """Return (src, level, image record) for the work's main image, or None if none may be shown.

    src(px) is the image's address at most px on its longest side. The API leaves out images of
    restricted works (level 1), which the museum allows at 256px, so works.json can supply the
    image ID for those as "image".
    """
    level = obj.get("imagepermissionlevel", 2)
    images = sorted(obj.get("images") or [], key=lambda im: im.get("displayorder") or 99)
    image = images[0] if images else {}
    base = image.get("baseimageurl") or obj.get("primaryimageurl") or work.get("image") or ""
    if level >= 2 or not base:
        return None
    parts = base.rsplit("/", 1)[-1].split(":", 2)
    if len(parts) != 3 or parts[0].lower() != "urn-3":
        return None
    urn = "urn-3:HUAM:" + parts[2]
    return (lambda px: f"{IMAGES}{urn}/full/!{px},{px}/0/default.jpg"), level, image


def image_of(obj, work):
    """Return the image markup, keeping to the museum's size limit, or "" if none may be shown."""
    source = image_source(obj, work)
    if not source:
        return ""
    src, level, image = source
    limit = RESTRICTED_PX if level == 1 else FULL_PX
    width, height = image.get("width") or 0, image.get("height") or 0
    size = ""
    if width and height:
        scale = min(1, limit / max(width, height))
        size = f' width="{round(width * scale)}" height="{round(height * scale)}"'
    srcset = ""
    if level == 0:
        srcset = (f' srcset="{src(800)} 800w, {src(FULL_PX)} {FULL_PX}w"'
                  ' sizes="(max-width: 640px) 90vw, 40rem"')
    alt = work.get("alt") or image.get("alttext") or ""
    return f'<img src="{src(limit)}"{srcset}{size} loading="lazy" alt="{esc(alt)}">'


def palette_of(colors):
    if not colors:
        return ""
    hues = list(dict.fromkeys(c["hue"].lower() for c in colors if c.get("hue")))
    segments = "\n".join(
        f'            <i style="flex-grow:{c["percent"] * 100:.1f};background:{c["color"]}" '
        f'title="{c["color"]} · {c["percent"] * 100:.1f}%"></i>'
        for c in colors
    )
    return f'''        <figure class="palette" style="margin:0">
          <div class="strip" role="img" aria-label="Palette: {esc(", ".join(hues))}">
{segments}
          </div>
          <figcaption>Palette from the museum's color analysis of the painting</figcaption>
        </figure>
'''


def entry_of(work, obj, anchor):
    title = obj.get("title") or "Untitled"
    artist, artist_detail = artist_of(obj)
    dated = obj.get("dated") or str(obj.get("datebegin") or "")
    museum, _, gift = (obj.get("creditline") or "").partition(", ")
    museum = museum.replace("/", " / ")
    number = obj.get("objectnumber") or ""
    credit = " · ".join(part for part in (esc(gift), f'<span class="num">{esc(number)}</span>' if number else "") if part)

    image = image_of(obj, work)
    if image:
        caption = " · ".join(part for part in (obj.get("copyright"), "Photo: Harvard Art Museums") if part)
        artwork = f'''        <figure class="artwork">
          <div class="wall">
            {image}
          </div>
          <figcaption>{esc(caption)}</figcaption>
        </figure>

'''
    else:
        artwork = ""

    gallery = obj.get("gallery")
    chip = ""
    if gallery:
        where = (f"Level {gallery['floor']}, Room {gallery['gallerynumber']}"
                 if gallery.get("floor") and gallery.get("gallerynumber") else gallery.get("displayname", ""))
        chip = f'          <span class="chip">On view · {esc(where)}</span>\n'

    medium = obj.get("medium")
    medium_row = f"          <dt>Medium</dt>\n          <dd>{esc(medium)}</dd>\n" if medium else ""
    detail = f" <span>· {esc(artist_detail)}</span>" if artist_detail else ""
    url = obj.get("url") or f"https://harvardartmuseums.org/collections/object/{work['id']}"

    return f'''    <article class="entry" id="{anchor}">
      <div class="when"><span class="year">{esc(dated)}</span></div>
      <div class="node" aria-hidden="true"></div>
      <div class="body">
{artwork}        <div class="work-head">
          <h2>{esc(title)}</h2>
          <p class="artist">{esc(artist)}{detail}</p>
        </div>

{palette_of(obj.get("colors"))}
        <dl class="facts">
          <dt>Name</dt>
          <dd><cite>{esc(title)}</cite></dd>
          <dt>Artist</dt>
          <dd>{esc(artist)}</dd>
          <dt>Date</dt>
          <dd class="num">{esc(dated)}</dd>
          <dt>Collection</dt>
          <dd>{esc(museum)}
            <small>{credit}</small>
          </dd>
{medium_row}        </dl>

        <figure class="placard">
          <p class="eyebrow">Wall label</p>
          <p>{esc(work["label"])}</p>
        </figure>

        <div class="foot-row">
{chip}          <a href="{esc(url)}">View on the museum's website</a>
        </div>
      </div>
    </article>
'''


def exhibition_data(items):
    """The works as JSON for the color search, which lists matching exhibition works first
    and shows the same details as /api/work when one is selected."""
    works = []
    for work, obj, _ in items:
        source = image_source(obj, work)
        artist, artist_detail = artist_of(obj)
        title = obj.get("title") or "Untitled"
        museum, _, credit = (obj.get("creditline") or "").partition(", ")
        gallery = obj.get("gallery") or {}
        labels = [{"source": "Exhibition wall label", "text": work["label"]}]
        museum_label = re.sub(r"\n{3,}", "\n\n", (obj.get("labeltext") or "").replace("\r\n", "\n")).strip()
        if museum_label:
            labels.append({"source": "Wall label · Harvard Art Museums", "text": museum_label})
        works.append({
            "id": work["id"],
            "level": obj.get("imagepermissionlevel", 2),
            "title": title,
            "artist": artist,
            "artistDetail": artist_detail,
            "dated": obj.get("dated") or "",
            "url": obj.get("url") or f"https://harvardartmuseums.org/collections/object/{work['id']}",
            "image": source[0](RESTRICTED_PX if source[1] == 1 else 480) if source else None,
            "large": source[0](RESTRICTED_PX if source[1] == 1 else 1200) if source else None,
            "alt": work.get("alt") or (source[2].get("alttext") if source else None) or f"{title} by {artist}",
            "caption": " · ".join(part for part in (obj.get("copyright"), "Photo: Harvard Art Museums") if part),
            "colors": [{"color": c["color"], "percent": round(c["percent"], 3)} for c in obj.get("colors") or []],
            "museum": museum.replace("/", " / "),
            "credit": credit,
            "objectnumber": obj.get("objectnumber") or "",
            "medium": obj.get("medium") or "",
            "gallery": (f"Level {gallery['floor']}, Room {gallery['gallerynumber']}"
                        if gallery.get("floor") and gallery.get("gallerynumber") else gallery.get("displayname")),
            "labels": labels,
        })
    # Keep "</" out of the inline script so a title can never close the tag.
    return json.dumps(works, ensure_ascii=False).replace("</", "<\\/")


def scale_of(items):
    """The overview strip, drawn to scale with ticks on round years."""
    years = [obj.get("datebegin") for _, obj, _ in items if obj.get("datebegin")]
    if not years:
        return ""
    lo, hi = min(years), max(years)
    span = hi - lo
    step = 10 if span <= 60 else 25 if span <= 150 else 50 if span <= 300 else 100
    start, end = lo // step * step - step // 2, (hi // step + 1) * step + step // 2

    def pct(year):
        return f"{(year - start) / (end - start) * 100:.2f}%"

    ticks = "\n".join(f'      <span class="tick" style="left:{pct(y)}">{y}</span>'
                      for y in range(lo // step * step, end, step))
    marks = "\n".join(
        f'      <a class="mark" href="#{anchor}" style="left:{pct(obj["datebegin"])}">'
        f'{esc(artist_of(obj)[0].split()[-1])}</a>'
        for _, obj, anchor in items if obj.get("datebegin")
    )
    return f'''  <nav class="scale" aria-label="Jump to a work">
    <div class="scale-track">
{ticks}
{marks}
    </div>
    <div class="scale-gap"></div>
  </nav>'''


def main():
    key = os.environ.get("HARVARD_API_KEY")
    if not key:
        sys.exit("HARVARD_API_KEY is not set. Add it as a repository secret on GitHub "
                 "and as an environment variable on Vercel.")
    works = json.loads((ROOT / "works.json").read_text(encoding="utf-8"))

    items, used = [], set()
    for work in works:
        obj = fetch_object(work["id"], key)
        name = artist_of(obj)[0].split()[-1].lower()
        anchor = re.sub(r"[^a-z0-9]+", "-", name).strip("-") or f"work-{work['id']}"
        if anchor in used:
            anchor = f"{anchor}-{work['id']}"
        used.add(anchor)
        items.append((work, obj, anchor))
        images = obj.get("images") or []
        print(f"Loaded {work['id']}: {obj.get('title')} ({obj.get('dated')}); "
              f"image permission level {obj.get('imagepermissionlevel')}, {len(images)} image record(s), "
              f"primary image {'yes' if obj.get('primaryimageurl') else 'no'}, "
              f"image shown {'yes' if image_of(obj, work) else 'no'}")

    items.sort(key=lambda item: (item[1].get("datebegin") or 0, item[1].get("dated") or ""))
    page = (ROOT / "template.html").read_text(encoding="utf-8")
    page = page.replace("{{SCALE}}", scale_of(items))
    page = page.replace("{{ENTRIES}}", "\n".join(entry_of(w, o, a) for w, o, a in items))
    page = page.replace("{{WORKS_JSON}}", exhibition_data(items))

    out = ROOT / "site"
    out.mkdir(exist_ok=True)
    (out / "index.html").write_text(page, encoding="utf-8")
    print(f"Wrote site/index.html with {len(items)} works.")


if __name__ == "__main__":
    main()
