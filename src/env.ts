import fs from 'fs';
import path from 'path';

const ENV_PATH = path.join(__dirname, '..', '.env');

// Upsert the environment variables in the .env file
function upsertEnv(updates: Record<string, string>): void {
  let lines: string[] = [];
  if (fs.existsSync(ENV_PATH)) {
    lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  }

  const seen = new Set<string>();
  lines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (match && Object.prototype.hasOwnProperty.call(updates, match[1])) {
      seen.add(match[1]);
      return `${match[1]}=${updates[match[1]]}`;
    }
    return line;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n');

  Object.assign(process.env, updates);
}

export { upsertEnv, ENV_PATH };
