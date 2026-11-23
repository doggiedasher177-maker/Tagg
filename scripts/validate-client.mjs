import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";

const sourcePath = "index.html";
const publishPath = "docs/index.html";
const source = readFileSync(sourcePath, "utf8");
const published = readFileSync(publishPath, "utf8");

if (source !== published) {
  throw new Error(publishPath + " is out of sync with " + sourcePath + ". Copy the latest browser client into docs/index.html before publishing.");
}

const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .map((match) => ({ attributes: match[1] || "", source: match[2] || "" }))
  .filter((item) => item.source.trim().length > 0);

if (scripts.length === 0) {
  throw new Error("No inline JavaScript was found in index.html.");
}

const roomCodeStart = source.indexOf("const ROOM_CODE_ALPHABET");
const roomCodeEnd = source.indexOf("function clearQueueClocks", roomCodeStart);
if (roomCodeStart < 0 || roomCodeEnd < 0) {
  throw new Error("The TAG! room-code encoder/decoder is missing.");
}

const roomCodeSource = source.slice(roomCodeStart, roomCodeEnd);
const roomCodes = runInNewContext(roomCodeSource + "\n({ encodeRoomCode, decodeRoomCode })", {});
const sampleRoomIds = [
  "00000000-0000-0000-0000-000000000000",
  "550e8400-e29b-41d4-a716-446655440000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
];

for (const matchId of sampleRoomIds) {
  const code = roomCodes.encodeRoomCode(matchId);
  const decodedMatchId = matchId + ".tagg";
  if (roomCodes.decodeRoomCode(code) !== decodedMatchId || roomCodes.encodeRoomCode(decodedMatchId) !== code) {
    throw new Error("TAG! room-code round-trip failed for " + matchId + ".");
  }
}

if (roomCodes.decodeRoomCode("TAG-NOT-A-REAL-CODE") !== null) {
  throw new Error("TAG! accepted an invalid private room code.");
}

if (
  !source.includes("queueDeadline=performance.now()+30000") ||
  !source.includes("queueDeadline-performance.now()") ||
  !source.includes("if(!queueActive&&!queueBotFallbackStarted)return;")
) {
  throw new Error("The matchmaking countdown regression guards are missing.");
}
if (
  !source.includes("function resolvePlatformPlacements") ||
  !source.includes("function botRoute") ||
  !source.includes("function chooseBotPlatform") ||
  !source.includes("V15 · SMART BOTS & ARENA ARCHITECTURE") ||
  !source.includes("getMapLayoutDiagnostics()")
) {
  throw new Error("V15 bot pathfinding or non-overlapping arena layout features are missing.");
}

if (
  !source.includes("V17 · SOLID STRUCTURES & IN-MATCH FRIENDS") ||
  !source.includes("TAG! — Zyron Studios V19 · Living Legends") ||
  !source.includes("function customPlatformGeometry") ||
  !source.includes("centerX-objectW/2") ||
  !source.includes("centerY-objectH/2") ||
  !source.includes("kind:o.type==='structure'?'structure':'stone'") ||
  !source.includes("getStructureStates(){return platforms.filter(p=>p.kind==='structure')") ||
  !source.includes("const previousSolidX=Number.isFinite(solid.prevX)?solid.prevX:solid.x-(solid.dx||0)") ||
  !source.includes("if(moving.length&&pads[2]){") ||
  !source.includes("V16 · MOBILE PLAY, SOLID ARENAS & FRIEND MAILBOX") ||
  !source.includes('id="matchMailboxRefreshBtn"') ||
  !source.includes("if($('matchMailbox')?.style.display==='block')refreshMatchMailbox().catch(()=>{});") ||
  !source.includes("function refreshMobileControls()") ||
  !source.includes("if(!mobile||mode!=='playing')") ||
  !source.includes("id=\"mobilePauseBtn\"") ||
  !source.includes("await client.addFriends(session,[],[name])") ||
  !source.includes("getOnlinePlayers(){return Array.from({length:activePlayerCount}") ||
  !source.includes("ADD MATCH PLAYERS AS FRIENDS") ||
  !source.includes("async function refreshMatchFriendTargets()") ||
  !source.includes("async function refreshMatchMailbox()") ||
  !source.includes("id=\"matchMailbox\"") ||
  !source.includes("MAILBOX · INCOMING FRIEND REQUESTS") ||
  !source.includes("refreshFriends().catch(()=>{})") ||
  source.includes("V18 · STRUCTURE UNDERSIDE COLLISION") ||
  !source.includes("V19 · THE LIVING LEGENDS UPDATE") ||
  !source.includes("function useItem(i)") ||
  !source.includes("data-v18-setting-skin") ||
  !source.includes("data-v18-setting-color") ||
  !source.includes("function updateKillerBots(dt)") ||
  !source.includes("function eliminatePlayer(i)") ||
  !source.includes("GLITCHY LANDSCAPES") ||
  !source.includes("function v19DrawV1") ||
  !source.includes("previousBottom<q.y-2") ||
  !source.includes("v19KillerDifficulty") ||
  !source.includes("v19ProfileCardSelect") ||
  !source.includes("[Unbeaten champion]") ||
  !source.includes("tagV19DetailMode") ||
  !source.includes("v19YouPicker") ||
  !source.includes("Distraction Dance") ||
  !source.includes("Boogie Down") ||
  !source.includes("function v19RenderSkinPreviews") ||
  !source.includes("docs/history.html")
) {
  throw new Error("V18 release, V17 solid collision, or existing V16/V17 safeguards are missing.");
}

const directory = join(tmpdir(), "tag-client-check-" + process.pid);
mkdirSync(directory, { recursive: true });

try {
  scripts.forEach((script, index) => {
    const isModule = /\btype\s*=\s*["']module["']/i.test(script.attributes);
    const filename = join(directory, "inline-" + (index + 1) + (isModule ? ".mjs" : ".js"));
    writeFileSync(filename, script.source, "utf8");

    const check = spawnSync(process.execPath, ["--check", filename], {
      encoding: "utf8",
    });

    if (check.status !== 0) {
      const details = [check.stdout, check.stderr].filter(Boolean).join("\n").trim();
      throw new Error("JavaScript syntax check failed for inline script " + (index + 1) + ":\n" + details);
    }
  });

  console.log("Validated matching source/published HTML and " + scripts.length + " inline JavaScript block(s).");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
