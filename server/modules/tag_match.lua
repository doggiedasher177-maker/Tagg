local nk = require("nakama")
local M = {}

local TICK_RATE = 10
local MAX_PLAYERS = 4
local DEFAULT_LENGTH = 120
local LEADERBOARD_WINS = "tag_online_wins_v2"
local LEADERBOARD_LOSSES = "tag_online_losses_v2"
local LEADERBOARD_MATCHES = "tag_online_matches_v2"
local LEADERBOARD_TAGS = "tag_online_tags_v2"
local LEADERBOARD_ELO = "tag_online_elo_v1"
local LEADERBOARD_TAGPOINTS = "tag_online_tagpoints_v1"
local PUBLIC_MAPS_COLLECTION = "tag_public_maps"
local WEEKLY_TOURNAMENT = "tag_weekly_v2"
local ONLINE_STREAM = {
  mode = 100,
  label = "tag-online-global"
}

local function clamp(value, low, high)
  return math.max(low, math.min(high, value))
end

local function valid_number(value)
  local n = tonumber(value)
  if not n or n ~= n or n == math.huge or n == -math.huge then return nil end
  return n
end

local ALLOWED_MODIFIERS = {
  doublejump = true, superspeed = true, decoys = true, chained = true,
  sentinels = true, parry = true, munci = true
}

local function clean_modifiers(value)
  local result, seen = {}, {}
  if type(value) == "string" then
    local parsed = {}
    for item in string.gmatch(value, "[^,]+") do table.insert(parsed, item) end
    value = parsed
  end
  if type(value) ~= "table" then return result end
  for _, item in ipairs(value) do
    local name = tostring(item):lower()
    if ALLOWED_MODIFIERS[name] and not seen[name] and #result < 3 then
      seen[name] = true
      table.insert(result, name)
    end
  end
  return result
end

local PUBLIC_OBJECT_TYPES = {
  platform = true, structure = true, orb = true, pad = true, spawn = true,
  npc = true, modifier = true, event = true, decoration = true
}
local PUBLIC_MODIFIERS = {
  doublejump = true, superspeed = true, decoys = true, chained = true,
  sentinels = true, parry = true, munci = true
}

local function sanitize_public_level(source)
  if type(source) ~= "table" or type(source.objects) ~= "table" then
    error("Invalid TAG! map data.")
  end
  if #source.objects < 1 or #source.objects > 350 then
    error("A public map must contain between 1 and 350 objects.")
  end
  local id = tostring(source.id or ""):gsub("[^%w_-]", ""):sub(1, 48)
  if id == "" then error("This map is missing its local map ID.") end
  local level = {
    id = id,
    name = tostring(source.name or "Community Arena"):gsub("[%c]", " "):sub(1, 32),
    description = tostring(source.description or ""):gsub("[%c]", " "):sub(1, 220),
    music = "",
    modifiers = {},
    objects = {}
  }
  if level.name == "" then level.name = "Community Arena" end
  for _, object in ipairs(source.objects) do
    if type(object) == "table" and PUBLIC_OBJECT_TYPES[object.type] then
      local o = {
        type = object.type,
        x = clamp(valid_number(object.x) or 0, 18, 1182),
        y = clamp(valid_number(object.y) or 0, 20, 680),
        w = clamp(valid_number(object.w) or 28, 6, 500),
        h = clamp(valid_number(object.h) or 16, 6, 180)
      }
      if type(object.color) == "string" and object.color:match("^#%x%x%x%x%x%x$") then
        o.color = object.color
      end
      if object.type == "orb" then
        o.r = clamp(valid_number(object.r) or 14, 6, 48)
        o.forceX = clamp(valid_number(object.forceX) or 0, -1600, 1600)
        o.forceY = clamp(valid_number(object.forceY) or -610, -1600, 1600)
      elseif object.type == "platform" or object.type == "structure" then
        o.motionAmp = clamp(valid_number(object.motionAmp) or 0, 0, 350)
        o.motionSpeed = clamp(valid_number(object.motionSpeed) or 0.7, 0.1, 5)
      elseif object.type == "modifier" and PUBLIC_MODIFIERS[tostring(object.modifier or "")] then
        o.modifier = tostring(object.modifier)
        local found = false
        for _, item in ipairs(level.modifiers) do if item == o.modifier then found = true end end
        if not found and #level.modifiers < 3 then table.insert(level.modifiers, o.modifier) end
      elseif object.type == "decoration" then
        o.decoration = tostring(object.decoration or "tree"):sub(1, 24)
      elseif object.type == "event" then
        o.event = tostring(object.event or "sandstorm"):sub(1, 24)
      elseif object.type == "npc" then
        o.npc = "munci"
      end
      table.insert(level.objects, o)
    end
  end
  if #level.objects < 1 then error("This map has no supported objects.") end
  local encoded = nk.json_encode(level)
  if #encoded > 48000 then error("This map is too large to publish (48 KB maximum).") end
  return level
end

local function ordered_players(state)
  local ids = {}
  if state.public_map and type(state.slot_order) == "table" then
    local seen = {}
    for _, user_id in ipairs(state.slot_order) do
      local player = state.players[user_id]
      if player and player.connected then
        table.insert(ids, user_id)
        seen[user_id] = true
      end
    end
    local extras = {}
    for user_id, player in pairs(state.players) do
      if player and player.connected and not seen[user_id] then table.insert(extras, user_id) end
    end
    table.sort(extras)
    for _, user_id in ipairs(extras) do table.insert(ids, user_id) end
  else
    for user_id, player in pairs(state.players) do
      if player and player.connected then table.insert(ids, user_id) end
    end
    table.sort(ids, function(a, b)
      if state.owner_id and a == state.owner_id then return true end
      if state.owner_id and b == state.owner_id then return false end
      return a < b
    end)
  end
  state.order = ids
  return ids
end

local function active_count(state)
  return #ordered_players(state)
end

