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
        if (html.includes("const setButtons=on=>{[") && html.includes("async function responseErrorMessage(error){") && html.includes("nextSocket.rpc('tag_online_presence','{}')") && html.includes("oldSocket.rpc('tag_online_leave','{}')") && html.includes("getBotPlayers(){return botPlayers.slice(0,activePlayerCount);}") && html.includes("getMatchId(){return onlineMatchId;}") && html.includes("startLocalBotMatch(info)") && html.includes('id="avatarsScreen"') && html.includes("function resolvePlatformPlacements") && html.includes("function botRoute") && html.includes("getMapLayoutDiagnostics()") &&
          html.includes("V15 · SMART BOTS & ARENA ARCHITECTURE") &&
          html.includes("V17 · SOLID STRUCTURES & IN-MATCH FRIENDS") &&
          html.includes("V16 · MOBILE PLAY, SOLID ARENAS & FRIEND MAILBOX") &&
          html.includes("TAG! — Zyron Studios V20 · Cosmic Menu") && html.includes("V20 · COSMIC MENUS & CHARACTER DESIGN") && html.includes("V20_COSMIC_MENU_THEME") && html.includes("19.5V · COUNTDOWN & RELEASE POLISH") && html.includes("V19 · THE LIVING LEGENDS UPDATE") && html.includes("function v19DrawV1") && html.includes("previousBottom<q.y-2") && html.includes("v19KillerDifficulty") && html.includes("tagV19DetailMode") && html.includes("GLITCHY LANDSCAPES") &&
          html.includes("function customPlatformGeometry") &&
          html.includes("getStructureStates(){return platforms.filter(p=>p.kind==='structure')") &&
          html.includes('id="matchMailboxRefreshBtn"') &&
          html.includes('id="mobilePauseBtn"') &&
          html.includes("if(!mobile||mode!=='playing')") &&
          html.includes("getOnlinePlayers(){return Array.from({length:activePlayerCount}") &&
          html.includes("async function refreshMatchFriendTargets()") &&
          html.includes("async function refreshMatchMailbox()") &&
          html.includes('id="matchMailbox"')) return;
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
    const game = await page.evaluate(() => window.TAGOnlineHooks?.getBotDebug?.() || null).catch(() => null);
    throw new Error("Timed out waiting for " + description + ". Last status: " + status + ". Button: " + JSON.stringify(button) + ". Game: " + JSON.stringify(game) + ". Browser diagnostics: " + diagnostics.slice(-20).join(" | "));
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
  // V20_MENU_VIEWPORT_REGRESSION: exercise the actual title menu at the screenshot
  // size, a short laptop viewport, and a phone; this is layout-only QA.
  for (const viewport of [
    { name: "1620x913 screenshot", width: 1620, height: 913, fitHeight: true },
    { name: "1366x600 short laptop", width: 1366, height: 600, fitHeight: true },
    { name: "390x844 phone", width: 390, height: 844, fitHeight: false }
  ]) {
    const menuContext = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1
    });
    const menuPage = await menuContext.newPage();
    await menuPage.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await menuPage.evaluate(() => document.fonts?.ready);
    await menuPage.waitForFunction(() => {
      const screen = document.querySelector("#menuScreen.screen.show");
      const hero = screen?.querySelector(".menu-shell .hero");
      return !!screen && !!hero && getComputedStyle(screen).display !== "none" &&
        hero.getBoundingClientRect().width > 0;
    }, null, { timeout: 15000 });
    const layout = await menuPage.evaluate(() => {
      const screen = document.querySelector("#menuScreen");
      const hero = screen.querySelector(".menu-shell .hero");
      const rect = hero.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        screen: {
          width: screen.clientWidth, height: screen.clientHeight,
          scrollWidth: screen.scrollWidth, scrollHeight: screen.scrollHeight
        },
        hero: { top: rect.top, bottom: rect.bottom, height: rect.height },
        scrollableVertically: screen.scrollHeight > screen.clientHeight + 1
      };
    });
    assert(layout.documentWidth <= viewport.width + 1 &&
      layout.bodyWidth <= viewport.width + 1 &&
      layout.screen.scrollWidth <= viewport.width + 1 &&
      layout.hero.top >= -1,
      "V20 menu has horizontal overflow or clips its top at " + viewport.name + ": " + JSON.stringify(layout));
    if (viewport.fitHeight) {
      assert(layout.hero.bottom <= viewport.height + 1,
        "V20 menu does not fit vertically at " + viewport.name + ": " + JSON.stringify(layout));
    } else if (layout.hero.bottom > viewport.height + 1) {
      assert(layout.scrollableVertically,
        "V20 phone menu extends below the viewport without allowing vertical scrolling: " + JSON.stringify(layout));
    }
    results.push("PASS: V20 title menu fits " + viewport.name +
      (viewport.fitHeight ? " without clipping" : " without horizontal overflow or inaccessible content"));
    await menuContext.close();
  }

  // 1. Public web client and Nakama health.
  const health = await fetch(NAKAMA_URL.replace(/\/$/, "") + "/healthcheck", { signal: AbortSignal.timeout(15000) });
  assert(health.ok, "Nakama healthcheck returned HTTP " + health.status);
  results.push("PASS: Nakama production healthcheck");

  const first = await openOnline(browser, true);
  const second = await openOnline(browser, false);
  contexts.push(first.context, second.context);
  primaryPage = first.page;

  // V17 touch controls: emulate a phone with three humans and one bot.
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  });
  contexts.push(phoneContext);
  const phonePage = await phoneContext.newPage();
  phonePage.__e2eDiagnostics = [];
  phonePage.on("console", message => { if (message.type() === "error") phonePage.__e2eDiagnostics.push("console: " + message.text()); });
  phonePage.on("pageerror", error => phonePage.__e2eDiagnostics.push("pageerror: " + String(error?.stack || error)));
  await phonePage.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await phonePage.bringToFront();
  await phonePage.locator("#playMenuBtn").click();
  await phonePage.locator("#count").selectOption("4");
  await phonePage.locator("#botCount").selectOption("1");
  await phonePage.locator("#startBtn").click();
  for (const slot of [0, 2, 3]) await phonePage.locator('[data-ready="' + slot + '"]').click();
  await phonePage.waitForFunction(() => {
    const root = document.querySelector("#mobileControls");
    return root && root.style.display === "grid" && root.querySelectorAll(".touch-player-pad").length === 3;
  }, null, { timeout: 20000 });
  const phonePads = await phonePage.evaluate(() => [...document.querySelectorAll("#mobileControls .touch-player-pad")]
    .map(pad => ({ count: pad.querySelectorAll(".touch-key").length, item: !!pad.querySelector(".touch-item") })));
  assert(phonePads.length === 3 && phonePads.every(pad => pad.count === 5 && pad.item),
    "V18 phone controls did not render four directions plus an ITEM button for each of the three human players. " + JSON.stringify(phonePads));
  const spawnStates = await phonePage.evaluate(() => window.TAGOnlineHooks?.getPlayerStates?.() || []);
  assert(spawnStates.length === 4 && Math.max(...spawnStates.map(p => p.x)) - Math.min(...spawnStates.map(p => p.x)) <= 0.20,
    "V16 round-start spawn positions were not clustered closely together.");
  assert((await phonePage.evaluate(() => window.TAGOnlineHooks?.getBotPlayers?.() || [])).filter(Boolean).length === 1,
    "V16 phone control check did not create exactly one bot player.");
  results.push("PASS: V18 phone layout renders four directions plus ITEM for each human and none for the bot; round-start positions are clustered");

  await phonePage.locator("#mobilePauseBtn").click();
  await phonePage.waitForFunction(() => document.querySelector("#mobileControls")?.style.display === "none" &&
    document.querySelector("#mobilePauseBtn")?.style.display === "none",
    null, { timeout: 5000 });
  await phonePage.locator("#resumeBtn").click();
  await phonePage.waitForFunction(() => document.querySelector("#mobileControls")?.style.display === "grid",
    null, { timeout: 5000 });
  results.push("PASS: V17 touch controls hide while paused and return on resume");

  // A grounded player must collide with a solid custom structure wall.
  const collisionMapId = "v16_collision_test";
  await phonePage.evaluate(mapId => {
    const ok = window.TAGOnlineHooks.loadCustomMap({
      id: mapId, name: "V16 Collision Test", description: "Temporary automated QA wall",
      modifiers: [],
      objects: [{ type: "structure", x: 660, y: 500, w: 90, h: 180 }]
    });
    if (!ok) throw new Error("Could not register the temporary collision test map.");
    window.TAGOnlineHooks.startLocalBotMatch({ playerName: "QA", botLevel: "easy", mapId, roundLength: 120 });
  }, collisionMapId);
  await phonePage.waitForFunction(() => document.querySelector("#mobileControls")?.style.display === "grid",
    null, { timeout: 20000 });
  const wallStart = await phonePage.evaluate(() => window.TAGOnlineHooks?.getPlayerStates?.()[0]?.x);
  const rightControl = phonePage.locator("#mobileControls .touch-player-pad").first().locator(".touch-right");
  const rightBox = await rightControl.boundingBox();
  assert(rightBox, "The phone player's right touch button is not visible.");
  await phonePage.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2);
  await phonePage.mouse.down();
  await phonePage.waitForTimeout(1400);
  await phonePage.mouse.up();
  const wallEnd = await phonePage.evaluate(() => window.TAGOnlineHooks?.getPlayerStates?.()[0]?.x);
  assert(Number.isFinite(wallStart) && Number.isFinite(wallEnd) &&
    wallEnd > wallStart + 0.015 && wallEnd < 0.55,
    "A grounded runner passed through the solid structure wall. Start=" + wallStart + ", end=" + wallEnd);
  results.push("PASS: a grounded phone player is blocked by a solid custom structure");

  // V17: both stationary and moving custom structures must collide from underneath.
  await phonePage.bringToFront();
  const verifyStructureUnderside = async (mapId, motionAmp) => {
    await phonePage.bringToFront();
    await phonePage.evaluate(({ mapId, motionAmp }) => {
      // Reset the prior wall-collision fixture before starting a fresh round.
      window.TAGOnlineHooks.leaveLocalBotMatch?.();
      const ok = window.TAGOnlineHooks.loadCustomMap({
        id: mapId, name: "V17 Structure Collision", description: "Stationary/moving solid structure QA",
        modifiers: [],
        objects: [
          { type: "structure", x: 600, y: 450, w: 360, h: 180, motionAmp, motionSpeed: 2.5 },
          { type: "spawn", x: 600, y: 650 }
        ]
      });
      if (!ok) throw new Error("Could not register structure QA map " + mapId + ".");
      window.TAGOnlineHooks.startLocalBotMatch({
        playerName: "QA", botLevel: "easy", mapId, roundLength: 120
      });
    }, { mapId, motionAmp });
    await waitFor(phonePage,
      () => window.TAGOnlineHooks?.getBotDebug?.()?.mode === "playing" &&
        window.TAGOnlineHooks?.isLocalBotMatch?.() === true,
      "V17 structure test round to enter active play (" + mapId + ")",
      30000);
    await waitFor(phonePage,
      () => window.TAGOnlineHooks?.getPlayerStates?.()?.[0]?.onGround === true,
      "V17 test runner to stand below the structure (" + mapId + ")",
      5000);
    const initialStructure = await phonePage.evaluate(() => window.TAGOnlineHooks?.getStructureStates?.()?.[0] || null);
    assert(initialStructure, "The V17 structure was not registered as a collision surface: " + mapId);
    assert(Math.abs(initialStructure.y - (450-90)/700) < 0.006 &&
      Math.abs(initialStructure.w - 360/1200) < 0.006 &&
      Math.abs(initialStructure.h - 180/700) < 0.006,
      "The structure collision rectangle did not line up with its centered level-editor geometry. " +
        JSON.stringify({ mapId, structure: initialStructure }));
    await phonePage.evaluate(() => {
      window.__v17StructureSamples = [];
      window.__v17StructureRecording = true;
      const capture = () => {
        const player = window.TAGOnlineHooks?.getPlayerStates?.()?.[0];
        const structure = window.TAGOnlineHooks?.getStructureStates?.()?.[0];
        if (player && structure && window.__v17StructureRecording) {
          window.__v17StructureSamples.push({
            y: player.y, vy: player.vy,
            bottom: structure.y + structure.h,
            x: structure.x
          });
          requestAnimationFrame(capture);
        }
      };
      requestAnimationFrame(capture);
    });
    await phonePage.keyboard.down("w");
    await phonePage.waitForTimeout(180);
    await phonePage.keyboard.up("w");
    await phonePage.waitForTimeout(720);
    await phonePage.evaluate(() => { window.__v17StructureRecording = false; });
    const samples = await phonePage.evaluate(() => window.__v17StructureSamples || []);
    const minCenterY = Math.min(...samples.map(sample => sample.y));
    const expectedCenterY = initialStructure.y + initialStructure.h + 11 / phonePage.viewportSize().height;
    assert(samples.length >= 5,
      "Too few browser animation samples were captured for the structure collision check. " +
        JSON.stringify({ mapId, samples: samples.length, recent: samples.slice(-6) }));
    assert(minCenterY >= expectedCenterY - 0.005,
      "Runner passed through the underside of a " + (motionAmp ? "moving" : "stationary") +
        " structure. " + JSON.stringify({ mapId, minCenterY, expectedCenterY, recent: samples.slice(-6) }));
    assert(samples.some(sample => sample.vy > 0 && sample.y > minCenterY + 0.002),
      "Runner did not fall back down after hitting the structure underside: " + mapId);
    if (motionAmp > 0) {
      const xs = samples.map(sample => sample.x);
      assert(Math.max(...xs) - Math.min(...xs) > 0.001,
        "The moving-structure regression fixture did not actually move: " + JSON.stringify({ mapId, xs }));
    }
    results.push("PASS: " + (motionAmp ? "moving" : "stationary") +
      " custom structure aligns with editor geometry, blocks upward movement, and sends the runner back down");
    await phonePage.evaluate(() => window.TAGOnlineHooks?.leaveLocalBotMatch?.());
  };
  await verifyStructureUnderside("v17_static_structure_test", 0);
  await verifyStructureUnderside("v17_moving_structure_test", 100);

  // Stop the phone test match before running the tablet regression. Keeping a
  // second animated game active needlessly contends with the tablet canvas in CI.
  await phonePage.evaluate(() => window.TAGOnlineHooks?.endMatch?.());

  // Tablet viewport regression: controls render and the page does not overflow horizontally.
  const tabletContext = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    // This assertion measures CSS layout, not Retina raster density. A 1x
    // backing store prevents high-DPI canvas rendering from starving the timer.
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });
  contexts.push(tabletContext);
  const tabletPage = await tabletContext.newPage();
  await tabletPage.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await tabletPage.bringToFront();
  const tabletStart = await tabletPage.evaluate(() => {
    const hooks = window.TAGOnlineHooks;
    if (!hooks?.startLocalBotMatch) return { started: false, reason: "game hooks not loaded" };
    hooks.startLocalBotMatch({ playerName: "QA TABLET", botLevel: "easy", mapId: "forge", roundLength: 120 });
    return { started: true, state: hooks.getBotDebug?.() || null };
  });
  assert(tabletStart.started, "Could not start the V18 tablet bot match: " + JSON.stringify(tabletStart));
  await waitFor(tabletPage,
    () => window.TAGOnlineHooks?.getBotDebug?.()?.mode === "playing" &&
      document.querySelector("#mobileControls")?.style.display === "grid",
    "V18 tablet bot match and touch controls to enter active play",
    30000);
  try {
    await tabletPage.waitForFunction(() =>
      document.querySelector("#mobileControls")?.style.display === "grid" &&
      document.querySelectorAll("#mobileControls .touch-player-pad").length === 1,
      null,
      { timeout: 20000 });
  } catch (error) {
    const diagnostic = await tabletPage.evaluate(() => ({
      width: window.innerWidth,
      coarse: window.matchMedia("(pointer: coarse)").matches,
      mobile: window.matchMedia("(pointer: coarse), (max-width: 900px)").matches,
      display: document.querySelector("#mobileControls")?.style.display,
      mode: window.TAGOnlineHooks?.getBotDebug?.()?.mode,
      bots: window.TAGOnlineHooks?.getBotPlayers?.()
    }));
    throw new Error("V18 tablet controls did not appear: " + JSON.stringify(diagnostic) + " · " + error.message);
  }
  const tabletLayout = await tabletPage.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    controls: [...document.querySelectorAll("#mobileControls .touch-player-pad")].map(p => ({
      count: p.querySelectorAll(".touch-key").length, item: !!p.querySelector(".touch-item")
    }))
  }));
  assert(tabletLayout.document <= tabletLayout.viewport + 1 && tabletLayout.body <= tabletLayout.viewport + 1 &&
    tabletLayout.controls.length === 1 && tabletLayout.controls[0].count === 5 && tabletLayout.controls[0].item,
    "V18 tablet layout overflowed or failed to render four directions plus ITEM: " + JSON.stringify(tabletLayout));
  results.push("PASS: V18 tablet viewport fits without horizontal overflow and includes four directions plus ITEM");
  // The tablet game has completed its assertions; close its canvas to keep CI
  // resource use predictable during subsequent online and bot-navigation tests.
  await tabletContext.close();
  contexts.splice(contexts.indexOf(tabletContext), 1);

  // Online input on a phone should expose only the local human's control pad.
  await phonePage.evaluate(() => window.TAGOnlineHooks.startMatch({
    localIndex: 2, isHost: false, matchId: "v16-touch-online-test", mapId: "forge",
    players: [
      { userId: "v16-test-a", username: "RUNNER A" },
      { userId: "v16-test-b", username: "RUNNER B" },
      { userId: "v16-test-c", username: "RUNNER C" },
      { userId: "v16-test-d", username: "RUNNER D" }
    ]
  }));
  await phonePage.waitForFunction(() =>
    document.querySelector("#mobileControls")?.style.display === "grid" &&
    document.querySelectorAll("#mobileControls .touch-player-pad").length === 1,
    null, { timeout: 20000 });
  const onlinePad = await phonePage.locator("#mobileControls .touch-player-label").innerText();
  assert(onlinePad === "YOU", "V17 online phone controls were not restricted to the local player.");
  results.push("PASS: V18 online phone controls are restricted to the local human player and include ITEM");
  await phoneContext.close();
  contexts.splice(contexts.indexOf(phoneContext), 1);

  // V18 shops, wallet, inventory limits, title/accessory unlocks, and emotes placeholder.
  await first.page.evaluate(() => { localStorage.setItem("tagV18Tagpoints", "8"); location.reload(); });
  await first.page.locator("#onlineSoonBtn").waitFor({ state: "visible", timeout });
  await first.page.locator("#onlineSoonBtn").click();
  await first.page.locator("#onlineName").waitFor({ state: "visible", timeout });
  await first.page.evaluate(() => window.TAGAppScreens?.show("menu"));
  await first.page.locator("#itemShopBtn").click();
  assert(await first.page.locator("#itemShopScreen").evaluate(el => el.classList.contains("show")),
    "V18 Item Shop did not open.");
  assert((await first.page.locator("#itemShopScreen").innerText()).toUpperCase().includes("DASH CHARGE"),
    "V18 Item Shop did not display its purchasable inventory.");
  for (let n = 0; n < 3; n++) await first.page.locator('[data-v18-buy="item"][data-v18-id="dash"]').click();
  const itemInventory = await first.page.evaluate(() => window.TAGV18Diagnostics?.getInventory?.());
  assert(itemInventory?.items?.dash === 3, "V18 item stock did not purchase / stack to exactly three uses: " + JSON.stringify(itemInventory));
  assert(await first.page.locator('[data-v18-buy="item"][data-v18-id="dash"]').isDisabled(),
    "V18 item stack limit did not disable a fourth purchase.");
  await first.page.locator("#backItemShopBtn").click();
  await first.page.locator("#avatarsBtn").click();
  assert((await first.page.locator("#avatarsScreen").innerText()).toUpperCase().includes("GANG BEASTS"),
    "V18 skin shop did not display the Gang Beasts skin.");
  await first.page.locator('[data-v18-buy="skin"][data-v18-id="gangbeast"]').click();
  await first.page.locator('[data-v18-tab="accessories"]').click();
  await first.page.locator('[data-v18-buy="accessory"][data-v18-id="fedora"]').click();
  await first.page.locator('[data-v18-tab="titles"]').click();
  await first.page.locator('[data-v18-buy="title"][data-v18-id="Unbeatable"]').click();
  await first.page.locator('[data-v18-tab="emotes"]').click();
  const emoteStore = await first.page.evaluate(() => ({
    heading: document.querySelector("#v18CosmeticBody .v19-shop-intro b")?.textContent?.trim(),
    emoteCount: document.querySelectorAll("#v18CosmeticBody .v19-collectible").length
  }));
  assert(emoteStore.heading === "EMOTE STORE" && emoteStore.emoteCount === 14,
    "V19 emote store must display all 14 emotes: " + JSON.stringify(emoteStore));
  const v18Diagnostics = await first.page.evaluate(() => window.TAGV18Diagnostics?.run?.());
  assert(v18Diagnostics?.passed === v18Diagnostics?.total && v18Diagnostics.total >= 6,
    "V18 catalog/economy diagnostics failed: " + JSON.stringify(v18Diagnostics));
  await first.page.locator("#backAvatarsBtn").click();
  await first.page.evaluate(() => window.TAGAppScreens?.show("menu"));
  await first.page.locator("#accessoriesShopBtn").click();
  assert(await first.page.locator("#avatarsScreen").evaluate(el => el.classList.contains("show")),
    "V18 dedicated Accessories Shop did not open.");
  assert((await first.page.locator("#avatarsScreen").innerText()).toUpperCase().includes("WATERMELON HELMET"),
    "V18 dedicated Accessories Shop did not open its accessories category.");
  await first.page.locator('[data-v18-buy="accessory"][data-v18-id="christmas"]').click();
  const christmasPurchase = await first.page.evaluate(() => window.TAGV18Diagnostics?.getInventory?.());
  assert(christmasPurchase?.wallet === 0 && christmasPurchase.accessories.includes("christmas"),
    "V18 Christmas Hat must cost exactly two Tag Points and unlock: " + JSON.stringify(christmasPurchase));
  await first.page.locator("#backAvatarsBtn").click();
  await first.page.evaluate(() => window.TAGAppScreens?.show("menu"));
  await first.page.locator("#settingsBtn").click();
  await first.page.locator('[data-v18-setting-skin="0"]').waitFor({ state: "visible", timeout });
  await first.page.locator('[data-v18-setting-skin="0"]').selectOption("gangbeast");
  await first.page.locator('[data-v18-setting-color="0"]').evaluate(el => {
    el.value = "#36a9e8";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const savedSkinSettings = await first.page.evaluate(() => ({
    skins: JSON.parse(localStorage.getItem("tagV18PlayerSkins") || "[]"),
    colors: JSON.parse(localStorage.getItem("tagV18Colors") || "[]")
  }));
  assert(savedSkinSettings.skins[0] === "gangbeast" && savedSkinSettings.colors[0] === "#36a9e8",
    "V18 Controls menu did not save the selected skin and player color: " + JSON.stringify(savedSkinSettings));
  await first.page.locator("#backSettingsBtn").click();
  await first.page.evaluate(() => window.TAGAppScreens?.show("online"));
  await first.page.locator("#onlineName").waitFor({ state: "visible", timeout });
  results.push("PASS: V18 Item Shop, three-use item stack cap, skin/accessory/title purchases, and V19 14-emote store");

  // V15 layout regression: built-in arenas must remain distinct and collision-free.
  const arenaLayouts = await first.page.evaluate(() => window.TAGOnlineHooks?.getMapLayoutDiagnostics?.() || []);
  assert(arenaLayouts.length >= 17,
    "V15 arena diagnostics did not include all built-in maps. Count=" + arenaLayouts.length);
  const crowdedLayouts = arenaLayouts.filter(layout => layout.overlaps !== 0 || layout.placed < 12);
  assert(crowdedLayouts.length === 0,
    "V15 arena platforms still overlap or were excessively dropped: " + JSON.stringify(crowdedLayouts));
  assert(new Set(arenaLayouts.map(layout => JSON.stringify(layout.signature))).size >= 15,
    "V15 realms do not have sufficiently distinct platform layouts.");
  results.push("PASS: V15 built-in realms have non-overlapping, distinct platform layouts");

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

  // Independent Nakama sessions verify server-side outgoing, incoming and mutual records.
  const friendApiA = makeClient();
  const friendApiB = makeClient();
  const friendSessionA = await friendApiA.authenticateDevice(deviceA, false, nameA);
  const friendSessionB = await friendApiB.authenticateDevice(deviceB, false, nameB);
  const readFriendStates = async () => {
    const [outgoingA, incomingA, mutualA, outgoingB, incomingB, mutualB] = await Promise.all([
      friendApiA.listFriends(friendSessionA, 1, 100, null),
      friendApiA.listFriends(friendSessionA, 2, 100, null),
      friendApiA.listFriends(friendSessionA, 0, 100, null),
      friendApiB.listFriends(friendSessionB, 1, 100, null),
      friendApiB.listFriends(friendSessionB, 2, 100, null),
      friendApiB.listFriends(friendSessionB, 0, 100, null)
    ]);
    const has = (rows, userId) => (rows.friends || []).some(row => row.user?.id === userId);
    return {
      aOutgoingB: has(outgoingA, friendSessionB.user_id),
      aIncomingB: has(incomingA, friendSessionB.user_id),
      aMutualB: has(mutualA, friendSessionB.user_id),
      bOutgoingA: has(outgoingB, friendSessionA.user_id),
      bIncomingA: has(incomingB, friendSessionA.user_id),
      bMutualA: has(mutualB, friendSessionA.user_id)
    };
  };
  const waitForFriendRecords = async (predicate, description, ms = 10000) => {
    const deadline = Date.now() + ms;
    let last = null;
    while (Date.now() < deadline) {
      last = await readFriendStates();
      if (predicate(last)) return last;
      await sleep(300);
    }
    throw new Error("Timed out waiting for Nakama friend records for " + description + ". Last state: " + JSON.stringify(last));
  };


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

  // V17 friend request directly from a live online match, answered in the recipient's mailbox.
  await first.page.locator("#onlineChatToggle").click();
  await first.page.locator("#matchFriendToggleBtn").click();
  await first.page.waitForFunction(name =>
    [...document.querySelectorAll("#matchFriendList .online-chat-line")].some(row => row.textContent.includes(name)),
    nameB, { timeout });
  await first.page.locator("#matchFriendList .online-chat-line").filter({ hasText: nameB })
    .locator("button").click();
  const pendingRecords = await waitForFriendRecords(state => state.aOutgoingB && state.bIncomingA, "first outgoing/incoming request");
  assert(!pendingRecords.aMutualB && !pendingRecords.bMutualA,
    "A pending request was incorrectly recorded as an accepted friendship.");
  await second.page.locator("#onlineChatToggle").click();
  await second.page.locator("#matchMailboxToggleBtn").click();
  await second.page.locator("#matchMailboxRefreshBtn").click();
  await second.page.waitForFunction(name =>
    [...document.querySelectorAll("#matchMailbox .online-chat-line")].some(row => row.textContent.includes(name)),
    nameA, { timeout });
  await second.page.locator("#matchMailbox .online-chat-line").filter({ hasText: nameA })
    .locator("button").filter({ hasText: "DECLINE" }).click();
  await second.page.waitForFunction(() => (document.querySelector("#matchMailbox")?.textContent || "").includes("empty"),
    null, { timeout });
  const declinedRecords = await waitForFriendRecords(state => !state.aOutgoingB && !state.bIncomingA, "declined request cleanup");
  assert(!declinedRecords.aMutualB && !declinedRecords.bMutualA,
    "Declining a request incorrectly created a mutual friendship.");

  await first.page.locator("#matchFriendToggleBtn").click();
  await first.page.locator("#matchFriendToggleBtn").click();
  await first.page.locator("#matchFriendList .online-chat-line").filter({ hasText: nameB })
    .locator("button").click();
  const resentRecords = await waitForFriendRecords(state => state.aOutgoingB && state.bIncomingA, "resent outgoing/incoming request");
  assert(!resentRecords.aMutualB && !resentRecords.bMutualA,
    "The resent request was incorrectly recorded as accepted before the recipient responded.");
  await second.page.locator("#matchMailboxToggleBtn").click();
  await second.page.locator("#matchMailboxToggleBtn").click();
  await second.page.locator("#matchMailboxRefreshBtn").click();
  await second.page.waitForFunction(name =>
    [...document.querySelectorAll("#matchMailbox .online-chat-line")].some(row => row.textContent.includes(name)),
    nameA, { timeout });
  await second.page.locator("#matchMailbox .online-chat-line").filter({ hasText: nameA })
    .locator("button").filter({ hasText: "ACCEPT" }).click();
  await second.page.waitForFunction(() => (document.querySelector("#matchMailbox")?.textContent || "").includes("empty"),
    null, { timeout });
  const acceptedRecords = await waitForFriendRecords(state => state.aMutualB && state.bMutualA, "mutual friendship after acceptance");
  assert(!acceptedRecords.aOutgoingB && !acceptedRecords.bIncomingA &&
    !acceptedRecords.bOutgoingA && !acceptedRecords.aIncomingB,
    "Accepted friendship still appears as a pending request.");
  results.push("PASS: V17 two-account friend flow verifies outgoing, incoming, declined, resent, accepted and mutual Nakama records from inside a live match");

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
  await second.context.close();
  contexts.splice(contexts.indexOf(second.context), 1);
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
  assert(await first.page.evaluate(() => window.TAGOnlineHooks?.isLocalBotMatch?.() === true && window.TAGOnlineHooks?.isOnline?.() === false),
    "The fallback bot was not simulated locally.");
  results.push("PASS: Quick Match timeout starts a local-physics bot match with no ranked server match");
  // No more assertions use this account page. Close it so its canvas does not
  // compete with the isolated hard-bot traversal fixture below.
  await first.context.close();
  contexts.splice(contexts.indexOf(first.context), 1);

  // V15: verify local hard-bot traversal in a fresh, dedicated normal-clock browser page.
  // A separate context avoids hidden-tab throttling and visibility state left by online play.
  const localBotContext = await browser.newContext();
  contexts.push(localBotContext);
  const localBotPage = await localBotContext.newPage();
  localBotPage.__e2eDiagnostics = [];
  localBotPage.on("console", message => { if (message.type() === "error") localBotPage.__e2eDiagnostics.push("console: " + message.text()); });
  localBotPage.on("pageerror", error => localBotPage.__e2eDiagnostics.push("pageerror: " + String(error?.stack || error)));
  await localBotPage.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await localBotPage.waitForFunction(() => typeof window.TAGOnlineHooks?.startLocalBotMatch === "function", null, { timeout });
  await localBotPage.bringToFront();
  await localBotPage.waitForFunction(() => document.visibilityState === "visible", null, { timeout: 5000 });
  await localBotPage.evaluate(() => window.TAGOnlineHooks.startLocalBotMatch({
    playerName: "QA HUMAN", mapId: "forge", gameMode: "classic",
    roundLength: 180, modifiers: [], botLevel: "hard"
  }));
  await waitFor(localBotPage,
    () => window.TAGOnlineHooks?.getBotDebug?.()?.mode === "playing" &&
      window.TAGOnlineHooks?.isLocalBotMatch?.() === true,
    "V15 local bot round to enter active play",
    30000);
  const localClockStart = await localBotPage.evaluate(() => ({
    display: (document.querySelector("#timer")?.textContent || "").trim(),
    remaining: Number(window.TAGOnlineHooks?.getHostState?.()?.remaining)
  }));
  await localBotPage.evaluate(start => { window.__tagBotTimerStart = start; }, localClockStart);
  const botStart = await localBotPage.evaluate(() =>
    window.TAGOnlineHooks?.getPlayerStates?.()?.find(player => player.isBot) || null);
  await waitFor(localBotPage, () => {
    const state = window.TAGOnlineHooks?.getHostState?.();
    const display = (document.querySelector("#timer")?.textContent || "").trim();
    const start = window.__tagBotTimerStart;
    return Number.isFinite(state?.remaining) && Number.isFinite(start?.remaining) &&
      state.remaining < start.remaining - 0.75 &&
      display !== start.display;
  }, "V15 local bot round timer to advance on the normal animation clock", 12000);
  await sleep(2200);
  const botEnd = await localBotPage.evaluate(() =>
    window.TAGOnlineHooks?.getPlayerStates?.()?.find(player => player.isBot) || null);
  assert(botStart && botEnd && Math.hypot(botEnd.x - botStart.x, botEnd.y - botStart.y) > 0.012,
    "V15 hard bot did not traverse the arena during active play. Start=" + JSON.stringify(botStart) + " End=" + JSON.stringify(botEnd) + " Debug=" + JSON.stringify(await localBotPage.evaluate(() => window.TAGOnlineHooks?.getBotDebug?.())));
  assert(botEnd.y > 0.10 && botEnd.y < 0.96,
    "V15 hard bot moved outside the playable arena.");
  await localBotPage.evaluate(() => window.TAGOnlineHooks?.leaveLocalBotMatch?.());
  await localBotPage.evaluate(() => window.TAGAppScreens?.show("online"));
  results.push("PASS: V15 hard bot uses active platform navigation and moves across the arena");
  await localBotContext.close();
  contexts.splice(contexts.indexOf(localBotContext), 1);

  // 7. A published community map is searchable and starts with three replaceable bots.
  // V15 rechecks this path against the nil-safe Nakama bot planner deployed to production.
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
    assert(firstMapState.public_map === true && firstMapState.bot_match === true,
      "The server did not mark this as an online bot match. State=" + JSON.stringify(firstMapState));
    assert(firstMapState.players.filter(player => player.is_bot).length === 3,
      "A new public map match did not fill all three open slots with bots.");
    assert(firstMapState.players.filter(player => player.is_bot).every(player => Math.abs(Number(player.y) - 0.82) < 0.025),
      "A server arena bot did not spawn on the ground line.");
    await waitForMapState(() => mapStateA, state => state.status === "playing",
      "V15 public-map bot round to enter active play");
    const loopTicksBefore = Number(mapStateA.bot_loop_ticks || 0);
    const serverBotStarts = mapStateA.players.filter(player => player.is_bot)
      .map(player => ({ id: player.user_id, x: Number(player.x), y: Number(player.y), aiTicks: Number(player.bot_ai_ticks || 0), goal: player.bot_goal_surface }));
    await sleep(1800);
    const loopTicksAfter = Number(mapStateA.bot_loop_ticks || 0);
    const serverBotEnds = mapStateA.players.filter(player => player.is_bot);
    assert(serverBotStarts.some(before => {
      const after = serverBotEnds.find(player => player.user_id === before.id);
      return after && Number(after.bot_ai_ticks || 0) > before.aiTicks &&
        Math.hypot(Number(after.x) - before.x, Number(after.y) - before.y) > 0.006;
    }), "V15 online public-map bots did not navigate their arena platforms. Flags=" + JSON.stringify({public_map:mapStateA.public_map,bot_match:mapStateA.bot_match,loopTicksBefore,loopTicksAfter,bot_ai_error:mapStateA.bot_ai_error}) + " Starts=" + JSON.stringify(serverBotStarts) + " Ends=" + JSON.stringify(serverBotEnds));
    results.push("PASS: V15 online public-map bots actively navigate and move between arena locations");
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
