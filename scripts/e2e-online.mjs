import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { Client } from "@heroiclabs/nakama-js";

const SITE_URL = process.env.TAG_SITE_URL || "https://doggiedasher177-maker.github.io/Tagg/";
const NAKAMA_URL = process.env.NAKAMA_URL || "https://nakama-production-2d60f8a9.up.railway.app";
const SERVER_KEY = process.env.NAKAMA_SERVER_KEY || "tagg-public-client-key-2026";
const timeout = 25000;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const makeName = () => "tq" + randomUUID().replace(/-/g, "").slice(0, 14).toLowerCase();

function makeClient() {
  const url = new URL(NAKAMA_URL);
  return new Client(SERVER_KEY, url.hostname, String(Number(url.port) || (url.protocol === "https:" ? 443 : 80)), url.protocol === "https:");
}

async function waitFor(page, fn, description, ms = timeout) {
  try { await page.waitForFunction(fn, null, { timeout: ms }); }
  catch { throw new Error("Timed out waiting for " + description + ". Last status: " + await page.locator("#onlineStatus").textContent().catch(() => "unavailable")); }
}

async function openOnline(browser, accelerateQueue = false) {
  const context = await browser.newContext();
  if (accelerateQueue) {
    await context.addInitScript(() => {
      const nativeNow = Performance.prototype.now.bind(performance);
      const origin = nativeNow();
      Object.defineProperty(performance, "now", { configurable: true, value: () => origin + (nativeNow() - origin) * 20 });
      const nativeInterval = window.setInterval.bind(window);
      window.setInterval = (fn, ms, ...args) => nativeInterval(fn, ms === 250 ? 25 : ms, ...args);
      const nativeTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...args) => nativeTimeout(fn, ms === 30000 ? 1500 : ms, ...args);
    });
  }
  const page = await context.newPage();
  await page.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator("#onlineSoonBtn").waitFor({ state: "visible", timeout });
  await page.locator("#onlineSoonBtn").click();
  await page.locator("#onlineName").waitFor({ state: "visible", timeout });
  await sleep(1000); // let the online module finish registering its handlers
  return { context, page };
}

async function connectWithName(page, name) {
  await page.locator("#onlineName").fill(name);
  await page.locator("#onlineConnectBtn").evaluate(el => el.click());
  await waitFor(page,
    () => document.querySelector("#onlineName")?.readOnly === true &&
      (document.querySelector("#onlineStatus")?.textContent || "").startsWith("Connected as "),
    "online account connection");
  const saved = await page.locator("#onlineName").inputValue();
  assert(saved === name, "The server changed the selected player name unexpectedly.");
}

async function readDeviceId(page) {
  return page.evaluate(() => localStorage.getItem("tagNakamaDevice"));
}

async function leaveMatch(page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("tag-online-leave")));
  await waitFor(page,
    () => (document.querySelector("#onlineStatus")?.textContent || "").includes("left the online match"),
    "match leave cleanup",
    10000);
}

const browser = await chromium.launch({ headless: true });
const contexts = [];
const accounts = [];
const results = [];
let primaryPage = null;