local function public_state(state)
  local ids = ordered_players(state)
  local players = {}
  for slot, user_id in ipairs(ids) do
    local p = state.players[user_id]
    players[slot] = {
      user_id = user_id,
      username = p.username,
      x = p.x,
      y = p.y,
      vx = p.vx,
      vy = p.vy,
      face = p.face or 1,
      slot = slot - 1,
      connected = true,
      violations = p.violations or 0,
      is_bot = p.is_bot or false,
      tags = p.tags or 0
    }
  end

  local infected_slots = {}
  for slot, user_id in ipairs(ids) do
    if state.infected[user_id] then table.insert(infected_slots, slot - 1) end
  end

  return {
    status = state.status,
    tournament_mode = state.tournament_mode or false,
    bot_match = state.bot_match or false,
    modifiers = state.modifiers or {},
    players = players,
    host_user_id = state.host_user_id,
    mode = state.mode,
    map = state.map,
    length = state.length,
    remaining = state.remaining or state.length,
    countdown = state.countdown or 0,
    tagged = (state.tagged or 1) - 1,
    scores = state.scores or {},
    infected = infected_slots,
    tag_cooldown = state.tag_cooldown or 0,
    winner_slot = state.winner_slot,
    winner_user_id = state.winner_user_id,
    end_reason = state.end_reason,
    server_authoritative = true
  }
end

local function broadcast_state(dispatcher, state)
  local snapshot = public_state(state)
  if state.public_map and state.custom_map_pending and state.custom_map then
    snapshot.custom_map = state.custom_map
    state.custom_map_pending = false
  end
  dispatcher.broadcast_message(11, nk.json_encode(snapshot), nil, nil)
end

local function write_progress_record(id, user_id, username, metadata, score_add)
  local ok, result, err = pcall(nk.leaderboard_record_write, id, user_id, username, score_add or 1, 0, metadata)
  if not ok then
    nk.logger_error("TAG! progression write threw for " .. id .. ": " .. tostring(result))
  elseif err then
    nk.logger_error("TAG! progression write failed for " .. id .. ": " .. tostring(err))
  end
end

local function write_elo_progress(user_id, username, delta, metadata)
  local current = 100
  local ok, records, owner_records = pcall(
    nk.leaderboard_records_list, LEADERBOARD_ELO, { user_id }, 1, "", 0
  )
  if ok then
    local record = (owner_records and owner_records[1]) or (records and records[1])
    if record and tonumber(record.score) then current = tonumber(record.score) end
  else
    nk.logger_warn("TAG! could not read current ELO for " .. tostring(user_id) .. ": " .. tostring(records))
  end
  local wrote, result, err = pcall(
    nk.leaderboard_record_write, LEADERBOARD_ELO, user_id, username,
    math.max(0, current + delta), 0, metadata, "set"
  )
  if not wrote then
    nk.logger_error("TAG! ELO write threw: " .. tostring(result))
  elseif err then
    nk.logger_error("TAG! ELO write failed: " .. tostring(err))
  end
end

local function award_match(state)
  if state.result_awarded then return end
  state.result_awarded = true
  local ids = ordered_players(state)
  local winner_user_id = state.winner_user_id
  local winner = winner_user_id and state.players[winner_user_id] or nil

  -- A disconnect with more than 30 seconds remaining ends the match but awards
  -- no competitive points. Disconnects at 30 seconds or less count as a result.
  if state.end_reason == "opponent_disconnected" and (tonumber(state.remaining) or 0) > 30 then
    nk.logger_info("TAG! early disconnect: result recorded without rewards for " .. tostring(state.match_id))
    return
  end

  local all_ids = {}
  for user_id, player in pairs(state.players) do
    if player then table.insert(all_ids, user_id) end
  end
  table.sort(all_ids)
  for _, user_id in ipairs(all_ids) do
    local p = state.players[user_id]
    if p and not p.is_bot then
    local metadata = {
      game = "TAG!",
      mode = state.mode,
      map = state.map,
      match_id = state.match_id,
      result = user_id == winner_user_id and "win" or "loss"
    }
    write_progress_record(LEADERBOARD_MATCHES, user_id, p.username, metadata)
    if user_id == winner_user_id then
      write_progress_record(LEADERBOARD_WINS, user_id, p.username, metadata)
      write_elo_progress(user_id, p.username, 10, metadata)
      write_progress_record(LEADERBOARD_TAGPOINTS, user_id, p.username, metadata, 1)
    else
      write_progress_record(LEADERBOARD_LOSSES, user_id, p.username, metadata)
      write_elo_progress(user_id, p.username, -5, metadata)
    end
    if (p.tags or 0) > 0 then
      write_progress_record(LEADERBOARD_TAGS, user_id, p.username, metadata, p.tags)
    end
    end
  end

  if winner and not winner.is_bot then
    local ok, result, err = pcall(
      nk.tournament_record_write,
      WEEKLY_TOURNAMENT,
      winner.user_id,
      winner.username,
      1,
      0,
      { game = "TAG!", map = state.map, mode = state.mode, match_id = state.match_id }
    )
    if not ok then
      nk.logger_error("TAG! weekly tournament write threw: " .. tostring(result))
    elseif err then
      nk.logger_error("TAG! weekly tournament write failed: " .. tostring(err))
    end
  end
end

local function finish_match(state, winner_slot, reason)
  if state.status == "result" then return end
  local ids = ordered_players(state)
  local slot = tonumber(winner_slot)
  if not slot or slot < 1 or slot > #ids then slot = 1 end
  state.winner_slot = slot - 1
  state.winner_user_id = ids[slot]
  state.status = "result"
  state.end_reason = reason or "time"
  state.remaining = math.max(0, state.remaining or 0)
  award_match(state)
end

local function calculate_winner(state)
  local ids = ordered_players(state)
  if #ids == 0 then return 1 end

  if state.mode == "infection" then
    for slot, user_id in ipairs(ids) do
      if not state.infected[user_id] then return slot end
    end
    return 1
  end

  local winner_slot, best_score = nil, -math.huge
  for slot, user_id in ipairs(ids) do
    if slot ~= state.tagged then
      local score = tonumber(state.scores[slot]) or 0
      if not winner_slot or score > best_score then
        winner_slot, best_score = slot, score
      end
    end
  end
  return winner_slot or 1
