import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import type { IWebDriverOptionsCookie } from 'selenium-webdriver';
import { Options as ChromeOptions } from 'selenium-webdriver/chrome';
import { upsertEnv } from './env';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

const OUT_DIR = path.join(__dirname, '..', 'out');
const STATE_PATH = path.join(OUT_DIR, 'storageState.json');
const DEBUG_DIR = path.join(OUT_DIR, 'debug');
const BASE_URL = 'https://www.gousto.co.uk';

// Dump the screenshot and page source at key points
async function dumpDebugArtifacts(driver: WebDriver, label: string): Promise<void> {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(DEBUG_DIR, `${stamp}-${label}`);
    const screenshot = await driver.takeScreenshot();
    fs.writeFileSync(`${base}.png`, screenshot, 'base64');
    const html = await driver.getPageSource();
    fs.writeFileSync(`${base}.html`, html);
    console.log(`  [debug] saved ${base}.png / .html`);
  } catch (err) {
    console.log(`  [debug] failed to capture artifacts for "${label}": ${(err as Error).message}`);
  }
}

// Dismiss the cookie banner
async function dismissCookieBanner(driver: WebDriver): Promise<void> {
  try {
    const button = await driver.wait(until.elementLocated(By.css('#c-p-bn, #s-all-bn')), 4000);
    await button.click();
    console.log('Dismissed the cookie-consent banner.');
    await sleep(500);
  } catch {
    console.log('No cookie-consent banner found.');
  }
}

// Gousto's client-side auth redirect appends `?target=<url-encoded target URL>` when it thinks the session needs re-authenticating.
async function escapeTargetRedirectLoop(driver: WebDriver, cleanUrl: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const currentUrl = await driver.getCurrentUrl().catch(() => '');
    if (!currentUrl.includes('target=')) return;
    console.log('Detected a target= redirect loop — navigating back to the clean URL.');
    await driver.get(cleanUrl);
    await sleep(500);
  }
}

function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry the login step with fresh element lookups to avoid stale handles
async function withRetries<T>(fn: () => Promise<T>, attempts = 3, delayMs = 1000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(delayMs);
    }
  }
  throw lastErr;
}

