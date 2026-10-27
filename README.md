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

## Finding art by color

The search bar near the top of the page finds works in the Harvard Art Museums collection that use a color. Pick a swatch, choose any color with the color picker, or type a name like `teal` or a code like `#e8590c`.

**All color options** opens a grid of every color name the search box recognizes: the 148 standard web color names, with names for the same color sharing a swatch. Hover over or select a color to see its name and code, and **Search for …** runs that search.

**Sort by** puts the results in one of three orders. Works from this exhibition stay first, in the same order.

- **Closest to your color** (the default): how much of the image is close to your color.
- **Brightest overall**: the brightness of the whole image, brightest first.
- **Brightest in your color**: the brightness of the shades close to your color in that image, brightest first.

Brightness comes from the museum's color analysis of each work, measured as perceived lightness from 0 (black) to 100 (white) and weighted by how much of the image each color covers. Results show 100 per page. Use **Previous page** and **Next page**, click a page number to jump to it, or, when there are more than 7 pages, type a number into **Jump to page**. The sort applies to every work in the current batch of up to 2,000. When more than 2,000 works match (common for reds, greys, browns, pinks and black), batches follow the most viewed on the museum's website: the first batch is the 2,000 most viewed, and **Next 2,000 images** replaces it with the next 2,000, sorted the same way. **Previous 2,000 images** goes back. Works from this exhibition appear at the top of the first page of the first batch.

Select a result to see it laid out like the exhibition entries: the image, name, artist, date, collection, medium, palette, gallery location and a link to the museum's page. The wall label is the Harvard Art Museums' own label text. Many works don't have one, and the page says so. Works from this exhibition show both your wall label and the museum's. **Close**, Esc, or the browser's Back button returns to the results, and each work has its own link, such as `#color=fa7d19&work=323544`.

While you search, the exhibition timeline is hidden. Works from this exhibition that use colors close to the one you searched appear first, marked "In this exhibition". **Back to the exhibition**, or the browser's Back button, returns to the timeline. A link ending in `#color=e8590c` opens straight into that search.

The search runs in `api/search.py`, a Vercel server function at `/api/search`, and a selected work's details and wall label come from `api/work.py` at `/api/work`. It calls the Harvard Art Museums API with the `HARVARD_API_KEY` environment variable on Vercel, so the key never reaches visitors' browsers. The GitHub Pages copy of the site uses the same Vercel search.

- The museum records each work's main colors on a palette whose channels step by 25. The search looks for the closest palette color and its neighbors.
- Only works the museum allows at full size appear, because the API leaves out images of restricted works.
- A search gathers its matches 100 at a time, so one search can use up to 20 of the museum's API requests. The museum limits each key to 2,500 requests a day. Vercel remembers each search for a day, and the page rounds colors to the museum's palette first, so similar colors share one remembered search.

## Finding similar works

Every selected work has a **Find similar works** button. It looks for related works at Harvard and ranks them by **Best match**, **Style**, **Theme** or **Context**. Each result shows why it's there: orange-outlined reasons come from image analysis, and grey ones from context.

- **Image analysis.** The page compares the actual images using [CLIP](https://github.com/openai/CLIP) (`Xenova/clip-vit-base-patch32`, MIT license), an image model that runs in the visitor's browser through [Transformers.js](https://huggingface.co/docs/transformers.js). It measures how alike two images look and recognizes themes (such as landscape, portrait or abstraction) and styles (such as woodblock print, color field or photograph) from the descriptions in `clip-labels.json`. The model is a one-time 64 MB download that the browser then keeps. It uses the computer's graphics chip (WebGPU) where available, which is about 20 times faster.
- **Harvard context.** `api/similar.py`, a Vercel server function at `/api/similar`, gathers candidates from the Harvard Art Museums API: works by the same artist, works shown in the same exhibitions, works of the same type, period and culture, works with the same technique, and works with a similar palette.
- **Outside context.** The same function asks [Wikidata](https://www.wikidata.org/) for the artist's art movements and genres, adds Harvard works by other artists in those movements, and shows short [Wikipedia](https://en.wikipedia.org/) summaries of the artist and movement (or of the period, when the artist is unknown). Wikipedia text is shown as excerpts under CC BY-SA 4.0, with links to the full articles.

Up to 60 candidates are compared. Only works the museum allows at full size can be candidates. To change the themes and styles the analysis recognizes, edit `tools/make-clip-labels.mjs` and run it to regenerate `clip-labels.json`.

## Recreating a work at home

Next to **Find similar works**, **Recreate it at home** gives a step-by-step plan for making your own version of the selected work: a home-friendly method, a materials list with estimated costs, and steps with working and drying times.

Plans come from templates in `recreate.js`, not AI, so they're free and instant:

- **Method:** chosen from the work's type, technique and medium. Paintings become acrylic (or oil) paintings, screenprints become stencil screenprints, woodcuts become linocuts, etchings become drypoints on plastic, lithographs become "kitchen litho", photographs become cyanotypes, ceramics and sculpture become air-dry clay, and so on (15 methods).
- **Size:** the home version keeps the original's proportions, scaled down to fit a practical size for the method. Quantities, costs and painting times scale with it.
- **Colors:** paint or ink colors are matched to the museum's color analysis of the work, with the share of the image each covers and tips for mixing. Extra materials named in the medium, such as spray enamel, pencil or gold, add their own items and steps.
- **Style:** if Find similar works has run, its style reading can choose a closer technique, such as stain painting on raw canvas for color field works.

Costs are estimates for student-grade US art supplies in 2026.

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
- `api/search.py`: the color search, run by Vercel.
- `api/work.py`: a selected work's details and wall label, run by Vercel.
- `api/similar.py`: candidates and context for Find similar works, run by Vercel.
- `clip-labels.json`: the theme and style descriptions the image analysis compares images with.
- `tools/make-clip-labels.mjs`: regenerates `clip-labels.json`.
- `recreate.js`: builds the Recreate it at home plans.
