import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { Client } from "@heroiclabs/nakama-js";

const SITE_URL = process.env.TAG_SITE_URL || "https://doggiedasher177-maker.github.io/Tagg/";
const NAKAMA_URL = process.env.NAKAMA_URL || "https://nakama-production-2d60f8a9.up.railway.app";
const SERVER_KEY = process.env.NAKAMA_SERVER_KEY || "tagg-public-client-key-2026";
const timeout = 25000;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForPublishedClient() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(SITE_URL, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (response.ok) {
        const html = await response.text();
        if (html.includes("const setButtons=on=>{[") && html.includes("async function responseErrorMessage(error){") && html.includes("nextSocket.rpc('tag_online_presence','{}')") && html.includes("oldSocket.rpc('tag_online_leave','{}')") && html.includes("getBotPlayers(){return botPlayers.slice(0,activePlayerCount);}") && html.includes("getMatchId(){return onlineMatchId;}") && html.includes("startLocalBotMatch(info)") && html.includes('id="avatarsScreen"')) return;
      }
    } catch {}
    await sleep(2500);
  }
  throw new Error("GitHub Pages did not publish the online module initialization fix within 120 seconds.");
}
const makeName = () => "tq" + randomUUID().replace(/-/g, "").slice(0, 14).toLowerCase();

function makeClient() {
  const url = new URL(NAKAMA_URL);
  return new Client(SERVER_KEY, url.hostname, String(Number(url.port) || (url.protocol === "https:" ? 443 : 80)), url.protocol === "https:");
}

async function waitFor(page, fn, description, ms = timeout) {
  try { await page.waitForFunction(fn, null, { timeout: ms }); }
  catch {
    const status = await page.locator("#onlineStatus").textContent().catch(() => "unavailable");
    const diagnostics = page.__e2eDiagnostics || [];
    const button = await page.locator("#onlineConnectBtn").evaluate(el => ({ hidden: el.hidden, exists: !!el, disabled: el.disabled })).catch(() => null);
    throw new Error("Timed out waiting for " + description + ". Last status: " + status + ". Button: " + JSON.stringify(button) + ". Browser diagnostics: " + diagnostics.slice(-20).join(" | "));
  }
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
  page.__e2eDiagnostics = [];
  page.on("console", message => { if (message.type() === "error") page.__e2eDiagnostics.push("console: " + message.text()); });
  page.on("pageerror", error => page.__e2eDiagnostics.push("pageerror: " + String(error?.stack || error)));
  page.on("requestfailed", request => page.__e2eDiagnostics.push("requestfailed: " + request.url() + " · " + request.failure()?.errorText));
  await page.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator("#onlineSoonBtn").waitFor({ state: "visible", timeout });
  await page.locator("#onlineSoonBtn").click();
  await page.locator("#onlineName").waitFor({ state: "visible", timeout });
  await sleep(2500); // let the online module and its Nakama SDK import finish loading
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
  await waitFor(page,
    () => /^\d+$/.test((document.querySelector("#onlinePlayerCount")?.textContent || "").trim()),
    "session-bound online presence registration");
}

async function readDeviceId(page) {
  return page.evaluate(() => localStorage.getItem("tagNakamaDevice"));
}

async function leaveMatch(page) {
  const wasLocalBot = await page.evaluate(() => {
    if (window.TAGOnlineHooks?.isLocalBotMatch?.()) {
      window.TAGOnlineHooks?.leaveLocalBotMatch?.();
      return true;
    }
    window.dispatchEvent(new CustomEvent("tag-online-leave"));
    return false;
  });
  if (!wasLocalBot) {
    await waitFor(page,
      () => (document.querySelector("#onlineStatus")?.textContent || "").includes("left the online match"),
      "match leave cleanup",
      10000);
  }
  await page.evaluate(() => window.TAGAppScreens?.show("online"));
  await page.locator("#quickMatchBtn").waitFor({ state: "visible", timeout: 10000 });
}

