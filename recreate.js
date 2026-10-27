// Builds a "recreate it at home" plan for a work: a home-friendly method, a materials list with
// estimated costs, and steps with times. It uses templates, not AI: the method comes from the work's
// type, technique and medium; the size, quantities, costs and times scale with its dimensions; and
// the paint or ink colors are matched to the museum's color analysis of the work.
//
// Prices are typical US art-supply prices for student-grade materials (2026), as low–high ranges.

// ---------- Colors ----------

// Common artist colors, matched against the work's palette.
const PAINTS = [
  ["Titanium White", "#f4f3ee"], ["Unbleached Titanium", "#e6dcc3"], ["Lemon Yellow", "#f3e33b"],
  ["Cadmium Yellow Medium Hue", "#f8b80f"], ["Yellow Ochre", "#c99a3b"], ["Cadmium Orange Hue", "#f07a18"],
  ["Cadmium Red Light Hue", "#e2401d"], ["Cadmium Red Medium Hue", "#c8201e"], ["Alizarin Crimson Hue", "#8e1f2b"],
  ["Quinacridone Magenta", "#b0306a"], ["Dioxazine Purple", "#4b2a6e"], ["Ultramarine Blue", "#2b3c9b"],
  ["Cerulean Blue Hue", "#2f80c3"], ["Phthalo Blue", "#10316b"], ["Phthalo Green", "#0f5b4a"],
  ["Permanent Green Light", "#4fa33a"], ["Sap Green", "#4f6b2c"], ["Raw Sienna", "#b7793a"],
  ["Burnt Sienna", "#8f4325"], ["Raw Umber", "#5e4a33"], ["Burnt Umber", "#5a3825"],
  ["Payne's Gray", "#3b4652"], ["Mars Black", "#1b1b1b"],
].map(([name, hex]) => ({ name, hex }));

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// "Redmean" color distance: a cheap approximation of how different two colors look.
function distance(a, b) {
  const r = (a[0] + b[0]) / 2;
  const [dr, dg, db] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
}

const lightness = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 2.55;

// The paints closest to the work's main colors, each with the share of the image it covers and a mixing tip.
function matchPaints(colors, { limit = 6, white = true, paper = false } = {}) {
  const found = new Map();
  for (const c of (colors || []).filter((c) => c.color && c.percent >= 0.02)) {
    const color = rgb(c.color);
    if (paper && lightness(color) > 80) continue; // the paper showing through, not an ink
    const paint = PAINTS.reduce((best, p) => (distance(color, rgb(p.hex)) < distance(color, rgb(best.hex)) ? p : best));
    const entry = found.get(paint.name) || { ...paint, share: 0, originals: [], lighter: 0, darker: 0 };
    entry.share += c.percent;
    entry.originals.push(c.color);
    const diff = lightness(color) - lightness(rgb(paint.hex));
    if (diff > 12) entry.lighter += c.percent;
    if (diff < -12) entry.darker += c.percent;
    found.set(paint.name, entry);
  }
  let paints = [...found.values()].sort((a, b) => b.share - a.share).slice(0, limit);
  if (white && !paints.some((p) => p.name === "Titanium White")) {
    paints.push({ ...PAINTS[0], share: 0, originals: [], lighter: 0, darker: 0, forMixing: true });
  }
  return paints.map((p) => ({
    ...p,
    tip: p.forMixing ? "for mixing lighter tints"
      : p.lighter > p.share / 2 ? `about ${pct(p.share)} of the image; lighten with white`
      : p.darker > p.share / 2 ? `about ${pct(p.share)} of the image; darken with a touch of Burnt Umber`
      : `about ${pct(p.share)} of the image`,
  }));
}

const pct = (x) => `${Math.max(1, Math.round(x * 100))}%`;

// ---------- Size ----------

function parseSize(dimensions) {
  const text = (dimensions || "").replace(/\s+/g, " ");
  const flat = text.match(/(\d+(?:\.\d+)?) ?x ?(\d+(?:\.\d+)?)(?: ?x ?(\d+(?:\.\d+)?))? ?cm/i);
  if (flat) return { h: +flat[1], w: +flat[2], d: flat[3] ? +flat[3] : null };
  const height = text.match(/H\.? ?(\d+(?:\.\d+)?) ?cm/i);
  if (height) return { h: +height[1], w: null, d: null };
  return null;
}

const inches = (cm) => Math.round((cm / 2.54) * 2) / 2;
const round = (cm) => (cm >= 10 ? Math.round(cm) : Math.round(cm * 10) / 10);

// The home version keeps the original's proportions and fits within `max` cm on its longest side.
function homeSize(dimensions, max, fallback) {
  const original = parseSize(dimensions);
  const base = original && original.w ? original : original ? { ...original, w: original.h } : fallback;
  const longest = Math.max(base.h, base.w);
  const scale = Math.min(1, max / longest);
  const h = round(base.h * scale);
  const w = round(base.w * scale);
  return {
    h, w,
    area: (h * w) / 10000, // m²
    scaled: scale < 1,
    known: Boolean(original),
    label: `${h} × ${w} cm (${inches(h)} × ${inches(w)} in)`,
    original: original ? `${round(original.h)}${original.w ? ` × ${round(original.w)}` : ""} cm` : null,
  };
}

// ---------- Plan pieces ----------

const item = (name, amount, low, high, note = "", extra = {}) => ({ name, amount, low, high, note, ...extra });
const have = (name, note = "") => ({ name, amount: "", low: 0, high: 0, note, household: true });
const optional = (name, amount, low, high, note = "") => ({ name, amount, low, high, note, optional: true });
const step = (title, text, active, wait = 0) => ({ title, text, active: Math.round(active), wait: Math.round(wait) });

function paintItems(paints, kind, low, high, amount) {
  return paints.map((p) => item(`${p.name} ${kind}`, amount, low, high, p.tip, { swatches: p.originals.slice(0, 3), paint: p.hex }));
}

