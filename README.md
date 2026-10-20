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

   If the museum restricts the work's image, the API leaves the image out. The museum still allows it at up to 256 pixels, so you can add its image ID as `"image"`. On the museum page, right-click the picture, choose **Copy Image Address**, and use the part that starts with `urn-3:` up to `_dynmc`, for example `"image": "urn-3:HUAM:73624_dynmc"`. The site always shows these images at 256 pixels or smaller.
3. Click **Commit changes**. About a minute later the work appears on the live site.

## How it works

`build.py` looks up each work in the Harvard Art Museums API, fills `template.html` with the name, artist, date, collection, image, palette and gallery location, and writes the page to `site/`. It reads the API key from the `HARVARD_API_KEY` environment variable, and the key is never included in the published page. The site is built in two places, each with its own copy of the key:

- **GitHub Pages** (https://jadapl.github.io/orange-exhibition/): a GitHub Action (`.github/workflows/build.yml`) builds on every change and every Monday, using the `HARVARD_API_KEY` repository secret.
- **Vercel** (https://orange-exhibition.vercel.app/): Vercel builds on every change, using the `HARVARD_API_KEY` environment variable in the Vercel project settings. `vercel.json` tells Vercel how to build.

If you replace the key, update it in both places.

Images load from Harvard's public image service. Works with museum image restrictions are shown no larger than 256 pixels.

## Files

- `works.json`: the works in the exhibition and their wall labels.
- `template.html`: the page design.
- `build.py`: builds the page from the API.
- `vercel.json`: the build settings for Vercel.