end

local function try_tag(state)
  local ids = ordered_players(state)
  if #ids < 2 or state.tag_cooldown > 0 then return end

  if state.mode == "infection" then
    for _, hunter_id in ipairs(ids) do
      local hunter = state.players[hunter_id]
      if state.infected[hunter_id] and hunter.x and hunter.y then
        for slot, target_id in ipairs(ids) do
          local target = state.players[target_id]
          if not state.infected[target_id] and target.x and target.y then
            local dx, dy = hunter.x - target.x, (hunter.y - target.y) * 0.85
            if math.sqrt(dx * dx + dy * dy) <= 0.025 then
              state.infected[target_id] = true
              local hunter_slot = 1
              for index, candidate_id in ipairs(ids) do
                if candidate_id == hunter_id then hunter_slot = index break end
              end
              state.scores[hunter_slot] = (state.scores[hunter_slot] or 0) + 100
              hunter.tags = (hunter.tags or 0) + 1
              state.tagged = slot
              state.tag_cooldown = 3
              local survivors = 0
              for _, id in ipairs(ids) do if not state.infected[id] then survivors = survivors + 1 end end
              if survivors <= 1 then
                for remaining_slot, id in ipairs(ids) do
                  if not state.infected[id] then
                    state.scores[remaining_slot] = (state.scores[remaining_slot] or 0) + 10000
                    finish_match(state, remaining_slot, "last_uninfected")
                    return
                  end
                end
              end
              return
            end
          end
        end
      end
    end
    return
  end

  local holder_id = ids[state.tagged]
  local holder = holder_id and state.players[holder_id] or nil
  if not holder or not holder.x or not holder.y then return end

  for slot, target_id in ipairs(ids) do
    if slot ~= state.tagged then
      local target = state.players[target_id]
      if target.x and target.y then
        local dx, dy = holder.x - target.x, (holder.y - target.y) * 0.85
        if math.sqrt(dx * dx + dy * dy) <= 0.025 then
          holder.tags = (holder.tags or 0) + 1
          state.scores[state.tagged] = (state.scores[state.tagged] or 0) + 100
          state.tagged = slot
          state.tag_cooldown = 3
          return
        end
      end
    end
  end
end

local function accept_player_snapshot(state, sender, data, tick)
  local player = state.players[sender.user_id]
  if not player or not player.connected or state.status ~= "playing" then return end
  if type(data) ~= "table" or type(data.player) ~= "table" then return end

  local source = data.player
  local x, y = valid_number(source.x), valid_number(source.y)
  local vx, vy = valid_number(source.vx), valid_number(source.vy)
  if not x or not y or not vx or not vy then return end

  -- Coordinates are normalized by the browser. Bounds and speed envelopes reject
  -- impossible teleports while allowing TAG!'s run, dash, jump and fall velocities.
  x, y = clamp(x, 0.015, 0.985), clamp(y, 0.015, 0.985)
  local last_tick = player.last_tick or tick
  local elapsed = clamp((tick - last_tick) / TICK_RATE, 0.1, 0.6)

  if player.x ~= nil and player.y ~= nil then
    local max_dx = 0.82 * elapsed + 0.035
    local max_dy = 2.05 * elapsed + 0.065
    local dx, dy = x - player.x, y - player.y
    if math.abs(dx) > max_dx or math.abs(dy) > max_dy then
      player.violations = (player.violations or 0) + 1
      return
    end
  end

  player.x = x
  player.y = y
  player.vx = clamp(vx, -1.4, 1.4)
  player.vy = clamp(vy, -2.4, 2.4)
  player.face = tonumber(source.face) and (tonumber(source.face) < 0 and -1 or 1) or 1
  player.last_tick = tick
end