const list = (paints) => paints.filter((p) => !p.forMixing).map((p) => p.name).join(", ");

// ---------- Methods ----------
// Each takes the plan context and returns { method, difficulty, intro, materials, steps, tips }.

const METHODS = {
  acrylic(ctx) {
    const { size, f, work, extras, style } = ctx;
    const stain = /color field|abstract expressionism|minimalism/i.test(style || "");
    const paints = matchPaints(work.colors);
    const big = size.area > 0.2;
    const materials = [
      stain
        ? item("Unprimed cotton canvas (raw duck)", "1 yard (cut 10 cm larger than your size)", 10, 18, "raw canvas lets thinned paint soak in")
        : item("Stretched, primed canvas or canvas panel", size.label, ...canvasPrice(size)),
      ...paintItems(paints, "acrylic", big ? 9 : 5, big ? 14 : 9, big ? "4 oz tube" : "2 oz tube"),
      item("Acrylic flow medium (or pouring medium)", "4 oz", 8, 12, "thins paint without breaking it down"),
      item("Synthetic brushes", "set: 1 wide flat, 1 medium flat, 1 small round", 10, 20),
      item("Painter's tape", "1 roll", 4, 7),
      item("Palette or paper plates, plus a few plastic cups", "", 0, 5),
      have("Water jar, rags or paper towels"),
      have("A printout of the work, about letter size", "use the museum page's image"),
      optional("Acrylic varnish (satin)", "4 oz", 9, 14, "protects the finished painting"),
    ];
    if (stain) materials.splice(1, 0, item("Stretcher bars or a sheet of plywood/foam board to tape the canvas to", "to fit your size", 8, 20));
    if (extras.spray) materials.push(item(`Spray paint (${ctx.accent.name.replace(/ Hue$/, "")} or close)`, "1 can", 6, 9, "for the spray-enamel marks in the original"));
    if (extras.pencil) materials.push(item("Graphite pencil (HB) and eraser", "", 2, 4, "the original has pencil lines"));
    if (extras.gold) materials.push(item("Metallic gold acrylic", "2 oz", 6, 10));
    const steps = [
      step("Set up and study the work", `Print the image and look at how the paint sits: thin washes or thick strokes, sharp or soft edges, which colors were laid down first. Cover your table and floor with plastic or newspaper.`, 20),
      stain
        ? step("Prepare the raw canvas", `Cut the canvas ${size.label} plus a 5 cm border and tape or staple it flat and taut to your board or stretcher bars. Don't prime it: the paint should soak into the bare cotton, as it does in color field painting.`, 30)
        : step("Prepare the canvas", `Wipe the canvas clean. If you want the canvas texture to show less, brush on a thin coat of gesso and let it dry.`, 10, 0),
      step("Transfer the composition", `Draw a light grid (for example 4 × 4) over the printout and the same grid on the canvas in pencil, then copy the main shapes square by square. Keep it loose; you're placing areas of color, not outlines.`, 30 * f),
      step("Mix your colors", `Squeeze out ${list(paints)}. Mix each color to match the printout, adding white to lighten. ${stain ? "Thin each color with flow medium and water to the consistency of cream or thinner, in cups." : "Keep a little flow medium handy for thin, transparent layers."}`, 20),
      stain
        ? step("Pour and stain the big areas", `Working on the floor or a flat table, pour the thinned paint and tilt the canvas or spread it with a wide brush or squeegee so it soaks in, as in the original. Let colors meet and bleed where the original does.`, 45 * f, 120)
        : step("Block in the large areas", `Paint the biggest color areas first with a wide brush, thin layers, working from background to foreground. Don't worry about details yet.`, 60 * f, 60),
      step("Build up the layers", `Add the second and third layers of color, adjusting to match the printout. ${stain ? "Add thinned paint over dry areas to deepen them, the way stained layers build in the original." : "Use thicker paint where the original shows visible brushstrokes."}`, 75 * f, 120),
      ...(extras.spray ? [step("Add the spray-paint marks", `Outdoors or in a very well ventilated space, mask the canvas with paper and add short bursts of spray paint where the original has spray marks. Let it dry.`, 20, 60)] : []),
      ...(extras.pencil ? [step("Draw the pencil lines", `Once the paint is dry, add the pencil lines or grid that show in the original with an HB pencil and a ruler.`, 20 * f)] : []),
      step("Refine edges and details", `Use the small round brush for edges, drips and small marks. Step back often and compare with the printout.`, 45 * f),
      step("Dry and varnish", `Let the painting dry for at least a day, then brush on a thin, even coat of varnish if you're using one.`, 15, 24 * 60),
    ];
    return {
      method: stain ? "Acrylic stain painting on raw canvas" : "Acrylic painting on canvas",
      difficulty: "Moderate",
      intro: `${work.medium ? `The original is ${lc(work.medium)}. ` : ""}${stain ? "Acrylic thinned with flow medium soaks into raw canvas much like the stained color fields of the original, and it dries in hours." : "Acrylic is the easiest paint to use at home: it cleans up with water and dries in minutes to hours."}${/oil/i.test(work.medium) ? " The original also uses oil paint; acrylic gives a similar look with much shorter drying times." : ""}`,
      materials, steps,
      tips: [
        "Acrylic darkens slightly as it dries, so test each mix on scrap paper.",
        ...(extras.spray ? ["Spray paint only outdoors or with strong ventilation, and wear a mask."] : []),
        "Wash brushes with soap and water before the paint dries in them.",
      ],
    };
  },

  oil(ctx) {
    const { size, f, work } = ctx;
    const paints = matchPaints(work.colors);
    return {
      method: "Oil painting on canvas",
      difficulty: "Moderate to hard",
      intro: `${work.medium ? `The original is ${lc(work.medium)}. ` : ""}Oil paint stays wet for days, which makes blending easy but drying slow. Use odorless solvent and keep the room ventilated.`,
      materials: [
        item("Stretched, primed canvas or canvas panel", size.label, ...canvasPrice(size)),
        ...paintItems(paints, "oil paint", 6, 12, "37 ml tube"),
        item("Odorless mineral spirits", "16 oz", 10, 15, "for thinning and cleaning"),
        item("Linseed oil or a painting medium", "2.5 oz", 6, 10),
        item("Hog-bristle and synthetic brushes", "set of 4–6", 12, 25),
        item("Palette knife", "1", 4, 7),
        item("Disposable palette paper", "pad", 6, 10),
        have("Rags or paper towels, a jar with a lid"),
        have("A printout of the work, about letter size"),
      ],
      steps: [
        step("Set up and study the work", "Print the image and note the order of layers: dark underpainting, middle tones, highlights. Ventilate the room.", 20),
        step("Tone the canvas", "Brush a thin wash of Burnt Sienna or Raw Umber thinned with solvent over the canvas. It dries in about an hour.", 15, 60),
        step("Transfer the composition", "Grid the printout and the canvas (for example 4 × 4) and copy the main shapes with thinned paint and a small brush.", 30 * f),
        step("Underpainting", "Block in darks and middle tones with paint thinned with solvent (\"lean\" layers). Let it get tacky or dry overnight.", 60 * f, 12 * 60),
        step("Main painting", `Mix ${list(paints)} to match the printout and paint the main color areas. Add a little oil to later layers (\"fat over lean\") so they don't crack.`, 120 * f, 24 * 60),
        step("Details and highlights", "Add the smallest details and brightest highlights last, with thicker paint.", 60 * f),
        step("Dry", "Let the painting dry somewhere dust-free. It will be touch-dry in about a week; wait months before any varnish.", 10, 7 * 24 * 60),
      ],
      tips: ["Never pour solvent down the drain; let used solvent settle and reuse the clear part.",
        "Oily rags can self-heat: dry them flat outdoors before throwing them away."],
    };
  },

  watercolor(ctx) {
    const { size, f, work } = ctx;
    const gouache = /gouache|opaque/i.test(work.medium || "");
    const paints = matchPaints(work.colors, { white: gouache });
    return {
      method: gouache ? "Gouache painting on paper" : "Watercolor painting on paper",
      difficulty: "Moderate",
      intro: `${work.medium ? `The original is ${lc(work.medium)}. ` : ""}${gouache ? "Gouache is opaque watercolor: flat, matte color that covers what's beneath it." : "Watercolor is built up in transparent layers from light to dark, so plan where the paper should stay white."}`,
      materials: [
        item(`${gouache ? "Hot-press" : "Cold-press"} watercolor paper, 300 g/m² (140 lb)`, `pad or sheet at least ${size.label}`, 12, 20),
        gouache
          ? paintItems(paints, "gouache", 5, 9, "15 ml tube")
          : item("Student watercolor set (12 or more pans)", "", 15, 30, `use ${list(paints)} or the closest pans`),
        item("Round brushes", "sizes 2, 6 and 10", 8, 15),
        item("Artist's tape or masking tape", "1 roll", 4, 7),
        item("Pencil (HB) and kneaded eraser", "", 3, 5),
        have("Two water jars, paper towels, a white plate for mixing"),
        have("A printout of the work"),
      ].flat(),
      steps: [
        step("Tape the paper down", "Tape all four edges of the paper to a board or table so it stays flat when wet.", 10),
        step("Draw the outlines lightly", "Trace or grid-transfer the main shapes in very light pencil. Erase heavy lines; they show through.", 30 * f),
        step(gouache ? "Paint the flat color areas" : "First light washes", gouache ? "Mix each color to a creamy consistency and fill the larger areas evenly. Let each area dry before painting next to it." : "Wet an area with clean water and float in the lightest colors. Leave the white areas of the paper untouched.", 40 * f, 30),
        step(gouache ? "Layer the next colors" : "Middle tones", gouache ? "Paint the next colors over or beside the first ones; gouache covers well, so you can correct as you go." : "Once dry, add the middle tones on dry paper for crisper edges.", 50 * f, 30),
        step("Darks and details", "Use the smallest brush and stronger mixes for the darkest areas and fine details.", 40 * f),
        step("Remove the tape", "When the painting is completely dry, peel the tape away slowly at a low angle for a clean border.", 5, 30),
      ],
      tips: ["Test colors on a scrap of the same paper; they dry lighter than they look wet."],
    };
  },

  drawing(ctx) {
    const { size, f, work } = ctx;
    const text = `${work.medium} ${work.technique}`.toLowerCase();
    const media = /charcoal/.test(text) ? "charcoal" : /pastel|chalk|crayon/.test(text) ? "pastel" : /ink|pen/.test(text) ? "ink" : "graphite";
    const tools = {
      graphite: [item("Graphite pencils", "set: 2H, HB, 2B, 4B, 6B", 8, 12), item("Blending stumps", "2–3", 3, 5)],
      charcoal: [item("Charcoal set (vine and compressed sticks, charcoal pencils)", "", 8, 14), item("Blending stumps", "2–3", 3, 5)],
      pastel: [item("Soft pastels or chalk pastels", "set of 24", 12, 25, "pick sets with the work's main colors"), item("Blending stumps", "2–3", 3, 5)],
      ink: [item("Dip pen with 2–3 nibs, or fine-liner pens (0.1–0.8)", "", 8, 15), item("Black India ink", "1 oz", 5, 8), item("Small round brush for ink washes", "", 3, 6)],
    }[media];
    return {
      method: `${cap(media)} drawing on paper`,
      difficulty: "Easy to moderate",
      intro: `${work.medium ? `The original is ${lc(work.medium)}. ` : ""}A drawing is the most direct work to recreate: what matters is getting the proportions and the range from light to dark right.`,
      materials: [
        item(media === "pastel" ? "Toned pastel paper" : "Drawing paper, 150 g/m² or heavier", `pad at least ${size.label}`, 10, 16),
        ...tools,
        item("Kneaded eraser", "1", 2, 3),
        ...(media === "ink" ? [] : [optional("Workable fixative spray", "1 can", 8, 12, "keeps the drawing from smudging")]),
        have("A printout of the work, ideally the same size as your drawing"),
      ],
      steps: [
        step("Measure the proportions", "Draw a rectangle with the same proportions as the original and a light 3 × 3 grid on both the printout and your paper.", 15),
        step("Block in the big shapes", "With light pressure, sketch the largest shapes and the main lines of the composition.", 25 * f),
        step("Map the values", "Squint at the printout and mark the darkest and lightest areas. Shade the middle tones lightly everywhere first.", 40 * f),
        step("Build the darks", media === "ink" ? "Build darker areas with hatching and cross-hatching, or thinned ink washes, until they match." : "Layer darker strokes gradually; blend with a stump where the original is smooth, and leave visible strokes where it isn't.", 60 * f),
        step("Details and highlights", media === "ink" ? "Add the finest lines last. Let the ink dry completely." : "Lift highlights with the kneaded eraser and sharpen key edges.", 30 * f, media === "ink" ? 30 : 0),
        ...(media === "ink" ? [] : [step("Fix it (optional)", "Outdoors, spray a light coat of fixative from about 30 cm away.", 5, 15)]),
      ],
      tips: ["Turn the printout and your drawing upside down to compare shapes without your brain filling in details."],
    };
  },

  inkPainting(ctx) {
    const { size, f, work } = ctx;
    const color = (work.colors || []).some((c) => { const [r, g, b] = rgb(c.color); return Math.max(r, g, b) - Math.min(r, g, b) > 50 && c.percent > 0.05; });
    return {
      method: "East Asian ink painting on rice paper",
      difficulty: "Moderate",
      intro: `${work.medium ? `The original is ${lc(work.medium)}. ` : ""}Ink painting depends on brush control and on the many tones you get by diluting one black ink. Practice strokes first; the paper is absorbent and forgives nothing.`,
      materials: [
        item("Xuan (rice) paper", `roll or pack, at least ${size.label}`, 10, 18),
        item("Sumi or Chinese bottled ink", "2 oz", 7, 12),
        item("Ink brushes (one large, one fine)", "2", 10, 18),
        item("Felt painting mat", "1", 8, 14, "goes under the paper to absorb extra ink"),
        ...(color ? [item("Chinese painting colors or watercolor tubes", "set of 6–12", 10, 20, "for the color washes")] : []),
        item("Small dishes for diluting ink", "3–4", 0, 6),
        have("Paperweights (or smooth stones), water jar, newspaper for practice"),
        optional("Soft eraser block and craft knife to carve a seal, plus red stamp pad", "", 6, 10, "a personal seal, like the red stamps on the original"),
      ],
      steps: [
        step("Practice strokes", "On newspaper, practice dots, lines and wide washes. Try holding the brush upright and at an angle, fast and slow.", 30),
        step("Prepare ink tones", "Pour ink into dishes and dilute it to three or four tones, from nearly black to pale grey.", 10),
        step("Plan the composition", "Look at the printout and decide the order: the main forms first, then lighter background areas, then accents. Don't draw in pencil on rice paper.", 10),
        step("Paint the main forms", "With the paper on the felt mat, paint the main forms with confident strokes in the middle tones.", 30 * f, 15),
        step("Add darker accents and details", "Use the darkest ink and the fine brush for accents, textures and details.", 30 * f, 15),
        ...(color ? [step("Add color washes", "Brush light color washes into the areas that have color in the original, letting them blend softly.", 25 * f, 30)] : []),
        step("Dry flat (and add a seal)", "Let it dry flat. If you carved a seal, stamp it where the original's seals are.", 10, 60),
      ],
      tips: ["Expect to paint several versions; ink painters often keep only the best of many attempts."],
    };
  },

  manuscript(ctx) {
    const plan = METHODS.watercolor({ ...ctx, work: { ...ctx.work, medium: `${ctx.work.medium || ""} opaque` } });
    return {
      ...plan,
      method: "Gouache miniature painting with gold accents",
      difficulty: "Hard",
      intro: `${ctx.work.medium ? `The original is ${lc(ctx.work.medium)}. ` : ""}Manuscript paintings use opaque watercolor in flat, jewel-like areas with fine detail and gold. Gouache and gold paint get you close.`,
      materials: [...plan.materials, item("Metallic gold watercolor or gold gouache", "1 small pan or tube", 6, 12), item("Very fine brush (size 0 or 00)", "1", 4, 8)],
      steps: [...plan.steps.slice(0, -1),
        step("Add gold and fine details", "With the finest brush, add gold details, borders and the smallest patterns last.", 45 * ctx.f),
        plan.steps[plan.steps.length - 1]],
    };
  },

  relief(ctx) {
    const { size, work } = ctx;
    const inks = matchPaints(work.colors, { limit: 4, white: false, paper: true });
    const layers = Math.max(1, Math.min(4, inks.length));
    const japanese = /woodblock|japan|ukiyo/i.test(`${work.technique} ${work.medium} ${work.culture || ""}`);
    return {
      method: `Linocut print in ${layers} color${layers > 1 ? "s" : ""}`,
      difficulty: "Moderate",
      intro: `${work.technique ? `The original is a ${lc(work.technique)}. ` : ""}Soft-cut linoleum carves like wood but much more easily. ${layers > 1 ? `You'll carve one block per color and print them one after another, ${japanese ? "the same way Japanese woodblock prints are made" : "lining them up with a simple jig"}.` : ""}`,
      materials: [
        item("Soft-cut linoleum blocks", `${layers} block${layers > 1 ? "s" : ""}, ${size.label}`, 5 * layers, 9 * layers),
        item("Lino carving tool set", "", 12, 20),
        ...paintItems(inks, "block printing ink (water-based)", 7, 10, "2.5 oz"),
        item("Brayer (rubber roller)", "4 in", 8, 14),
        item(`Printmaking paper${paperTone(work.colors)}`, "pad, larger than your block", 10, 15),
        item("Tracing paper and a soft pencil (4B)", "", 4, 7),
        have("A wooden spoon (for rubbing), a sheet of glass or a baking tray for rolling ink"),
        have("Scrap cardboard for a registration jig"),
      ],
      steps: [
        step("Simplify the design into color layers", `On tracing paper over the printout, separate the image into ${layers} layer${layers > 1 ? "s" : ""}: ${inks.map((i) => i.name).join(", ")}. Each layer is one block.`, 45),
        step("Transfer the designs", "Flip each tracing over and rub it onto its block, so the printed image will face the right way. Mark the areas to keep (they print).", 20 * layers),
        step("Carve the blocks", "Carve away everything that should not print, cutting away from your hands. Start with the larger gouge, then the fine V-tool for details.", 60 * layers * Math.max(1, Math.sqrt(size.area / 0.03))),
        step("Make a registration jig", "Tape cardboard strips into an L-shaped corner on a board so every block and every sheet of paper sits in the same place.", 15),
        step("Print the first color", "Roll a thin, even layer of the lightest ink onto the first block, place it in the jig, lay the paper on top and rub firmly with the back of the spoon. Pull the print carefully. Print a few extra sheets.", 30, 60),
        ...(layers > 1 ? [step("Print the other colors", "Once each color is dry to the touch, print the next block on top, lining up the paper in the jig. Go from lightest to darkest.", 30 * (layers - 1), 60 * (layers - 1))] : []),
        step("Dry the prints", "Lay the prints flat or hang them to dry overnight.", 5, 12 * 60),
      ],
      tips: ["Warm linoleum (a few minutes on a heating pad) carves more easily.", "Always cut away from the hand holding the block."],
    };
  },

  screenprint(ctx) {
    const { size, work } = ctx;
    const inks = matchPaints(work.colors, { limit: 4, white: false, paper: true });
    const layers = Math.max(1, Math.min(4, inks.length));
    return {
      method: `Stencil screenprint in ${layers} color${layers > 1 ? "s" : ""}`,
      difficulty: "Moderate",
      intro: `${work.technique ? `The original is a ${lc(work.technique)}. ` : ""}You'll print it the same basic way: one stencil per color, ink pushed through a mesh screen. Cut paper or vinyl stencils keep it simple at home.`,
      materials: [
        item("Screen printing frame with mesh (about 110 mesh)", `at least 5 cm bigger than ${size.label}`, 20, 35),
        item("Squeegee", "a little wider than your design", 8, 12),
        ...paintItems(inks, "screen printing ink (water-based)", 8, 12, "4 oz"),
        item("Freezer paper or stencil vinyl", "1 roll or a few sheets", 5, 10, "one stencil per color"),
        item("Craft knife and cutting mat", "", 8, 15),
        item(`Smooth paper or cardstock${paperTone(work.colors)}`, "pack", 8, 12),
        item("Packing tape", "1 roll", 3, 5, "to seal the screen's edges"),
        have("A spoon or old card for spreading ink, a hairdryer"),
      ],
      steps: [
        step("Separate the colors", `Over the printout, trace the shapes for each color on its own sheet: ${inks.map((i) => i.name).join(", ")}. Add small corner marks to every sheet so they line up.`, 40),
        step("Cut the stencils", "Trace each layer onto freezer paper and cut out the parts that should print. Keep the outside frame of each stencil intact.", 30 * layers),
        step("Set up the screen", "Tape the screen's inner edges. Tape your paper's position on the table with corner marks so each sheet lands in the same place.", 20),
        step("Print the first color", "Place the first stencil under the screen (shiny side down on the paper; the ink will stick it to the mesh). Spoon ink along the top, then pull it across firmly with the squeegee at a 45° angle. Lift the screen. Print several sheets.", 30, 30),
        ...(layers > 1 ? [step("Print the remaining colors", "Wash and dry the screen, swap in the next stencil and print it over the dried first color, lining up the corner marks. Repeat for each color, lightest first.", 35 * (layers - 1), 30 * (layers - 1))] : []),
        step("Dry and heat-set", "Let the prints dry flat. Some inks need heat-setting; check the label.", 10, 60),
      ],
      tips: ["Wash the screen right after printing; dried ink can clog the mesh for good.", "Print extras: the first pulls are often uneven."],
    };
  },

  intaglio(ctx) {
    const { size, work } = ctx;
    return {
      method: "Drypoint print on clear plastic",
      difficulty: "Moderate",
      intro: `${work.technique ? `The original is ${aOrAn(lc(work.technique))}. ` : ""}Etching needs acid and a press, but drypoint gives the same kind of fine, inky lines: you scratch the image into clear plastic, ink it, wipe it and print it by hand.`,
      materials: [
        item("Clear plastic sheet (PETG or acrylic, 0.5–1 mm)", size.label, 5, 10),
        item("Etching needle or a sharp scribe", "1", 5, 8),
        item("Water-washable etching ink, black", "1 tube", 15, 20),
        item("Printmaking paper", "pack", 10, 15, "soak it in water before printing"),
        item("Tarlatan or an old cotton T-shirt for wiping", "", 0, 8),
        have("A spoon or rolling pin (or a pasta machine for small plates), tray of water, old cards for spreading ink"),
      ],
      steps: [
        step("Place the design", "Tape the plastic over the printout. The print comes out reversed, so flip the printout first if the direction matters.", 10),
        step("Scratch the lines", "Scratch the main lines into the plastic with firm pressure. Build darker areas with hatching and cross-hatching, as the original's printmaker did.", 90 * Math.max(1, Math.sqrt(size.area / 0.03))),
        step("Soak the paper", "Soak a sheet of paper in water for 10 minutes, then blot it so it's damp, not wet.", 5, 10),
        step("Ink and wipe the plate", "Spread ink over the plate and into the lines with an old card. Wipe the surface with the cloth in small circles until the plastic is clean and ink stays only in the lines.", 20),
        step("Print", "Lay the damp paper on the plate, cover with a towel, and press hard all over with a rolling pin or the back of a spoon. Peel the paper off.", 15),
        step("Dry flat", "Dry the print under a book between sheets of clean paper.", 5, 12 * 60),
      ],
      tips: ["The first print is a test: adjust how much you wipe to get lighter or darker results."],
    };
  },

  lithograph(ctx) {
    const { size, work } = ctx;
    return {
      method: "Kitchen lithography on aluminum foil",
      difficulty: "Moderate",
      intro: `${work.technique ? `The original is a ${lc(work.technique)}. ` : ""}Lithography relies on grease and water repelling each other. "Kitchen litho" uses the same chemistry with aluminum foil, cola and vegetable oil.`,
      materials: [
        item("Heavy-duty aluminum foil", "1 roll", 4, 6),
        item("Lithography crayon or a china marker (grease pencil)", "1–2", 3, 8),
        item("Oil-based block printing ink, black", "1 tube", 8, 12),
        item("Brayer (rubber roller)", "4 in", 8, 14),
        item("Smooth printing paper", "pack", 8, 12),
        have("Cola, vegetable oil, a sponge, a plexiglass sheet or smooth board"),
      ],
      steps: [
        step("Make the plate", `Wrap foil (matte side up) smoothly around a rigid board about ${size.label}, without touching the matte side with your fingers.`, 15),
        step("Draw", "Draw the image with the grease crayon, pressing harder for darks. Remember the print will be reversed.", 45 * ctx.f),
        step("Etch with cola", "Pour cola over the plate and let it sit for 2 minutes, then rinse with water.", 5, 2),
        step("Clean off the drawing", "Rub a little vegetable oil over the plate to remove the crayon; the image stays in the foil.", 5),
        step("Ink and print", "Keep the plate damp with a sponge, roll on a thin layer of ink (it sticks only to the image), lay paper on top and rub firmly. Re-dampen and re-ink for each print.", 30, 30),
        step("Dry", "Let the prints dry flat overnight.", 5, 12 * 60),
      ],
      tips: ["If ink sticks everywhere, the plate got too dry: keep sponging water on it between inkings."],
    };
  },

  photograph(ctx) {
    const { size, work } = ctx;
    return {
      method: "Cyanotype (sun print) from a printed negative",
      difficulty: "Easy to moderate",
      intro: `${work.medium || work.technique ? `The original is ${aOrAn(lc(work.medium || work.technique))}. ` : ""}A darkroom isn't practical at home, but a cyanotype is a real historical photographic process you can do with sunlight: you print a negative of the photograph on clear film and expose it onto light-sensitive paper. Prints come out Prussian blue.`,
      materials: [
        item("Pre-coated cyanotype paper (or a cyanotype chemistry kit and watercolor paper)", `pack, at least ${size.label}`, 15, 30),
        item("Inkjet transparency film", "pack", 10, 15, "for printing the negative"),
        item("Picture frame with glass or a clip frame", size.label, 8, 15),
        optional("Hydrogen peroxide (3%)", "1 bottle", 2, 4, "deepens the blue instantly"),
        have("An inkjet printer (or a print shop), a tray or sink of water, a sunny day"),
      ],
      steps: [
        step("Make the negative", "Download the image, convert it to black and white, invert it (light becomes dark) and raise the contrast. Print it on transparency film at your size.", 30),
        step("Set up in dim light", "Indoors and away from sunlight, put a sheet of cyanotype paper in the frame with the negative on top, ink side down, and close the glass.", 10),
        step("Expose in the sun", "Lay the frame in direct sunlight. Exposure takes about 5–15 minutes in summer sun, longer when cloudy; the paper turns bronze-grey when done.", 5, 12),
        step("Rinse", "Rinse the paper in cool water for 5 minutes until the water runs clear. Add a splash of hydrogen peroxide for an instant deep blue.", 10),
        step("Dry flat", "Dry the print flat, out of direct sun.", 5, 2 * 60),
      ],
      tips: ["Do a test strip first: expose a small piece and uncover sections every 2 minutes to find the best time."],
    };
  },

  ceramic(ctx) {
    const { size, work } = ctx;
    const paints = matchPaints(work.colors, { limit: 5 });
    return {
      method: "Hand-built air-dry clay vessel",
      difficulty: "Moderate",
      intro: `${work.medium ? `The original is ${lc(work.medium)}. ` : ""}Without a kiln, air-dry clay lets you build the same shape by hand and paint it to match. It's decorative only: not food-safe or waterproof.`,
      materials: [
        item("Air-dry clay", size.area > 0.03 ? "2 × 2.2 lb packs" : "1 × 2.2 lb pack", size.area > 0.03 ? 20 : 10, size.area > 0.03 ? 30 : 15),
        item("Clay modeling tool set", "", 8, 12),
        ...paintItems(paints, "acrylic", 5, 9, "2 oz tube"),
        item("Brushes", "1 medium flat, 1 small round", 5, 10),
        item("Fine sandpaper (220 grit)", "2 sheets", 3, 5),
        item("Acrylic sealer or varnish", "4 oz or 1 spray can", 8, 14),
        have("A bowl of water, a sponge, a rolling pin, a plate or board to work on"),
      ],
      steps: [
        step("Study the shape", `Look at the vessel's profile: base, belly, shoulder, neck and rim. Your version will stand about ${size.h} cm tall.`, 10),
        step("Make the base", "Roll a slab about 6 mm thick and cut a circle for the base.", 15),
        step("Build the walls with coils", "Roll even coils and stack them on the base, pressing and smoothing each one into the one below, inside and out. Widen or narrow the coils to follow the vessel's profile.", 60 * Math.max(1, size.h / 15)),
        step("Smooth and shape", "Smooth the surface with a damp sponge and refine the rim and any handles or feet.", 30),
        step("Dry slowly", "Let it dry for 2–3 days away from heat, turning it so it dries evenly.", 5, 3 * 24 * 60),
        step("Sand and paint", `Sand rough spots, wipe off the dust, then paint with ${list(paints)} to match the glaze colors in the image. Two thin coats look better than one thick one.`, 60, 120),
        step("Seal", "Brush or spray on the sealer for a sheen like the original's glaze.", 15, 24 * 60),
      ],
      tips: ["Cover clay you aren't using with plastic so it doesn't dry out.", "Scratch and wet both surfaces before joining two pieces of clay."],
    };
  },

  sculpture(ctx) {
    const { size, work } = ctx;
    const text = (work.medium || "").toLowerCase();
    const finish = /bronze|copper|brass|metal/.test(text) ? "bronze" : /marble|stone|alabaster/.test(text) ? "stone" : /wood/.test(text) ? "wood" : "paint";
    const finishes = {
      bronze: [item("Acrylic paints: Burnt Umber, Mars Black, Metallic Gold", "3 tubes", 15, 25, "for a bronze patina"), item("Phthalo Green acrylic", "1 tube", 5, 9, "for green patina, if the original has it")],
      stone: [item("Acrylic paints: Titanium White, Raw Umber, Payne's Gray", "3 tubes", 15, 25, "for a stone finish")],
      wood: [item("Acrylic paints: Raw Sienna, Burnt Umber, Burnt Sienna", "3 tubes", 15, 25, "for a wood finish")],
      paint: paintItems(matchPaints(work.colors, { limit: 4 }), "acrylic", 5, 9, "2 oz tube"),
    }[finish];
    return {
      method: "Small air-dry clay model",
      difficulty: "Moderate to hard",
      intro: `${work.medium ? `The original is ${lc(work.medium)}. ` : ""}A small clay model built over a wire armature captures the form; paint gives it the look of the original material.`,
      materials: [
        item("Air-dry clay or polymer clay", "2.2 lb", 10, 18),
        item("Aluminum armature wire", "1 roll", 6, 10),
        item("Clay modeling tool set", "", 8, 12),
        ...finishes,
        item("Brushes", "1 medium, 1 small", 5, 10),
        item("Matte or satin sealer", "4 oz", 8, 12),
        have("Aluminum foil (to bulk out the armature), a small board to work on"),
      ],
      steps: [
        step("Study the form from several angles", `Look at the museum's photos and note the main masses and pose. Your model will be about ${size.h} cm tall.`, 15),
        step("Build an armature", "Bend wire into a simple skeleton of the pose and fix it to the board; wrap foil around it to bulk out the big forms.", 30),
        step("Add clay", "Press clay over the armature in small pieces, building the main masses first and checking the proportions from all sides.", 90),
        step("Refine details", "Shape the details with tools and smooth the surfaces with a little water.", 60),
        step("Dry", "Let air-dry clay dry for 2–3 days (or bake polymer clay as the package says).", 5, 3 * 24 * 60),
        step(`Paint the ${finish === "paint" ? "colors" : `${finish} finish`}`, finish === "bronze" ? "Paint it dark brown-black, then lightly dry-brush gold on the raised areas so it catches the light like polished bronze." : finish === "stone" ? "Paint it white, then add a thin grey wash and wipe it back so it stays in the recesses." : finish === "wood" ? "Paint a base of Raw Sienna, then drag a dry brush of Burnt Umber along the form to suggest wood grain." : "Paint the colors to match the original.", 45, 60),
        step("Seal", "Finish with a coat of sealer.", 10, 24 * 60),
      ],
      tips: ["Keep the model small; larger pieces need a stronger armature and dry much more slowly."],
    };
  },

  textile(ctx) {
    const { size, work } = ctx;
    const paints = matchPaints(work.colors, { limit: 5, white: false });
    return {
      method: "Fabric painting with embroidered details",
      difficulty: "Moderate",
      intro: `${work.medium ? `The original is ${lc(work.medium)}. ` : ""}Fabric paint gives you the main areas of color, and embroidery adds the texture and outlines of a textile.`,
      materials: [
        item("Plain cotton or linen fabric", `fat quarter, larger than ${size.label}`, 5, 10),
        item("Embroidery hoop", "8–10 in", 4, 7),
        ...paintItems(paints, "fabric paint", 4, 6, "2 oz"),
        item("Embroidery floss in matching colors", "pack", 8, 15),
        item("Embroidery needles", "pack", 3, 5),
        item("Water-soluble fabric marker", "1", 4, 6),
        have("An iron, a sheet of cardboard to put under the fabric"),
      ],
      steps: [
        step("Transfer the pattern", "Tape the printout to a sunny window, tape the fabric over it and trace the main lines with the water-soluble marker.", 30),
        step("Paint the color areas", `With cardboard underneath, paint the larger areas with ${list(paints)}.`, 60, 120),
        step("Heat-set the paint", "When dry, iron the back of the fabric for the time the paint label says, so it's washable.", 10),
        step("Embroider outlines and textures", "Put the fabric in the hoop and embroider outlines and textured areas with backstitch, satin stitch and French knots where the original has them.", 120 * Math.max(1, Math.sqrt(size.area / 0.04))),
        step("Finish", "Rinse out the marker lines with cold water and press the piece face down on a towel.", 15, 60),
      ],
      tips: ["Separate embroidery floss into 2–3 strands for finer stitches."],
    };
  },

  collage(ctx) {
    const { size, work } = ctx;
    const paints = matchPaints(work.colors, { limit: 5, white: false });
    return {
      method: "Paper collage",
      difficulty: "Easy",
      intro: `${work.medium ? `The original is ${lc(work.medium)}. ` : ""}Collage is about finding papers with the right colors and textures, then arranging them.`,
      materials: [
        item("Heavy paper or illustration board for the base", size.label, 4, 10),
        item("Colored and patterned papers", `assorted, in ${paints.map((p) => p.name.replace(/ Hue$/, "").toLowerCase()).join(", ")}`, 8, 15),
        item("Matte gel medium or glue stick", "", 5, 12),
        item("Scissors and a craft knife", "", 6, 12),
        have("Old magazines, envelopes, wrapping paper"),
      ],
      steps: [
        step("Collect papers", "Gather papers that match the work's colors and textures; magazines and packaging are great sources.", 30),
        step("Sketch the layout", "Lightly mark the main shapes on the base.", 15),
        step("Cut and arrange", "Cut or tear the pieces and arrange them without gluing until the composition matches.", 45 * ctx.f),
        step("Glue down", "Glue the background pieces first, then the top layers. Smooth out bubbles.", 30 * ctx.f, 30),
        step("Press flat", "Press under heavy books overnight.", 5, 12 * 60),
      ],
      tips: ["Tearing gives soft edges; cutting gives sharp ones. Copy what the original does."],
    };
  },
};
METHODS.mixed = METHODS.acrylic;