await waitForPublishedClient();

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

  // The title-menu cosmetic buttons must navigate to inert Coming Soon pages.
  await first.page.evaluate(() => window.TAGAppScreens?.show("menu"));
  await first.page.locator("#itemShopBtn").click();
  assert(await first.page.locator("#itemShopScreen").evaluate(el => el.classList.contains("show")),
    "Item Shop did not open its Coming Soon screen.");
  assert((await first.page.locator("#itemShopScreen").innerText()).includes("ITEMS COMING SOON"),
    "Item Shop did not display its Coming Soon message.");
  await first.page.locator("#backItemShopBtn").click();
  await first.page.locator("#avatarsBtn").click();
  assert(await first.page.locator("#avatarsScreen").evaluate(el => el.classList.contains("show")),
    "Avatars / Skins did not open its Coming Soon screen.");
  assert((await first.page.locator("#avatarsScreen").innerText()).includes("AVATARS / SKINS COMING SOON"),
    "Avatars / Skins did not display its Coming Soon message.");
  await first.page.locator("#backAvatarsBtn").click();
  await first.page.evaluate(() => window.TAGAppScreens?.show("online"));
  await first.page.locator("#onlineName").waitFor({ state: "visible", timeout });
  results.push("PASS: Item Shop and Avatars open Coming Soon pages with working back buttons");

  // V15: every built-in arena must retain distinct, non-overlapping platform layouts.
  const arenaLayouts = await first.page.evaluate(() => window.TAGOnlineHooks?.getMapLayoutDiagnostics?.() || []);
  assert(arenaLayouts.length >= 17, "V15 arena diagnostics did not include all built-in maps.");
  const crowdedLayouts = arenaLayouts.filter(layout => layout.overlaps !== 0 || layout.placed < 12);
  assert(crowdedLayouts.length === 0,
    "V15 arena platforms still overlap or were excessively dropped: " + JSON.stringify(crowdedLayouts));
  const uniqueLayouts = new Set(arenaLayouts.map(layout => JSON.stringify(layout.signature)));
  assert(uniqueLayouts.size >= 15, "V15 arenas do not have sufficiently distinct platform placements.");
  results.push("PASS: V15 built-in realms have non-overlapping, distinct platform layouts");

  // V15: let the native hard bot play for a few seconds and verify it traverses the arena.
  await first.page.evaluate(() => window.TAGOnlineHooks?.startLocalBotMatch?.({
    playerName: "QA HUMAN", mapId: "forge", gameMode: "classic",
    roundLength: 180, modifiers: [], botLevel: "hard"
  }));
  await waitFor(first.page,
    () => window.TAGOnlineHooks?.isLocalBotMatch?.() === true &&
      window.TAGOnlineHooks?.getPlayerStates?.()?.some(player => player.isBot),
    "V15 local bot arena startup");
  await sleep(3800);
  const botStart = await first.page.evaluate(() =>
    window.TAGOnlineHooks?.getPlayerStates?.()?.find(player => player.isBot) || null);
  await sleep(2200);
  const botEnd = await first.page.evaluate(() =>
    window.TAGOnlineHooks?.getPlayerStates?.()?.find(player => player.isBot) || null);
  assert(botStart && botEnd && Math.hypot(botEnd.x - botStart.x, botEnd.y - botStart.y) > 0.012,
    "V15 hard bot did not traverse the arena during active play. Start=" + JSON.stringify(botStart) + " End=" + JSON.stringify(botEnd));
  assert(botEnd.y > 0.10 && botEnd.y < 0.96,
    "V15 hard bot moved outside the playable arena.");
  await first.page.evaluate(() => window.TAGOnlineHooks?.leaveLocalBotMatch?.());
  await first.page.evaluate(() => window.TAGAppScreens?.show("online"));
  results.push("PASS: V15 hard bot uses active platform navigation and moves across the arena");

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
  await waitFor(first.page,
    () => window.TAGOnlineHooks?.isOnline?.() === true,
    "private room starting for the host",
    12000);
  await waitFor(second.page,
    () => window.TAGOnlineHooks?.isOnline?.() === true,
    "private room starting for the joining player",
    12000);
  const hostMatchId = await first.page.evaluate(() => window.TAGOnlineHooks?.getMatchId?.());
  const guestMatchId = await second.page.evaluate(() => window.TAGOnlineHooks?.getMatchId?.());
  assert(hostMatchId && guestMatchId === hostMatchId,
    "The host and joining player did not enter the same authoritative private room.");
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
  // Use a distinctive ruleset so another simultaneous test or normal player is
  // unlikely to match this Quick Match before the 30-second bot fallback.
  await first.page.evaluate(() => {
    document.querySelector("#onlineMap").value = "heaven";
    document.querySelector("#onlineMode").value = "infection";
    document.querySelector("#onlineLength").value = "180";
    document.querySelector("#onlineModifier1").value = "none";
    document.querySelector("#onlineModifier2").value = "none";
    document.querySelector("#onlineModifier3").value = "none";
  });
  await first.page.locator("#quickMatchBtn").click();
  await waitFor(first.page,
    () => window.TAGOnlineHooks?.isLocalBotMatch?.() === true &&
      window.TAGOnlineHooks?.isOnline?.() === false &&
      Array.isArray(window.TAGOnlineHooks?.getBotPlayers?.()) &&
      window.TAGOnlineHooks.getBotPlayers().some(Boolean),
    "30-second Quick Match local bot fallback",
    18000);
  assert(await first.page.evaluate(() => window.TAGOnlineHooks?.getMatchId?.() === null),
    "A local fallback bot unexpectedly created a ranked server match.");
  await waitFor(first.page,
    () => {
      const bot = window.TAGOnlineHooks?.getPlayerStates?.()?.find(player => player.isBot);
      return !!bot && Number.isFinite(bot.y) && bot.y > 0.18 && bot.y < 0.96;
    },
    "the local bot to appear inside the arena rather than above the ceiling",
    12000);
  await sleep(4200);
  const botTimerBefore = (await first.page.locator("#timer").textContent()).trim();
  await sleep(1400);
  const botTimerAfter = (await first.page.locator("#timer").textContent()).trim();
  assert(botTimerBefore !== botTimerAfter, "The local bot-match round timer did not advance.");
  assert(await first.page.evaluate(() => window.TAGOnlineHooks?.isLocalBotMatch?.() === true && window.TAGOnlineHooks?.isOnline?.() === false),
    "The fallback bot was not simulated locally.");
  results.push("PASS: Quick Match timeout starts a local-physics bot match with no ranked server match");


  // 7. A published community map is searchable and starts with three replaceable bots.
  await leaveMatch(first.page);
  const mapName = "QA Community Arena " + randomUUID().slice(0, 8);
  const mapClientA = makeClient();
  const mapClientB = makeClient();
  const mapSessionA = await mapClientA.authenticateDevice(deviceA, false, nameA);
  const mapSessionB = await mapClientB.authenticateDevice(deviceB, false, nameB);
  const mapSocketA = mapClientA.createSocket(true, false);
  const mapSocketB = mapClientB.createSocket(true, false);
  let mapStateA = null;
  let mapStateB = null;
  const decodeState = message => {
    if ((message.opCode ?? message.op_code) !== 11) return null;
    const raw = message.data ?? message.state;
    if (raw == null) return null;
    const payload = raw instanceof Uint8Array ? new TextDecoder().decode(raw) :
      (typeof raw === "string" ? raw : JSON.stringify(raw));
    try { return JSON.parse(payload); } catch { return null; }
  };
  const rpcJson = response => {
    const raw = response?.payload ?? response;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  };
  const callRpc = async (client, auth, id, payload) => {
    try { return rpcJson(await client.rpc(auth, id, payload)); }
    catch (error) {
      if (typeof error?.clone === "function") {
        const body = await error.clone().text().catch(() => "unreadable response body");
        throw new Error("RPC " + id + " failed with HTTP " + error.status + ": " + body);
      }
      throw new Error("RPC " + id + " failed: " + String(error?.stack || error));
    }
  };
  const waitForMapState = async (getter, predicate, description, ms = 18000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const value = getter();
      if (value && predicate(value)) return value;
      await sleep(150);
    }
    throw new Error("Timed out waiting for " + description + ". Last state: " + JSON.stringify(getter()));
  };
  try {
    await mapSocketA.connect(mapSessionA, true);
    await mapSocketB.connect(mapSessionB, true);

    const eloA = await callRpc(mapClientA, mapSessionA, "tag_ensure_elo", {});
    const eloB = await callRpc(mapClientB, mapSessionB, "tag_ensure_elo", {});
    assert(Number(eloA.elo) === 100 && Number(eloB.elo) === 100,
      "New online accounts did not initialize at 100 ELO. A=" + JSON.stringify(eloA) + " B=" + JSON.stringify(eloB) + ".");

    const level = {
      id: "qa_" + randomUUID().replace(/-/g, "").slice(0, 18),
      name: mapName,
      description: "Temporary automated test arena.",
      modifiers: [],
      objects: [
        { type: "platform", x: 80, y: 570, w: 230, h: 16 },
        { type: "platform", x: 430, y: 460, w: 190, h: 16 },
        { type: "platform", x: 790, y: 555, w: 240, h: 16 },
        { type: "pad", x: 560, y: 420, w: 52, h: 11 },
        { type: "orb", x: 600, y: 320, r: 12, forceX: 0, forceY: -610 }
      ]
    };
    const published = await callRpc(mapClientA, mapSessionA, "tag_publish_map", { level });
    assert(published.ok && published.key && published.owner_id,
      "The server did not publish the community map.");
    const listing = await callRpc(mapClientB, mapSessionB, "tag_list_public_maps", { query: mapName });
    assert((listing.maps || []).some(item => item.key === published.key),
      "The published community map could not be found by search.");

    const started = await callRpc(mapClientA, mapSessionA, "tag_start_public_map_match",
      { key: published.key, owner_id: published.owner_id });
    assert(started.match_id, "The server did not create or locate a public map match.");
    mapSocketA.onmatchdata = message => { const state = decodeState(message); if (state) mapStateA = state; };
    mapSocketB.onmatchdata = message => { const state = decodeState(message); if (state) mapStateB = state; };
    const joinedA = await mapSocketA.joinMatch(started.match_id);
    const matchId = joinedA.match_id || started.match_id;
    const firstMapState = await waitForMapState(() => mapStateA,
      state => Array.isArray(state.players) && state.players.length === 4,
      "a public map match with one human and three bots");
    assert(firstMapState.players.filter(player => player.is_bot).length === 3,
      "A new public map match did not fill all three open slots with bots.");
    assert(firstMapState.players.filter(player => player.is_bot).every(player => Math.abs(Number(player.y) - 0.82) < 0.025),
      "A server arena bot did not spawn on the ground line.");
    await mapSocketB.joinMatch(matchId);
    const replacementState = await waitForMapState(() => mapStateA,
      state => Array.isArray(state.players) && state.players.some(player => player.user_id === mapSessionB.user_id),
      "a second human replacing a bot");
    assert(replacementState.players.length === 4 &&
      replacementState.players.filter(player => player.is_bot).length === 2,
      "The joining human did not replace exactly one bot slot.");
    await waitForMapState(() => mapStateA, state => state.status === "playing",
      "public map match countdown to complete");
    const bSlotBeforeQuit = mapStateA.players.findIndex(player => player.user_id === mapSessionB.user_id);
    const scoreBeforeEarlyQuit = Number(mapStateA.scores?.[bSlotBeforeQuit] || 0);
    await mapSocketA.leaveMatch(matchId);
    const quitResult = await waitForMapState(() => mapStateB,
      state => state.status === "result",
      "the remaining human winning after the opponent quits");
    assert(quitResult.winner_user_id === mapSessionB.user_id,
      "The remaining human did not receive the win after the opponent disconnected.");
    const bSlotAfterQuit = quitResult.players.findIndex(player => player.user_id === mapSessionB.user_id);
    const scoreAfterEarlyQuit = Number(quitResult.scores?.[bSlotAfterQuit] || 0);
    assert(scoreAfterEarlyQuit - scoreBeforeEarlyQuit < 100,
      "An opponent who quit with more than 30 seconds remaining incorrectly granted the disconnect score bonus.");
    await sleep(700);
    const finalEloA = await mapClientA.listLeaderboardRecords(mapSessionA, "tag_online_elo_v1", [mapSessionA.user_id], 1, null, null);
    const finalEloB = await mapClientB.listLeaderboardRecords(mapSessionB, "tag_online_elo_v1", [mapSessionB.user_id], 1, null, null);
    const tagpointsB = await mapClientB.listLeaderboardRecords(mapSessionB, "tag_online_tagpoints_v1", [mapSessionB.user_id], 1, null, null);
    const earlyEloA = Number(finalEloA.owner_records?.[0]?.score ?? 100);
    const earlyEloB = Number(finalEloB.owner_records?.[0]?.score ?? 100);
    const earlyPointsB = Number(tagpointsB.owner_records?.[0]?.score ?? 0);
    assert(earlyEloA === 100 && earlyEloB === 100 && earlyPointsB === 0,
      "Early-quit progression was incorrect: ELO A=" + earlyEloA + ", ELO B=" + earlyEloB + ", Tagpoints B=" + earlyPointsB + ".");
    results.push("PASS: public map publishing, search, three-bot fill, and human bot-slot replacement");
    results.push("PASS: opponent quit awards the remaining player the win without ELO or Tagpoints when more than 30 seconds remain");
    await mapSocketB.leaveMatch(matchId).catch(() => {});

    // A second, short arena round proves the final-30-second rewards and exact ELO deltas.
    mapStateA = null;
    mapStateB = null;
    const lateStart = await callRpc(mapClientA, mapSessionA, "tag_start_public_map_match",
      { key: published.key, owner_id: published.owner_id, length: 32 });
    assert(lateStart.match_id, "The server did not create the short public map match.");
    await mapSocketA.joinMatch(lateStart.match_id);
    await waitForMapState(() => mapStateA,
      state => Array.isArray(state.players) && state.players.length === 4,
      "the short public map match with three bots");
    await mapSocketB.joinMatch(lateStart.match_id);
    await waitForMapState(() => mapStateA,
      state => Array.isArray(state.players) && state.players.some(player => player.user_id === mapSessionB.user_id),
      "the second human joining the short public map match");
    await waitForMapState(() => mapStateA, state => state.status === "playing",
      "the short public map match to start");
    await waitForMapState(() => mapStateA,
      state => state.status === "playing" && Number(state.remaining) <= 30,
      "the final 30 seconds of the short public map match");
    const bSlotBeforeLateQuit = mapStateA.players.findIndex(player => player.user_id === mapSessionB.user_id);
    const scoreBeforeLateQuit = Number(mapStateA.scores?.[bSlotBeforeLateQuit] || 0);
    await mapSocketA.leaveMatch(lateStart.match_id);
    const lateQuitResult = await waitForMapState(() => mapStateB,
      state => state.status === "result",
      "the remaining human winning after a final-30-second quit");
    assert(lateQuitResult.winner_user_id === mapSessionB.user_id,
      "The remaining human did not win after a final-30-second quit.");
    const bSlotAfterLateQuit = lateQuitResult.players.findIndex(player => player.user_id === mapSessionB.user_id);
    const scoreAfterLateQuit = Number(lateQuitResult.scores?.[bSlotAfterLateQuit] || 0);
    assert(scoreAfterLateQuit - scoreBeforeLateQuit >= 100,
      "A quit in the final 30 seconds did not award the 100-point round bonus.");
    await sleep(700);
    const lateEloA = await mapClientA.listLeaderboardRecords(mapSessionA, "tag_online_elo_v1", [mapSessionA.user_id], 1, null, null);
    const lateEloB = await mapClientB.listLeaderboardRecords(mapSessionB, "tag_online_elo_v1", [mapSessionB.user_id], 1, null, null);
    const lateTagpointsB = await mapClientB.listLeaderboardRecords(mapSessionB, "tag_online_tagpoints_v1", [mapSessionB.user_id], 1, null, null);
    const lateScoreA = Number(lateEloA.owner_records?.[0]?.score ?? 100);
    const lateScoreB = Number(lateEloB.owner_records?.[0]?.score ?? 100);
    const latePointsB = Number(lateTagpointsB.owner_records?.[0]?.score ?? 0);
    assert(lateScoreA === 95 && lateScoreB === 110 && latePointsB === 1,
      "Final-30-second quit progression was incorrect: A=" + lateScoreA + ", B=" + lateScoreB + ", Tagpoints=" + latePointsB + ".");
    results.push("PASS: final-30-second quit awards 100 round points, +10 winner ELO, -5 quitter ELO, and +1 Tagpoint");
    await mapSocketB.leaveMatch(lateStart.match_id).catch(() => {});
    await callRpc(mapClientA, mapSessionA, "tag_unpublish_map", { key: published.key }).catch(() => {});
  } finally {
    try { mapSocketA.disconnect(false); } catch {}
    try { mapSocketB.disconnect(false); } catch {}
  }

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