try {
  // 1. Public web client and Nakama health.
  const health = await fetch(NAKAMA_URL.replace(/\/$/, "") + "/healthcheck", { signal: AbortSignal.timeout(15000) });
  assert(health.ok, "Nakama healthcheck returned HTTP " + health.status);
  results.push("PASS: Nakama production healthcheck");

  const first = await openOnline(browser, true);
  const second = await openOnline(browser, false);
  contexts.push(first.context, second.context);
  primaryPage = first.page;

  const nameA = makeName();
  const nameB = makeName();

  // 2. First user claims a new username.
  await connectWithName(first.page, nameA);
  const deviceA = await readDeviceId(first.page);
  assert(deviceA, "The first test device ID was not saved.");
  accounts.push({ deviceId: deviceA, username: nameA });
  results.push("PASS: a player can claim an available username");

  // 3. A second device cannot register with that same username.
  await second.page.locator("#onlineName").fill(nameA);
  await second.page.locator("#onlineConnectBtn").evaluate(el => el.click());
  await waitFor(second.page,
    () => (document.querySelector("#onlineStatus")?.textContent || "").includes("already taken"),
    "duplicate username rejection");
  assert(await second.page.locator("#onlineName").inputValue() === "",
    "The rejected duplicate username remained selected as an authenticated identity.");
  results.push("PASS: duplicate username registration is rejected");

  // The second device can choose a different, available name.
  await connectWithName(second.page, nameB);
  const deviceB = await readDeviceId(second.page);
  assert(deviceB && deviceB !== deviceA, "The second device did not receive its own device identity.");
  accounts.push({ deviceId: deviceB, username: nameB });
  results.push("PASS: the second player can claim a different username");

  // 4. Existing accounts cannot rename themselves to another player's name.
  await first.page.locator("#backOnlineBtn").click();
  await first.page.locator("#profileBtn").click();
  await first.page.locator("#profileNameInput").waitFor({ state: "visible", timeout });
  await first.page.locator("#profileNameInput").fill(nameB);
  await first.page.locator("#saveProfileNameBtn").click();
  await waitFor(first.page,
    () => (document.querySelector("#onlineStatus")?.textContent || "").includes("already taken"),
    "duplicate username rename rejection");
  assert(await first.page.locator("#onlineName").inputValue() === nameA,
    "The current account username changed after a duplicate-name rejection.");
  results.push("PASS: duplicate username changes are rejected without changing the existing name");

  // 5. Private room creation returns a TAG code; another account joins with that code.
  await first.page.locator("#backProfileBtn").click();
  await first.page.locator("#onlineSoonBtn").click();
  await first.page.locator("#createRoomBtn").click();
  await waitFor(first.page,
    () => /^TAG-[A-Z2-9-]{26,}$/.test((document.querySelector("#roomCode")?.textContent || "").trim()),
    "shareable private room code");
  const roomCode = (await first.page.locator("#roomCode").textContent()).trim();
  assert(roomCode.startsWith("TAG-") && roomCode.length >= 30, "The private room code is malformed.");
  assert(!(await first.page.locator("#copyRoomCodeBtn").isDisabled()), "Copy room code was not enabled.");
  await second.page.locator("#joinRoomCode").fill(roomCode);
  await second.page.locator("#joinRoomBtn").click();
  await waitFor(second.page,
    () => (document.querySelector("#onlineStatus")?.textContent || "").includes("server-authoritative countdown"),
    "second player joining the private room");
  await waitFor(first.page,
    () => window.TAGOnlineHooks?.isOnline?.() === true,
    "private room starting for the host",
    12000);
  await waitFor(second.page,
    () => window.TAGOnlineHooks?.isOnline?.() === true,
    "private room starting for the joining player",
    12000);
  results.push("PASS: private room creation, share-code display, and second-player join");

  // Ensure the room entered the authoritative round and the displayed timer advances.
  await sleep(4200);
  const roomTimerBefore = (await first.page.locator("#timer").textContent()).trim();
  await sleep(1400);
  const roomTimerAfter = (await first.page.locator("#timer").textContent()).trim();
  assert(roomTimerBefore !== roomTimerAfter, "The private-room round timer did not advance.");
  results.push("PASS: private-room server timer advances during a live round");

  // 6. Leave the friend room and let the Quick Match fallback reach its accelerated
  // 30-second deadline (fake browser clock only; the production server remains real-time).
  await leaveMatch(second.page);
  await leaveMatch(first.page);
  await first.page.locator("#quickMatchBtn").click();
  await waitFor(first.page,
    () => (document.querySelector("#onlineStatus")?.textContent || "").includes("Bot opponent found"),
    "30-second Quick Match bot fallback",
    18000);
  await waitFor(first.page,
    () => window.TAGOnlineHooks?.isOnline?.() === true,
    "bot match becoming active",
    12000);
  await sleep(4200);
  const botTimerBefore = (await first.page.locator("#timer").textContent()).trim();
  await sleep(1400);
  const botTimerAfter = (await first.page.locator("#timer").textContent()).trim();
  assert(botTimerBefore !== botTimerAfter, "The bot-match round timer did not advance.");
  results.push("PASS: Quick Match timeout starts a bot match and its timer advances");

  console.log(JSON.stringify({ ok: true, results }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, results, error: String(error?.stack || error) }, null, 2));
  process.exitCode = 1;
} finally {
  for (const context of contexts) {
    try {
      const page = context.pages()[0];
      if (page) await page.evaluate(() => document.querySelector("#onlineDisconnectBtn")?.click());
    } catch {}
  }
  // Delete only the throwaway accounts created by this run.
  for (const account of accounts) {
    try {
      const cleanupClient = makeClient();
      const session = await cleanupClient.authenticateDevice(account.deviceId, false);
      await cleanupClient.deleteAccount(session);
    } catch (error) {
      console.warn("Could not delete temporary test account " + account.username + ": " + String(error?.message || error));
    }
  }
  for (const context of contexts) {
    try { await context.close(); } catch {}
  }
  await browser.close();
}
