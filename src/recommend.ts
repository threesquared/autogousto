import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

const DATA_DIR = path.join(__dirname, '..', 'out', 'data');
const OUT_DIR = path.join(__dirname, '..', 'out');
const PROMPT_TEMPLATE_PATH = path.join(__dirname, '..', 'prompts', 'recommend.md');
const PREFERENCES_PATH = path.join(__dirname, '..', 'my-preferences.md');
const PREFERENCES_EXAMPLE_PATH = path.join(__dirname, '..', 'my-preferences.example.md');

interface Pick {
  id: string;
  name: string;
  reason: string;
}

interface Recommendation {
  picks: Pick[];
  summary: string;
}

interface EnrichedPick extends Pick {
  image?: string;
}

interface EnrichedRecommendation {
  picks: EnrichedPick[];
  summary: string;
}

interface RecommendationInputs {
  deliveryDate: string;
  compactRecipes: any[];
  recipesById: Record<string, any>;
  history: any[];
  preferences: any;
  personalPreferences: string;
  numToPick: number;
}

function latestMenuFile(): string {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('menu_') && f.endsWith('.json'));
  if (!files.length) throw new Error('No menu_*.json found — run `node bin/gousto.js fetch` first.');
  files.sort();
  return path.join(DATA_DIR, files[files.length - 1]);
}

function loadRecommendationInputs(): RecommendationInputs {
  const menuPath = latestMenuFile();
  const deliveryDate = path.basename(menuPath).replace('menu_', '').replace('.json', '');
  const compactRecipes = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
  const recipesById = Object.fromEntries(compactRecipes.map((r: any) => [r.id, r]));
  const history = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'historical_choices.json'), 'utf8'));
  const preferences = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'preferences.json'), 'utf8'));
  const personalPreferences = fs.existsSync(PREFERENCES_PATH)
    ? fs.readFileSync(PREFERENCES_PATH, 'utf8')
    : `(no my-preferences.md found — copy ${path.basename(PREFERENCES_EXAMPLE_PATH)} to my-preferences.md and fill it in)`;
  const numToPick = Number(process.env.NUM_RECIPES_TO_PICK) || 4;

  return { deliveryDate, compactRecipes, recipesById, history, preferences, personalPreferences, numToPick };
}

async function callOpenRouter(prompt: string, temperature?: number): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in .env');
  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5';

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      ...(temperature !== undefined ? { temperature } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json() as { choices: { message: { content: string } }[] };
  return json.choices[0].message.content;
}

function parseRecommendation(raw: string): Recommendation {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(cleaned);
}

function enrichPicks(picks: Pick[], recipesById: Record<string, any>): EnrichedPick[] {
  return picks.map((p) => ({ ...p, image: recipesById[p.id]?.image }));
}

function buildPrompt({ recipes, history, preferences, personalPreferences, numToPick }: {
  recipes: any[];
  history: any[];
  preferences: any;
  personalPreferences: string;
  numToPick: number;
}): string {
  const template = fs.readFileSync(PROMPT_TEMPLATE_PATH, 'utf8');
  return template
    .replaceAll('{{RECIPE_COUNT}}', String(recipes.length))
    .replaceAll('{{RECIPES_JSON}}', JSON.stringify(recipes))
    .replaceAll('{{HISTORY_COUNT}}', String(history.length))
    .replaceAll('{{HISTORY_JSON}}', JSON.stringify(history))
    .replaceAll('{{ACCOUNT_PREFERENCES_JSON}}', JSON.stringify(preferences))
    .replaceAll('{{PERSONAL_PREFERENCES}}', personalPreferences)
    .replaceAll('{{NUM_TO_PICK}}', String(numToPick));
}

function renderHtml({ picks, summary, recipesById, deliveryDate }: {
  picks: Pick[];
  summary: string;
  recipesById: Record<string, any>;
  deliveryDate: string;
}): string {
  const items = picks.map((p) => {
    const recipe = recipesById[p.id];
    const image = recipe?.image || '';
    return `
      <div style="margin-bottom:24px;">
        ${image ? `<img src="${image}" width="300" style="border-radius:8px;display:block;margin-bottom:8px;">` : ''}
        <h3 style="margin:0 0 4px;">${p.name}</h3>
        <p style="margin:0;color:#444;">${p.reason}</p>
      </div>`;
  }).join('\n');

  return `<!doctype html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h1>Your Gousto picks for ${deliveryDate}</h1>
  <p style="color:#666;">${summary}</p>
  ${items}
</body>
</html>`;
}

async function run(): Promise<void> {
  const { deliveryDate, compactRecipes, recipesById, history, preferences, personalPreferences, numToPick } =
    loadRecommendationInputs();

  console.log(`Asking OpenRouter to pick ${numToPick} recipes from ${compactRecipes.length} options...`);
  const prompt = buildPrompt({ recipes: compactRecipes, history, preferences, personalPreferences, numToPick });
  const raw = await callOpenRouter(prompt);
  const parsed = parseRecommendation(raw);

  fs.writeFileSync(path.join(DATA_DIR, 'recommendation.json'), JSON.stringify(parsed, null, 2));
  console.log('Saved out/data/recommendation.json');

  const html = renderHtml({ ...parsed, picks: parsed.picks, recipesById, deliveryDate });
  fs.writeFileSync(path.join(OUT_DIR, 'preview_email.html'), html);
  console.log(`Saved preview email to ${path.join(OUT_DIR, 'preview_email.html')} — open it in a browser to review.`);
}

// Generate `count` independent recommendation sets (same prompt, higher temperature so the model's natural sampling variance gives genuinely different picks to compare)
async function generateVariations(count: number, temperature: number): Promise<{
  deliveryDate: string;
  variations: EnrichedRecommendation[];
}> {
  const { deliveryDate, compactRecipes, recipesById, history, preferences, personalPreferences, numToPick } =
    loadRecommendationInputs();

  const prompt = buildPrompt({ recipes: compactRecipes, history, preferences, personalPreferences, numToPick });

  const variations = await Promise.all(
    Array.from({ length: count }, async () => {
      const raw = await callOpenRouter(prompt, temperature);
      const parsed = parseRecommendation(raw);
      return { picks: enrichPicks(parsed.picks, recipesById), summary: parsed.summary };
    })
  );

  fs.writeFileSync(path.join(DATA_DIR, 'recommendations.json'), JSON.stringify(variations, null, 2));
  console.log(`Saved ${variations.length} recommendation variations to out/data/recommendations.json`);

  return { deliveryDate, variations };
}

export { run, generateVariations };

if (require.main === module) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