async function cookieHeader(driver: WebDriver): Promise<string> {
  const cookies = await driver.manage().getCookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

// Check if the user is logged in
async function isLoggedIn(driver: WebDriver): Promise<boolean> {
  const res = await fetch('https://production-api.gousto.co.uk/user/current', {
    headers: { Cookie: await cookieHeader(driver) },
  }).catch(() => null);
  return !!res && res.ok;
}

// Load the saved cookies or the leftover Playwright storageState.json
function loadSavedCookies(statePath: string): IWebDriverOptionsCookie[] {
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const rawCookies: any[] = Array.isArray(parsed) ? parsed : parsed.cookies || [];
  return rawCookies.map((c) => ({
    ...c,
    expiry: typeof c.expiry === 'number' ? c.expiry : (typeof c.expires === 'number' && c.expires > 0 ? c.expires : undefined),
  }));
}

async function restoreCookies(driver: WebDriver, cookies: IWebDriverOptionsCookie[]): Promise<void> {
  for (const cookie of cookies) {
    try {
      await driver.manage().addCookie({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expiry: typeof cookie.expiry === 'number' ? cookie.expiry : undefined,
        secure: cookie.secure,
      });
    } catch (err) {
      console.log(`Failed to add cookie ${cookie.name} (${(err as Error).message}) — skipping.`);
    }
  }
}

async function run(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const hasState = fs.existsSync(STATE_PATH);
  const chromeOptions = new ChromeOptions()
    .excludeSwitches('enable-automation')
    .addArguments('--disable-blink-features=AutomationControlled');
  const driver = await new Builder().forBrowser('chrome').setChromeOptions(chromeOptions as any).build();

  try {
    // If the access token is expired, skip restoring the session and start a new one
    const tokenExpiresAt = process.env.GOUSTO_TOKEN_EXPIRES_AT;
    const tokenExpired = !!tokenExpiresAt && new Date(tokenExpiresAt).getTime() <= Date.now();
    const restoreSession = hasState && !tokenExpired;

    console.log(restoreSession ? 'Restoring previous session...' : 'No usable previous session found.');
    if (hasState && tokenExpired) {
      console.log(`Saved access token expired at ${tokenExpiresAt} — starting a fresh session instead of restoring it.`);
    }

    if (restoreSession) {
      // Cookies can only be added once a page on the matching domain is loaded.
      await driver.get(BASE_URL);
      const savedCookies = loadSavedCookies(STATE_PATH);
      await restoreCookies(driver, savedCookies);
    }

    await driver.get(`${BASE_URL}/menu`);
    await escapeTargetRedirectLoop(driver, `${BASE_URL}/menu`);
    await dismissCookieBanner(driver);
    await dumpDebugArtifacts(driver, 'landed-on-menu');

    let loggedIn = await isLoggedIn(driver);
    console.log(`Session valid: ${loggedIn}`);

    if (!loggedIn) {
      const email = process.env.GOUSTO_EMAIL;
      const password = process.env.GOUSTO_PASSWORD;

      // "Login" is a button on the menu page that opens the login form in place. Re-locate the button fresh on every attempt
      try {
        await withRetries(async () => {
          await dismissCookieBanner(driver);
          const button = await driver.wait(until.elementLocated(By.css('[data-testing="loginButton"]')), 10000);
          await driver.wait(until.elementIsVisible(button), 5000);
          await button.click();
        });
      } catch (err) {
        console.log(`Couldn't find/click the Login button (${(err as Error).message}) — continuing in case a login form is already showing.`);
        await dumpDebugArtifacts(driver, 'login-button-failed');
      }

      if (email && password) {
        try {
          await withRetries(async () => {
            const emailInput = await driver.wait(
              until.elementLocated(By.css('input[type="email"], input[name="email"]')),
              10000
            );
            await driver.wait(until.elementIsVisible(emailInput), 5000);
            const passwordInput = await driver.findElement(By.css('input[type="password"], input[name="password"]'));
            await emailInput.clear();
            await emailInput.sendKeys(email);
            await passwordInput.clear();
            await passwordInput.sendKeys(password);
            await driver.findElement(By.css('button[type="submit"]')).click();
          });
        } catch (err) {
          console.log(`Auto-fill failed (${(err as Error).message}) — fill in the form manually.`);
          await dumpDebugArtifacts(driver, 'autofill-failed');
        }
      } else {
        console.log('No GOUSTO_EMAIL/GOUSTO_PASSWORD in .env — please log in manually.');
      }

      await dumpDebugArtifacts(driver, 'before-manual-login');
      await waitForEnter(
        '\nComplete login in the browser window (including any CAPTCHA), then press Enter here...\n'
      );

      loggedIn = await isLoggedIn(driver);
      if (!loggedIn) {
        console.error('Still not logged in — aborting without saving state.');
        await driver.quit();
        process.exit(1);
      }
    }

    // Decode the cookie values from URL-encoded JSON to a plain string
    function decodeCookieJson(cookie: IWebDriverOptionsCookie | undefined, field: string): string {
      if (!cookie) return '';
      try {
        return JSON.parse(decodeURIComponent(cookie.value))[field] || '';
      } catch {
        return cookie.value; // fall back to the raw value if it wasn't JSON after all
      }
    }

    const cookies = await driver.manage().getCookies();
    const accessToken = decodeCookieJson(cookies.find((c) => c.name === 'v1_oauth_token'), 'access_token');
    const refreshToken = decodeCookieJson(cookies.find((c) => c.name === 'v1_oauth_refresh'), 'refresh_token');
    const expiresAt = decodeCookieJson(cookies.find((c) => c.name === 'v1_oauth_expiry'), 'expires_at');

    if (accessToken) {
      upsertEnv({
        GOUSTO_ACCESS_TOKEN: accessToken,
        GOUSTO_REFRESH_TOKEN: refreshToken,
        GOUSTO_TOKEN_EXPIRES_AT: expiresAt,
      });
      console.log(`Saved GOUSTO_ACCESS_TOKEN to .env (expires ${expiresAt || 'unknown'})`);
    } else {
      console.log('Warning: no v1_oauth_token cookie found after login — .env not updated.');
    }

    fs.writeFileSync(STATE_PATH, JSON.stringify(cookies, null, 2));
    console.log(`Saved full session state to ${STATE_PATH}`);
  } finally {
    await driver.quit();
  }
}

export { run };

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