function M.match_init(context, params)
  params = params or {}
  local mode = (params.mode == "infection" or params.mode == "hotpotato") and params.mode or "classic"
  local map = tostring(params.map or "random"):sub(1, 32)
  if map == "random" then
    local choices = { "forge", "archive", "tidal", "moon", "greenland", "city", "mall", "dojo", "desert", "glacier", "skyport", "carnival", "volcano", "bombonera", "monumental", "hell", "heaven" }
    map = choices[math.random(1, #choices)]
  end
  local length = clamp(math.floor(valid_number(params.length) or DEFAULT_LENGTH), 60, 1800)
  local state = {
    players = {},
    sessions = {},
    order = {},
    expected_users = {},
    tournament_mode = params.tournament_mode == true,
    bot_match = params.bot_match == true,
    public_map = params.public_map == true,
    custom_map = params.custom_map,
    public_map_key = tostring(params.public_map_key or ""), 
    slot_order = {},
    tournament_title = tostring(params.tournament_title or "Community Tournament"):sub(1, 32),
    target_count = (params.tournament_mode == true or params.public_map == true) and 4 or clamp(math.floor(valid_number(params.target_count) or 2), 2, MAX_PLAYERS),
    owner_id = params.owner_id,
    host_user_id = params.owner_id,
    created_by = params.created_by or "unknown",
    match_id = context.match_id,
    status = "lobby",
    mode = mode,
    map = map,
    modifiers = clean_modifiers(params.modifiers),
    length = length,
    remaining = length,
    countdown = 0,
    tagged = 1,
    scores = {},
    infected = {},
    tag_cooldown = 3,
    score_tick = 0,
    result_awarded = false
  }

  if type(params.expected_users) == "table" then
    local expected_count = 0
    for _, entry in ipairs(params.expected_users) do
      local user_id = entry.user_id or (entry.presence and entry.presence.user_id)
      if user_id then
        state.expected_users[user_id] = true
        expected_count = expected_count + 1
      end
    end
    if expected_count > 0 then
      state.target_count = clamp(expected_count, 2, MAX_PLAYERS)
    end
  end
  if next(state.expected_users) ~= nil then
    local expected_ids = {}
    for user_id in pairs(state.expected_users) do table.insert(expected_ids, user_id) end
    table.sort(expected_ids)
    state.host_user_id = state.host_user_id or expected_ids[1]
  else
    state.target_count = (state.tournament_mode or state.public_map) and MAX_PLAYERS or 2
  end

  nk.logger_info("TAG! authoritative match created: " .. tostring(context.match_id))
  local label = "TAG_MATCH"
  if state.public_map then
    label = "TAG_PUBLIC_MAP|" .. state.public_map_key
  elseif state.tournament_mode then
    label = "TAG_TOURNAMENT|" .. state.tournament_title:gsub("|", " ") .. "|" .. mode .. "|" .. map
  end
  return state, TICK_RATE, label
end

function M.match_join_attempt(context, dispatcher, tick, state, presence, metadata)
  if state.public_map then
    if state.status == "result" or state.status == "closed" then
      return state, false, "This TAG! map match has already ended."
    end
    local bots = 0
    for _, player in pairs(state.players) do
      if player and player.connected and player.is_bot then bots = bots + 1 end
    end
    local humans = 0
    for _, player in pairs(state.players) do
      if player and player.connected and not player.is_bot then humans = humans + 1 end
    end
    if state.status == "lobby" then
      if humans >= state.target_count then return state, false, "All player slots are taken." end
      return state, true
    end
    if bots <= 0 then return state, false, "All three bot slots have been taken by players." end
    return state, true
  end

  if state.status ~= "lobby" then return state, false, "This TAG! round has already started." end
  local count = 0
  for _, player in pairs(state.players) do if player.connected then count = count + 1 end end
  if count >= state.target_count or count >= MAX_PLAYERS then
    return state, false, "This TAG! room is full."
  end
  if next(state.expected_users) ~= nil and not state.expected_users[presence.user_id] then
    return state, false, "This matchmaking ticket was not assigned to your account."
  end
  return state, true
end

function M.match_join(context, dispatcher, tick, state, presences)
  if state.public_map then
    for _, presence in ipairs(presences) do
      local replace_slot = nil
      local previous_order = ordered_players(state)
      local previous_scores = state.scores or {}
      local previous_tagger = previous_order[state.tagged]
      if state.status ~= "lobby" then
        for slot, existing_id in ipairs(state.slot_order or {}) do
          local existing = state.players[existing_id]
          if existing and existing.connected and existing.is_bot then
            replace_slot = slot
            existing.connected = false
            break
          end
        end
        if not replace_slot then
          nk.logger_warn("TAG! public map join rejected after slot check for " .. tostring(context.match_id))
        end
      end

      local player = {
        user_id = presence.user_id,
        username = presence.username,
        session_id = presence.session_id,
        connected = true,
        violations = 0,
        tags = 0,
        is_bot = false
      }
      if replace_slot then
        local bot_id = previous_order[replace_slot] or state.slot_order[replace_slot]
        local bot = state.players[bot_id]
        if bot then
          player.x, player.y = bot.x, bot.y
          player.vx, player.vy = bot.vx, bot.vy
          player.face = bot.face
          player.tags = bot.tags or 0
        end
        state.slot_order[replace_slot] = presence.user_id
      else
        table.insert(state.slot_order, presence.user_id)
      end
      state.players[presence.user_id] = player
      state.sessions[presence.session_id] = presence.user_id

      local current_order = ordered_players(state)
      if replace_slot then
        local remapped = {}
        local new_tagger_slot = 1
        for slot, user_id in ipairs(current_order) do
          if user_id == previous_tagger then new_tagger_slot = slot end
          if user_id == presence.user_id then
            remapped[slot] = previous_scores[replace_slot] or 0
          else
            for old_slot, old_id in ipairs(previous_order) do
              if old_id == user_id then remapped[slot] = previous_scores[old_slot] or 0 break end
            end
          end
        end
        state.scores = remapped
        state.tagged = new_tagger_slot
      end
    end

    -- The first entrant gets three arena bots. Later entrants replace a bot in-place.
    if state.status == "lobby" then
      local bot_number = 1
      while #state.slot_order < state.target_count do
        local bot_id = "tagbot_" .. tostring(state.match_id):gsub("[^%w]", ""):sub(1, 10) .. "_" .. tostring(bot_number)
        while state.players[bot_id] do bot_number = bot_number + 1; bot_id = "tagbot_" .. tostring(state.match_id):gsub("[^%w]", ""):sub(1, 10) .. "_" .. tostring(bot_number) end
        state.players[bot_id] = {
          user_id = bot_id,
          username = "ARENA BOT " .. tostring(bot_number),
          is_bot = true, connected = true, tags = 0, violations = 0,
          x = 0.18 + bot_number * 0.20, y = 0.68, vx = 0, vy = 0, face = -1
        }
        table.insert(state.slot_order, bot_id)
        bot_number = bot_number + 1
      end
      local ids = ordered_players(state)
      state.status = "countdown"
      state.countdown = 3
      state.remaining = state.length
      state.tagged = 1
      state.tag_cooldown = 3
      state.scores = {}
      state.infected = {}
      for slot, user_id in ipairs(ids) do
        state.scores[slot] = 0
        if slot == 1 and state.mode == "infection" then state.infected[user_id] = true end
      end
    end

    state.custom_map_pending = true
    broadcast_state(dispatcher, state)
    return state
  end

  for _, presence in ipairs(presences) do
    local player = state.players[presence.user_id] or {
      user_id = presence.user_id,
      username = presence.username,
      violations = 0,
      tags = 0,
      is_bot = false
    }
    player.username = presence.username or player.username
    player.session_id = presence.session_id
    player.connected = true
    state.players[presence.user_id] = player
    state.sessions[presence.session_id] = presence.user_id
  end

  if state.bot_match then
    local human_count, has_bot = 0, false
    for _, player in pairs(state.players) do
      if player and player.connected then
        if player.is_bot then has_bot = true else human_count = human_count + 1 end
      end
    end
    if human_count > 0 and not has_bot then
      local bot_id = "tagbot_" .. tostring(state.match_id):gsub("[^%w]", ""):sub(1, 12)
      state.players[bot_id] = {
        user_id = bot_id, username = "ARENA BOT", is_bot = true,
        connected = true, tags = 0, violations = 0,
        x = 0.78, y = 0.7, vx = 0, vy = 0, face = -1
      }
    end
  end

  local ids = ordered_players(state)
  if not state.host_user_id and ids[1] then state.host_user_id = ids[1] end
  if state.status == "lobby" and not state.tournament_mode and #ids >= state.target_count then
    state.status = "countdown"
    state.countdown = 3
    state.tagged = 1
    state.tag_cooldown = 3
    state.scores = {}
    state.infected = {}
    for slot, user_id in ipairs(ids) do
      state.scores[slot] = 0
      if slot == 1 and state.mode == "infection" then state.infected[user_id] = true end
    end
    nk.logger_info("TAG! countdown started for " .. tostring(context.match_id))
  end

  broadcast_state(dispatcher, state)
  return state
end
function M.match_leave(context, dispatcher, tick, state, presences)
  local previous_order = state.order or ordered_players(state)
  for _, presence in ipairs(presences) do
    local player = state.players[presence.user_id]
    if player and player.session_id == presence.session_id then
      player.connected = false
      state.sessions[presence.session_id] = nil
    end
  end

  if state.public_map then
    local ids = ordered_players(state)
    local human_ids = {}
    for _, user_id in ipairs(ids) do
      local p = state.players[user_id]
      if p and not p.is_bot then table.insert(human_ids, user_id) end
    end
    if state.status == "playing" or state.status == "countdown" then
      if #human_ids == 1 then
        local winner_slot = 1
        for slot, user_id in ipairs(ids) do if user_id == human_ids[1] then winner_slot = slot break end end
        finish_match(state, winner_slot, "opponent_disconnected")
        broadcast_state(dispatcher, state)
        return state
      elseif #human_ids == 0 then
        state.status = "closed"
        state.end_reason = "all_players_disconnected"
        broadcast_state(dispatcher, state)
        return state
      end
    end

    -- In multi-human public-map matches, a disconnected human is replaced by a bot.
    for slot, old_id in ipairs(state.slot_order or {}) do
      local old_player = state.players[old_id]
      if old_player and not old_player.connected and not old_player.is_bot then
        local bot_id = "tagbot_" .. tostring(state.match_id):gsub("[^%w]", ""):sub(1, 10) .. "_rejoin_" .. tostring(tick) .. "_" .. tostring(slot)
        state.players[bot_id] = {
          user_id = bot_id, username = "ARENA BOT", is_bot = true,
          connected = true, tags = 0, violations = 0,
          x = old_player.x or 0.5, y = old_player.y or 0.7,
          vx = 0, vy = 0, face = old_player.face or -1
        }
        state.slot_order[slot] = bot_id
      end
    end
    state.order = ordered_players(state)
    broadcast_state(dispatcher, state)
    return state
  end

  local ids = ordered_players(state)
  if state.tournament_mode then
    local owner = state.owner_id and state.players[state.owner_id] or nil
    if owner and not owner.connected then
      local successor = nil
      for _, user_id in ipairs(ids) do
        local candidate = state.players[user_id]
        if candidate and not candidate.is_bot then successor = user_id break end
      end
      state.owner_id = successor
      state.host_user_id = successor
      if not successor then state.status = "closed" end
    end
    if #ids == 0 then state.status = "closed" end
  end
  if state.status == "playing" and #ids < #previous_order then
    local previous_scores = state.scores or {}
    local previous_tagger = previous_order[state.tagged]
    local remapped_scores, remapped_tagger = {}, 1
    local previous_tagger_connected = false
    for slot, user_id in ipairs(ids) do
      for old_slot, old_user_id in ipairs(previous_order) do
        if old_user_id == user_id then remapped_scores[slot] = previous_scores[old_slot] or 0 end
        if old_user_id == previous_tagger and old_user_id == user_id then
          remapped_tagger = slot
          previous_tagger_connected = true
        end
      end
    end
    state.scores = remapped_scores
    state.tagged = remapped_tagger

    if #ids == 0 then
      state.status = "closed"
    elseif #ids == 1 then
      finish_match(state, 1, "opponent_disconnected")
    elseif not previous_tagger_connected then
      state.tag_cooldown = math.max(state.tag_cooldown or 0, 1)
    end
  elseif state.status == "countdown" and #ids < state.target_count then
    if #ids >= 2 then
      state.target_count = #ids
    else
      state.status = "closed"
      state.end_reason = "player_disconnected_before_start"
    end
  end

  broadcast_state(dispatcher, state)
  return state
end

function M.match_loop(context, dispatcher, tick, state, messages)
  local dt = 1 / TICK_RATE

  for _, message in ipairs(messages) do
    if message.op_code == 0 then
      local ok, data = pcall(nk.json_decode, message.data or "")
      if ok and data then accept_player_snapshot(state, message.sender, data, tick) end
    end
    -- Client opcode 1 (old host-owned round state) and opcode 2 (old client start)
    -- are intentionally ignored. The server starts, scores and ends the round.
  end

  if state.status == "countdown" then
    state.countdown = math.max(0, (state.countdown or 0) - dt)
    if state.countdown <= 0 then
      state.status = "playing"
      state.remaining = state.length
      state.tag_cooldown = 2
      nk.logger_info("TAG! authoritative round started: " .. tostring(context.match_id))
    end
  elseif state.status == "playing" then
    if state.tournament_mode or state.bot_match then
      for slot, user_id in ipairs(ordered_players(state)) do
        local bot = state.players[user_id]
        if bot and bot.is_bot then
          local target = nil
          if state.mode == "infection" then
            for _, other_id in ipairs(ordered_players(state)) do
              local other = state.players[other_id]
              if other and not other.is_bot and other.connected and ((state.infected[user_id] and not state.infected[other_id]) or (not state.infected[user_id] and state.infected[other_id])) then
                target = other
                break
              end
            end
          elseif slot == state.tagged then
            for _, other_id in ipairs(ordered_players(state)) do
              local other = state.players[other_id]
              if other and not other.is_bot and other.connected then target = other break end
            end
          else
            local holder = state.players[(state.order or {})[state.tagged]]
            if holder then target = holder end
          end
          bot.x = bot.x or math.random(15, 85) / 100
          bot.y = bot.y or math.random(15, 85) / 100
          if target and target.x and target.y then
            local dx, dy = target.x - bot.x, target.y - bot.y
            local distance = math.sqrt(dx * dx + dy * dy)
            if distance > 0.001 then
              local direction = 1
              if state.mode == "infection" and not state.infected[user_id] then
                direction = -1
              elseif state.mode ~= "infection" and slot ~= state.tagged then
                direction = -1
              end
              local speed = 0.24 * dt * direction
              bot.vx = (dx / distance) * 0.24 * direction
              bot.vy = (dy / distance) * 0.24 * direction
              bot.x = clamp(bot.x + (dx / distance) * speed, 0.04, 0.96)
              bot.y = clamp(bot.y + (dy / distance) * speed, 0.06, 0.94)
            end
          end
        end
      end
    end
    state.remaining = math.max(0, state.remaining - dt)
    state.tag_cooldown = math.max(0, state.tag_cooldown - dt)
    state.score_tick = (state.score_tick or 0) + dt
    while state.score_tick >= 1 do
      state.score_tick = state.score_tick - 1
      local ids = ordered_players(state)
      for slot = 1, #ids do
        if slot ~= state.tagged then state.scores[slot] = (state.scores[slot] or 0) + 1 end
      end
    end

    try_tag(state)
    if state.status == "playing" and state.remaining <= 0 then
      finish_match(state, calculate_winner(state), "time")
    end
  end

  if state.status ~= "closed" then broadcast_state(dispatcher, state) end
  return state
end

function M.match_terminate(context, dispatcher, tick, state, grace_seconds)
  nk.logger_info("TAG! match terminated: " .. tostring(context.match_id))
  return state
end

function M.match_signal(context, dispatcher, tick, state, data)
  local ok, signal = pcall(nk.json_decode, data or "")
  if not ok or type(signal) ~= "table" then return state, nk.json_encode({ ok = false, error = "Invalid tournament signal." }) end
  if signal.action == "public_map_status" then
    if not state.public_map then
      return state, nk.json_encode({ ok = false, joinable = false, error = "Not a public map match." })
    end
    local bots = 0
    for _, player in pairs(state.players) do
      if player and player.connected and player.is_bot then bots = bots + 1 end
    end
    return state, nk.json_encode({
      ok = true,
      status = state.status,
      bots = bots,
      joinable = (state.status == "countdown" or state.status == "playing") and bots > 0
    })
  end
  if signal.action == "start_tournament" then
    if not state.tournament_mode then return state, nk.json_encode({ ok = false, error = "This is not a community tournament." }) end
    if signal.user_id ~= state.owner_id then return state, nk.json_encode({ ok = false, error = "Only the host can start this tournament." }) end
    if state.status ~= "lobby" then return state, nk.json_encode({ ok = false, error = "This tournament has already started." }) end
    local humans = ordered_players(state)
    if #humans < 1 then return state, nk.json_encode({ ok = false, error = "At least one player must join first." }) end
    local bot_number = 1
    while #humans < MAX_PLAYERS do
      local bot_id = "tagbot_" .. tostring(state.match_id):gsub("[^%w]", ""):sub(1, 10) .. "_" .. tostring(bot_number)
      if not state.players[bot_id] then
        state.players[bot_id] = {
          user_id = bot_id,
          username = ({ "IRON BOT", "WAR BOT", "VOID BOT", "STORM BOT" })[bot_number] or ("ARENA BOT " .. bot_number),
          is_bot = true, connected = true, tags = 0, violations = 0,
          x = math.random(15, 85) / 100, y = math.random(15, 85) / 100,
          vx = 0, vy = 0, face = 1
        }
        table.insert(humans, bot_id)
      end
      bot_number = bot_number + 1
    end
    state.target_count = MAX_PLAYERS
    state.status = "countdown"
    state.countdown = 3
    state.remaining = state.length
    state.tagged = 1
    state.tag_cooldown = 3
    state.scores = {}
    state.infected = {}
    for slot, user_id in ipairs(ordered_players(state)) do
      state.scores[slot] = 0
      if slot == 1 and state.mode == "infection" then state.infected[user_id] = true end
    end
    dispatcher.match_label_update("TAG_TOURNAMENT_DONE|" .. state.tournament_title:gsub("|", " "))
    broadcast_state(dispatcher, state)
    return state, nk.json_encode({ ok = true, message = "Tournament started with bots filling the open slots." })
  end
  return state, data
end

local function matchmaker_matched(context, matched_users)
  if not matched_users or #matched_users < 2 or #matched_users > MAX_PLAYERS then
    nk.logger_warn("TAG! Matchmaker callback received an invalid roster")
    return nil
  end

  local first_user = matched_users[1] or {}
  local first = first_user.properties or first_user.string_properties or {}
  local mode = first.mode == "infection" and "infection" or "classic"
  local map = tostring(first.map or "random"):sub(1, 32)
  local length = clamp(math.floor(valid_number(first.length) or DEFAULT_LENGTH), 60, 1800)
  local modifiers = clean_modifiers(first.modifiers)
  local ids = {}
  for _, entry in ipairs(matched_users) do
    local user_id = entry.user_id or
      (entry.presence and entry.presence.user_id) or
      (entry.user and entry.user.id)
    if user_id then table.insert(ids, user_id) end
  end
  table.sort(ids)

  nk.logger_info("TAG! Matchmaker callback accepted roster size=" .. tostring(#matched_users) ..
    " resolved_users=" .. tostring(#ids) .. " mode=" .. mode .. " map=" .. map)
  local match_id = nk.match_create("tag_match", {
    created_by = "matchmaker",
    mode = mode,
    map = map,
    length = length,
    modifiers = modifiers,
    expected_users = matched_users,
    owner_id = ids[1]
  })
  nk.logger_info("TAG! Matchmaker created authoritative match " .. tostring(match_id))
  return match_id
end

local function create_private_match(context, payload)
  local options = {}
  if payload and payload ~= "" then options = nk.json_decode(payload) or {} end
  local mode = options.mode == "infection" and "infection" or "classic"
  local map = tostring(options.map or "random"):sub(1, 32)
  local length = clamp(math.floor(valid_number(options.length) or DEFAULT_LENGTH), 60, 1800)
  local modifiers = clean_modifiers(options.modifiers)
  local match_id = nk.match_create("tag_match", {
    created_by = "private_room",
    owner_id = context.user_id,
    mode = mode,
    map = map,
    length = length,
    modifiers = modifiers,
    target_count = 2
  })
  return nk.json_encode({
    match_id = match_id,
    owner_id = context.user_id,
    mode = mode,
    map = map,
    length = length,
    modifiers = modifiers
  })
end

local function create_bot_match(context, payload)
  local options = {}
  if payload and payload ~= "" then options = nk.json_decode(payload) or {} end
  local mode = options.mode == "infection" and "infection" or "classic"
  local map = tostring(options.map or "random"):sub(1, 32)
  local length = clamp(math.floor(valid_number(options.length) or DEFAULT_LENGTH), 60, 1800)
  local modifiers = clean_modifiers(options.modifiers)
  local match_id = nk.match_create("tag_match", {
    created_by = "quick_match_bot_fallback",
    owner_id = context.user_id,
    mode = mode,
    map = map,
    length = length,
    modifiers = modifiers,
    bot_match = true,
    target_count = 2
  })
  return nk.json_encode({
    match_id = match_id, owner_id = context.user_id,
    mode = mode, map = map, length = length,
    modifiers = modifiers, bot_match = true
  })
end

local function ensure_elo_account(context, payload)
  if not context.user_id then error("Sign in before checking your ELO.") end
  local ok, records, owner_records = pcall(
    nk.leaderboard_records_list, LEADERBOARD_ELO, { context.user_id }, 1, "", 0
  )
  if not ok then error("Could not read your ELO: " .. tostring(records)) end
  local existing = (owner_records and owner_records[1]) or (records and records[1])
  local elo = existing and tonumber(existing.score) or nil
  if not elo then
    local wrote, result, err = pcall(
      nk.leaderboard_record_write, LEADERBOARD_ELO, context.user_id,
      context.username or "TAG! Player", 100, 0, { game = "TAG!", placement = "starting_elo" }, "set"
    )
    if not wrote then error("Could not initialize your ELO: " .. tostring(result)) end
    if err then error("Could not initialize your ELO: " .. tostring(err)) end
    elo = 100
  end
  return nk.json_encode({ ok = true, elo = elo })
end

local function publish_public_map(context, payload)
  if not context.user_id then error("Sign in before publishing a map.") end
  local request = {}
  if payload and payload ~= "" then request = nk.json_decode(payload) or {} end
  local level = sanitize_public_level(request.level)
  local key = context.user_id .. "_" .. level.id
  local record = {
    owner_id = context.user_id,
    creator = context.username or "TAG! Player",
    name = level.name,
    description = level.description,
    object_count = #level.objects,
    updated_at = os.time(),
    level = level
  }
  local ok, acks, err = pcall(nk.storage_write, {{
    collection = PUBLIC_MAPS_COLLECTION,
    key = key,
    user_id = context.user_id,
    value = record,
    version = "*",
    permission_read = 2,
    permission_write = 0
  }})
  if not ok then error("Could not publish this map: " .. tostring(acks)) end
  if err then error("Could not publish this map: " .. tostring(err)) end
  return nk.json_encode({ ok = true, key = key, owner_id = context.user_id, name = level.name })
end

local function list_public_maps(context, payload)
  local request = {}
  if payload and payload ~= "" then request = nk.json_decode(payload) or {} end
  local query = tostring(request.query or ""):lower():sub(1, 64)
  local objects, cursor, err = nk.storage_list("", PUBLIC_MAPS_COLLECTION, 100, "", context.user_id)
  if err then error(err) end
  local maps = {}
  for _, object in ipairs(objects or {}) do
    local value = object.value or {}
    local name = tostring(value.name or "")
    local description = tostring(value.description or "")
    local creator = tostring(value.creator or "TAG! Player")
    local haystack = (name .. " " .. description .. " " .. creator):lower()
    if query == "" or haystack:find(query, 1, true) then
      table.insert(maps, {
        key = object.key,
        owner_id = object.user_id,
        name = name,
        description = description,
        creator = creator,
        object_count = tonumber(value.object_count) or 0,
        updated_at = tonumber(value.updated_at) or 0
      })
    end
  end
  table.sort(maps, function(a, b) return (a.updated_at or 0) > (b.updated_at or 0) end)
  return nk.json_encode({ maps = maps, next_cursor = cursor })
end

local function start_public_map_match(context, payload)
  local request = {}
  if payload and payload ~= "" then request = nk.json_decode(payload) or {} end
  local owner_id = tostring(request.owner_id or "")
  local key = tostring(request.key or "")
  if owner_id == "" or key == "" or #key > 128 then error("Choose a published TAG! map first.") end
  local objects, read_err = nk.storage_read({{
    collection = PUBLIC_MAPS_COLLECTION,
    key = key,
    user_id = owner_id
  }})
  if read_err then error(read_err) end
  if not objects or not objects[1] then error("That online map is no longer available.") end
  local stored = objects[1].value or {}
  local level = sanitize_public_level(stored.level)
  local label = "TAG_PUBLIC_MAP|" .. key
  local ok, matches, list_err = pcall(nk.match_list, 50, true, label, 1, MAX_PLAYERS)
  if ok then
    for _, item in ipairs(matches or {}) do
      local signal_ok, _, response, signal_err = pcall(
        nk.match_signal, item.match_id, nk.json_encode({ action = "public_map_status" })
      )
      if signal_ok and not signal_err and response then
        local decoded_ok, info = pcall(nk.json_decode, response)
        if decoded_ok and info and info.joinable then
          return nk.json_encode({ match_id = item.match_id, map_name = level.name, joined_existing = true })
        end
      end
    end
  elseif list_err then
    nk.logger_warn("TAG! public map match search failed: " .. tostring(matches))
  end

  local match_id = nk.match_create("tag_match", {
    created_by = "public_map",
    owner_id = context.user_id,
    public_map = true,
    bot_match = true,
    custom_map = level,
    public_map_key = key,
    mode = "classic",
    map = level.id,
    length = 120,
    target_count = MAX_PLAYERS
  })
  if not match_id then error("The server could not create a public map match.") end
  return nk.json_encode({ match_id = match_id, map_name = level.name, joined_existing = false })
end

local function online_player_count()
  local presences, err = nk.stream_user_list(ONLINE_STREAM, false, true)
  if err then error(err) end
  local unique = {}
  for _, presence in ipairs(presences or {}) do
    if presence.user_id then unique[presence.user_id] = true end
  end
  local count = 0
  for _ in pairs(unique) do count = count + 1 end
  return count
end

local function register_online_presence(context, payload)
  if not context.user_id or not context.session_id then
    error("A valid online session is required.")
  end
  local existing, get_err = nk.stream_user_get(context.user_id, context.session_id, ONLINE_STREAM)
  if get_err then error(get_err) end
  if not existing then
    local joined, join_err = nk.stream_user_join(
      context.user_id,
      context.session_id,
      ONLINE_STREAM,
      false,
      false,
      "TAG! Online"
    )
    if not joined and join_err then error(join_err) end
  end
  return nk.json_encode({ online_count = online_player_count() })
end

local function unregister_online_presence(context, payload)
  if context.user_id and context.session_id then
    local leave_err = nk.stream_user_leave(context.user_id, context.session_id, ONLINE_STREAM)
    if leave_err then error(leave_err) end
  end
  return nk.json_encode({ online_count = online_player_count() })
end

local function get_online_player_count(context, payload)
  return nk.json_encode({ online_count = online_player_count() })
end

local function create_tournament(context, payload)
  local options = {}
  if payload and payload ~= "" then options = nk.json_decode(payload) or {} end
  local title = tostring(options.title or "Community Tournament"):gsub("|", " "):sub(1, 32)
  local mode = options.mode == "infection" and "infection" or "classic"
  local map = tostring(options.map or "random"):sub(1, 32)
  local length = clamp(math.floor(valid_number(options.length) or DEFAULT_LENGTH), 60, 1800)
  local match_id = nk.match_create("tag_match", {
    created_by = "community_tournament",
    tournament_mode = true,
    tournament_title = title,
    owner_id = context.user_id,
    mode = mode,
    map = map,
    length = length
  })
  return nk.json_encode({ match_id = match_id, title = title, mode = mode, map = map, owner_id = context.user_id })
end

local function list_tournaments(context, payload)
  local matches, err = nk.match_list(50, true, nil, 1, MAX_PLAYERS)
  if err then error(err) end
  local tournaments = {}
  for _, item in ipairs(matches or {}) do
    local label = tostring(item.label or "")
    local title, mode, map = label:match("^TAG_TOURNAMENT|([^|]*)|([^|]*)|([^|]*)$")
    if title then
      table.insert(tournaments, {
        match_id = item.match_id,
        title = title,
        mode = mode,
        map = map,
        players = tonumber(item.size or item.presence_count or 1) or 1,
        max_players = MAX_PLAYERS
      })
    end
  end
  return nk.json_encode({ tournaments = tournaments })
end

local function start_tournament(context, payload)
  local options = {}
  if payload and payload ~= "" then options = nk.json_decode(payload) or {} end
  local match_id = tostring(options.match_id or "")
  if match_id == "" then error("Tournament match ID is required.") end
  local _, response, err = nk.match_signal(match_id, nk.json_encode({
    action = "start_tournament",
    user_id = context.user_id
  }))
  if err then error(err) end
  return response or nk.json_encode({ ok = true })
end

nk.register_matchmaker_matched(matchmaker_matched)
nk.register_rpc(create_private_match, "tag_create_private_match")
nk.register_rpc(create_bot_match, "tag_create_bot_match")
nk.register_rpc(create_tournament, "tag_create_tournament")
nk.register_rpc(list_tournaments, "tag_list_tournaments")
nk.register_rpc(start_tournament, "tag_start_tournament")
nk.register_rpc(register_online_presence, "tag_online_presence")
nk.register_rpc(unregister_online_presence, "tag_online_leave")
nk.register_rpc(get_online_player_count, "tag_online_count")
nk.register_rpc(ensure_elo_account, "tag_ensure_elo")
nk.register_rpc(publish_public_map, "tag_publish_map")
nk.register_rpc(list_public_maps, "tag_list_public_maps")
nk.register_rpc(start_public_map_match, "tag_start_public_map_match")

nk.run_once(function(context)
  local leaderboard_ids = { LEADERBOARD_WINS, LEADERBOARD_LOSSES, LEADERBOARD_MATCHES, LEADERBOARD_TAGS, LEADERBOARD_ELO, LEADERBOARD_TAGPOINTS }
  for _, id in ipairs(leaderboard_ids) do
    local operator = id == LEADERBOARD_ELO and "set" or "incr"
    local err = nk.leaderboard_create(id, true, "desc", operator, "", {}, true)
    if err then
      nk.logger_error("TAG! authoritative leaderboard setup failed for " .. id .. ": " .. tostring(err))
    else
      nk.logger_info("TAG! authoritative leaderboard available: " .. id)
    end
  end

  local tournament_error = nk.tournament_create(
    WEEKLY_TOURNAMENT, true, "desc", "incr", 604800, "0 0 * * 1", {},
    "TAG! Weekly", "Win TAG! online rounds this week.", 1, 0, 0,
    10000, 100000, false, true
  )
  if tournament_error then
    nk.logger_error("TAG! authoritative tournament setup failed: " .. tostring(tournament_error))
  else
    nk.logger_info("TAG! authoritative weekly tournament available")
  end
end)

return M