// ---------- Choosing the method ----------

function chooseMethod(work) {
  const text = [work.classification, work.technique, work.medium].join(" ").toLowerCase();
  const tests = [
    ["screenprint", /screen ?print|serigraph|silkscreen|silk-screen/],
    ["relief", /woodcut|woodblock|wood engraving|linocut|linoleum|relief print/],
    ["intaglio", /etching|engraving|drypoint|aquatint|mezzotint|intaglio/],
    ["lithograph", /lithograph/],
    ["photograph", /photograph|gelatin silver|albumen|chromogenic|cyanotype|salted paper|daguerreotype|platinum print|inkjet print|dye transfer/],
    ["inkPainting", /ink and colou?r|ink on (paper|silk)|hanging scroll|handscroll|album leaf/],
    ["manuscript", /manuscript|opaque watercolou?r|illuminat|folio/],
    ["ceramic", /vessel|ceramic|earthenware|stoneware|porcelain|terracotta|pottery|faience/],
    ["sculpture", /sculpture|bronze|marble|carved|plaster|statue|figurine/],
    ["textile", /textile|embroider|woven|tapestry|fabric|lace|wool|velvet|brocade/],
    ["watercolor", /watercolou?r|gouache/],
    ["collage", /collage/],
    ["acrylic", /acrylic|enamel/],
    ["oil", /\boil\b/],
    ["drawing", /graphite|pencil|charcoal|chalk|pastel|crayon|pen and|ink|drawing/],
    ["acrylic", /paint/],
  ];
  const found = tests.find(([, test]) => test.test(text));
  return found ? found[0] : "mixed";
}

