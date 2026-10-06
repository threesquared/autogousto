#!/usr/bin/env -S npx tsx
import * as login from '../src/login';
import * as fetchWeekly from '../src/fetchWeekly';
import * as recommend from '../src/recommend';

const COMMANDS: Record<string, () => Promise<void>> = {
  async login() {
    await login.run();
  },
  async fetch() {
    await fetchWeekly.run();
  },
  async recommend() {
    await recommend.run();
  },
  async run() {
    await login.run();
    await fetchWeekly.run();
    await recommend.run();
  },
};

function printHelp(): void {
  console.log(`Usage: gousto <command>

Commands:
  login       Log into Gousto (reuses saved session if still valid) and store an access token
  fetch       Fetch this week's menu + order history using the stored token
  recommend   Ask OpenRouter to pick recipes and write a preview email
  run         Do all of the above in sequence (the full weekly pipeline)
`);
}

async function main(): Promise<void> {
  const [, , cmd] = process.argv;
  if (!cmd || !COMMANDS[cmd]) {
    printHelp();
    process.exit(cmd ? 1 : 0);
  }
  await COMMANDS[cmd]();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
