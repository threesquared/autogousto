import path from 'path';
import express from 'express';
import * as fetchWeekly from './fetchWeekly';
import * as recommend from './recommend';

const PORT = Number(process.env.PORT) || 3000;
const NUM_VARIATIONS = 3;
const VARIATION_TEMPERATURE = 1.1;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/api/run', async (_req, res) => {
  try {
    console.log('Fetching this week\'s menu + order history...');
    await fetchWeekly.run();

    console.log(`Generating ${NUM_VARIATIONS} recommendation variations...`);
    const result = await recommend.generateVariations(NUM_VARIATIONS, VARIATION_TEMPERATURE);

    res.json(result);
  } catch (err) {
    const message = (err as Error).message || String(err);
    console.error(message);
    const expired = /GOUSTO_ACCESS_TOKEN not set|401|Valid Token Required/i.test(message);
    res.status(500).json({
      error: expired
        ? `${message} — your Gousto session has likely expired. Run \`npm run login\` and try again.`
        : message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Gousto web UI running at http://localhost:${PORT}`);
});
