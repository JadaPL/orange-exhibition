# Orange

A timeline exhibition of abstract paintings from the [Harvard Art Museums](https://harvardartmuseums.org/) collection that work with orange, arranged from oldest to newest.

**Live site:** https://jadapl.github.io/orange-exhibition/

## Works

| Year | Name | Artist | Collection |
| ---- | ---- | ------ | ---------- |
| 1960 | *Four-Three-Eight (Orange Column)* | Morris Louis | Harvard Art Museums / Fogg Museum |
| 1970 | *Summer Orange* | Joan Snyder | Harvard Art Museums / Fogg Museum |
| 1987 | *Rex* | Helen Frankenthaler | Harvard Art Museums / Fogg Museum |

## Adding a work

1. Find the work's object number in its museum web address, for example `harvardartmuseums.org/collections/object/228057`.
2. Open `works.json`, click the pencil icon, and add an entry with that number and your wall label:

   ```json
   { "id": 228057, "label": "Your wall label" }
   ```

   Separate entries with commas. The order doesn't matter: the site sorts works by date. An optional `"alt"` adds a description of the image for screen readers.
3. Click **Commit changes**. About a minute later the work appears on the live site.

## How it works

A GitHub Action (`.github/workflows/build.yml`) runs `build.py` on every change and every Monday. The script looks up each work in the Harvard Art Museums API using the `HAM_API_KEY` repository secret, fills `template.html` with the name, artist, date, collection, image, palette and gallery location, and publishes the result to GitHub Pages. The key is never included in the published page.

Images load from Harvard's public image service. Works with museum image restrictions are shown no larger than 256 pixels.

## Files

- `works.json`: the works in the exhibition and their wall labels.
- `template.html`: the page design.
- `build.py`: builds the page from the API.
