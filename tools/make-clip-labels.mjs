// Regenerates clip-labels.json: CLIP text embeddings for the themes and styles that
// "Find similar works" recognizes in images. The page only runs CLIP's image half; it compares
// each image with these saved text embeddings.
//
// Usage (once, from the repo folder):
//   npm install --no-save @huggingface/transformers@4.3.1
//   node tools/make-clip-labels.mjs
import { writeFileSync } from "node:fs";
import { AutoTokenizer, CLIPTextModelWithProjection } from "@huggingface/transformers";

const MODEL = "Xenova/clip-vit-base-patch32"; // must match CLIP_MODEL in template.html

const THEMES = {
  "landscape": "a landscape", "seascape": "the sea or a harbor", "portrait": "a portrait of a person",
  "group of figures": "a group of people", "nude": "a nude figure", "still life": "a still life",
  "flowers and plants": "flowers and plants", "animals": "animals", "architecture": "buildings and architecture",
  "interior": "a room interior", "religious scene": "a religious scene", "myth or history": "a mythological or historical scene",
  "abstraction": "an abstract composition of shapes and colors", "pattern": "a decorative pattern",
  "text and calligraphy": "writing or calligraphy", "vessel": "a vase, bowl or vessel", "sculpture": "a sculpture",
  "textile": "a textile or fabric", "coin or medal": "a coin or medal", "everyday object": "an everyday object or tool",
};
const STYLES = {
  "oil painting": "an oil painting", "watercolor": "a watercolor painting", "drawing": "a pencil or charcoal drawing",
  "ink painting": "an East Asian ink painting", "etching or engraving": "an etching or engraving",
  "woodblock print": "a Japanese woodblock print", "manuscript painting": "an Indian or Persian manuscript painting",
  "black and white photograph": "a black and white photograph", "color photograph": "a color photograph",
  "abstract expressionism": "an abstract expressionist painting", "color field": "a color field painting with large areas of flat color",
  "minimalism": "a minimalist artwork", "pop art": "a pop art work", "impressionism": "an impressionist painting",
  "cubism": "a cubist artwork", "Renaissance or Baroque painting": "a Renaissance or Baroque painting",
  "poster or graphic design": "a poster or graphic design", "ceramic": "a ceramic object", "metalwork": "a metal object",
  "antiquity": "an ancient Greek or Roman object",
};

const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const model = await CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: "quantized" });

async function embed(descriptions) {
  const labels = Object.keys(descriptions);
  const inputs = tokenizer(labels.map((k) => `an artwork showing ${descriptions[k]}`), { padding: true, truncation: true });
  const { text_embeds } = await model(inputs);
  const size = text_embeds.dims[1];
  return labels.map((label, i) => {
    const v = Array.from(text_embeds.data.slice(i * size, (i + 1) * size));
    const length = Math.hypot(...v);
    return { label, vector: v.map((x) => Math.round((x / length) * 1e4) / 1e4) };
  });
}

writeFileSync("clip-labels.json", JSON.stringify({
  model: MODEL,
  note: "CLIP text embeddings for the theme and style descriptions. Regenerate with tools/make-clip-labels.mjs.",
  themes: await embed(THEMES),
  styles: await embed(STYLES),
}));
console.log("Wrote clip-labels.json");