const MAX_SIZE = { acrylic: 60, mixed: 60, oil: 50, watercolor: 40, manuscript: 30, drawing: 40, inkPainting: 50,
  relief: 25, screenprint: 30, intaglio: 15, lithograph: 20, photograph: 25, ceramic: 20, sculpture: 20,
  textile: 30, collage: 40 };

// ---------- The plan ----------

export function makePlan(work, { style } = {}) {
  const key = chooseMethod(work);
  const size = homeSize(work.dimensions, MAX_SIZE[key], { h: 30, w: 40 });
  // Painting and drawing steps take longer on bigger surfaces.
  const f = Math.max(0.7, Math.min(1.8, Math.sqrt(size.area / 0.12)));
  const medium = (work.medium || "").toLowerCase();
  const extras = { spray: /spray/.test(medium), pencil: /pencil|graphite/.test(medium) && key === "acrylic", gold: /gold/.test(medium) };
  // Spray marks and similar accents are usually the work's most vivid color.
  const vividness = (p) => { const [r, g, b] = rgb(p.hex); return Math.max(r, g, b) - Math.min(r, g, b); };
  const accent = matchPaints(work.colors, { limit: 6, white: false }).sort((a, b) => vividness(b) - vividness(a))[0] || PAINTS[5];
  const plan = METHODS[key]({ work, size, f, extras, style, accent });

  const needed = plan.materials.filter((m) => !m.household && !m.optional);
  const extra = plan.materials.filter((m) => m.optional);
  const active = plan.steps.reduce((sum, s) => sum + s.active, 0);
  const wait = plan.steps.reduce((sum, s) => sum + s.wait, 0);
  return {
    ...plan,
    key,
    size,
    cost: { low: sum(needed, "low"), high: sum(needed, "high"),
      optionalLow: sum(extra, "low"), optionalHigh: sum(extra, "high") },
    time: { active, wait },
  };
}

const sum = (items, field) => Math.round(items.reduce((total, m) => total + m[field], 0));
const lc = (text) => text.charAt(0).toLowerCase() + text.slice(1);
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const aOrAn = (text) => (/^[aeiou]/i.test(text) ? `an ${text}` : `a ${text}`);

// "in cream" when the work's lightest large color is warm, as old paper usually is.
function paperTone(colors) {
  const light = (colors || []).filter((c) => c.percent >= 0.1 && lightness(rgb(c.color)) > 80);
  if (!light.length) return "";
  const [r, , b] = rgb(light[0].color);
  return r - b > 15 ? " in cream" : " in white";
}

function canvasPrice(size) {
  if (size.area <= 0.1) return [6, 12];
  if (size.area <= 0.25) return [12, 25];
  return [25, 45];
}

export function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) {
    const h = Math.round((minutes / 60) * 2) / 2;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round((minutes / (24 * 60)) * 2) / 2;
  return `${d} day${d === 1 ? "" : "s"}`;
}
