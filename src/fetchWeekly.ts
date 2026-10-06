import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

const OUT_DIR = path.join(__dirname, '..', 'out', 'data');
const API = 'https://production-api.gousto.co.uk';
const INGREDIENT_FETCH_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(pathAndQuery: string): Promise<any> {
  const token = process.env.GOUSTO_ACCESS_TOKEN;
  if (!token) throw new Error('GOUSTO_ACCESS_TOKEN not set — run `node bin/gousto.js login` first.');

  const res = await fetch(`${API}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${pathAndQuery}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function compactOrder(o: any) {
  return {
    state: o.state,
    phase: o.phase,
    deliveryDate: o.human_delivery_date,
    boxType: o.box?.box_type,
    numPortions: o.box?.num_portions,
    recipes: (o.recipe_items || []).map((r: any) => r.title),
  };
}

// Fetch the ingredient details for the given recipe IDs
async function fetchIngredientDetails(recipeIds: string[], numPortions: number): Promise<Record<string, any>> {
  const details: Record<string, any> = {};
  for (let i = 0; i < recipeIds.length; i++) {
    const id = recipeIds[i];
    try {
      details[id] = await api(`/menu/v3/recipes/${id}?num_portions=${numPortions}`);
    } catch (err) {
      console.log(`  warning: failed to fetch ingredients for ${id}: ${(err as Error).message}`);
    }
    if ((i + 1) % 50 === 0 || i === recipeIds.length - 1) {
      console.log(`  fetched ingredient details for ${i + 1}/${recipeIds.length} recipes`);
    }
    if (i < recipeIds.length - 1) await sleep(INGREDIENT_FETCH_DELAY_MS);
  }
  return details;
}

// Compact the recipe data with the ingredient details
function compactRecipeWithIngredients(recipe: any, detail: any) {
  return {
    id: recipe.id,
    name: recipe.name,
    image: recipe.images?.[0]?.crops?.find((c: any) => c.width === 400)?.url,
    cuisine: detail?.cuisine?.name || recipe.food_brand?.name,
    description: detail?.description?.trim(),
    diet_type: detail?.diet_type?.name,
    dietary_claims: (recipe.dietary_claims || []).map((d: any) => d.name),
    allergens: (detail?.allergens || []).map((a: any) => a.name),
    prep_time_mins: recipe.prep_time,
    spice_level: recipe.spice_level?.name,
    rating: recipe.rating?.average,
    calories_per_portion: recipe.nutritional_information?.per_portion?.energy_kcal,
    protein_g_per_portion: recipe.nutritional_information?.per_portion
      ? Math.round(recipe.nutritional_information.per_portion.protein_mg / 1000)
      : undefined,
    ingredients: (detail?.ingredients || [])
      .filter((ing: any) => ing.quantities?.in_meal > 0)
      .map((ing: any) => ing.name),
  };
}

async function run(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const user = await api('/user/current');
  const userId = user.result.data.user.auth_user_id;
  console.log(`Authenticated as user ${user.result.data.user.email}`);

  const orders = await api('/user/current/orders?limit=30&sort_order=desc');
  const allOrders = orders.result.data;

  const compactOrders = allOrders.map(compactOrder);
  fs.writeFileSync(path.join(OUT_DIR, 'orders_recent.json'), JSON.stringify(compactOrders, null, 2));

  const pendingOrders = allOrders.filter((o: any) => o.state === 'pending');
  const pastOrders = compactOrders.filter((o: any) => o.state !== 'pending');
  console.log(`Saved ${compactOrders.length} recent orders (${pendingOrders.length} pending, ${pastOrders.length} past) to out/data/orders_recent.json`);

  const historicalChoices = pastOrders.map(({ deliveryDate, boxType, recipes }: any) => ({ deliveryDate, boxType, recipes }));
  fs.writeFileSync(path.join(OUT_DIR, 'historical_choices.json'), JSON.stringify(historicalChoices, null, 2));
  console.log(`Saved ${historicalChoices.length} past orders' recipe choices to out/data/historical_choices.json`);

  const nextOrder = pendingOrders.sort((a: any, b: any) => new Date(a.delivery_date).getTime() - new Date(b.delivery_date).getTime())[0];
  if (!nextOrder) {
    console.log('No pending order found — nothing awaiting recipe choices right now.');
  } else {
    const nextDeliveryDate = nextOrder.delivery_date.slice(0, 10); // "2026-10-05 00:00:00" -> "2026-10-05"
    const numPortions = process.env.NUM_PORTIONS || nextOrder.box?.num_portions || 2;
    console.log(`Next order awaiting choices: ${nextOrder.id}, delivery ${nextOrder.human_delivery_date}, portions: ${numPortions}`);

    const menu = await api(
      `/menu/v3/menus?include_core_recipe_id=true&include_core_menu_id=true&delivery_date=${nextDeliveryDate}` +
      `&num_portions=${numPortions}&option_types=none&option_types=recipes&option_types=ingredients&user_id=${userId}`
    );
    const recipes: any[] = Object.values(menu.recipes || {});
    console.log(`Found ${recipes.length} recipes. Fetching real ingredient names for each (throttled)...`);

    const details = await fetchIngredientDetails(recipes.map((r) => r.id), numPortions);
    const enriched = recipes.map((r) => compactRecipeWithIngredients(r, details[r.id]));

    fs.writeFileSync(path.join(OUT_DIR, `menu_${nextDeliveryDate}.json`), JSON.stringify(enriched, null, 2));
    console.log(`Saved ${enriched.length} recipes (with real ingredient names) to out/data/menu_${nextDeliveryDate}.json`);
  }

  const preferences = await api('/experience/choice/menu/v1/preferences');
  fs.writeFileSync(path.join(OUT_DIR, 'preferences.json'), JSON.stringify(preferences, null, 2));
  console.log('Saved dietary preferences to out/data/preferences.json');
}

export { run };

if (require.main === module) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
