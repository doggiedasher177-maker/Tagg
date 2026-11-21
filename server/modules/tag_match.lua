local nk = require("nakama")
local M = {}

nk.logger_info("TAG! Lua runtime module evaluated")

function M.match_init(context, params)
  local state = {
    players = {},
    started_at = os.time(),
    mode = (params and params.mode) or "classic",
    map = (params and params.map) or "random",
    length = (params and params.length) or 120
  }
  return state, 10, "TAG! authoritative match"
end

function M.match_join_attempt(context, dispatcher, tick, state, presence, metadata)
  local count = 0
  for _ in pairs(state.players) do count = count + 1 end
  if count >= 4 then
    return state, false, "This TAG! room is full."
  end
  return state, true
end

function M.match_join(context, dispatcher, tick, state, presences)
  for _, presence in ipairs(presences) do
    state.players[presence.session_id] = {
      user_id = presence.user_id,
      session_id = presence.session_id,
      username = presence.username,
      joined_tick = tick
    }
  end
  return state
end

function M.match_leave(context, dispatcher, tick, state, presences)
  for _, presence in ipairs(presences) do
    state.players[presence.session_id] = nil
  end
  return state
end

function M.match_loop(context, dispatcher, tick, state, messages)
  for _, message in ipairs(messages) do
    local op = message.op_code
    if op == 0 or op == 1 or op == 2 then
      -- Nakama is authoritative for room membership and packet distribution.
      -- Player physics/tag resolution will be moved server-side in the next hardening pass.
      dispatcher.broadcast_message(op, message.data, nil, message.sender)
    end
  end
  return state
end

function M.match_terminate(context, dispatcher, tick, state, grace_seconds)
  return state
end

function M.match_signal(context, dispatcher, tick, state, data)
  return state, data
end

local function matchmaker_matched(context, matched_users)
  if not matched_users or #matched_users < 2 or #matched_users > 4 then
    return nil
  end

  local first = matched_users[1].properties or {}
  local mode = first.mode or "classic"
  local map = first.map or "random"
  local length = tonumber(first.length) or 120

  return nk.match_create("tag_match", {
    created_by = "matchmaker",
    mode = mode,
    map = map,
    length = length,
    expected_users = matched_users
  })
end

local function create_private_match(context, payload)
  local options = {}
  if payload and payload ~= "" then
    options = nk.json_decode(payload) or {}
  end

  local match_id = nk.match_create("tag_match", {
    created_by = "private_room",
    owner_id = context.user_id,
    mode = options.mode or "classic",
    map = options.map or "random",
    length = tonumber(options.length) or 120
  })

  return nk.json_encode({
    match_id = match_id,
    mode = options.mode or "classic",
    map = options.map or "random"
  })
end

-- Lua modules are evaluated directly at startup. Register hooks at file scope.
nk.register_matchmaker_matched(matchmaker_matched)
nk.register_rpc(create_private_match, "tag_create_private_match")

-- Run dynamic scoreboards once, rather than relying on an InitModule export
-- (that initialization convention belongs to the other Nakama runtimes).
nk.run_once(function(context)
  local leaderboard_error = nk.leaderboard_create(
    "tag_online_wins", false, "desc", "incr", "", {}, true
  )
  if leaderboard_error then
    nk.logger_info("TAG! leaderboard creation failed: " .. tostring(leaderboard_error))
  else
    nk.logger_info("TAG! leaderboard tag_online_wins created/available")
  end

  local tournament_error = nk.tournament_create(
    "tag_weekly", false, "desc", "incr", 604800, "0 0 * * 1", {},
    "TAG! Weekly", "Win TAG! online rounds this week.", 1, 0, 0,
    10000, 100000, false, true
  )
  if tournament_error then
    nk.logger_info("TAG! tournament creation failed: " .. tostring(tournament_error))
  else
    nk.logger_info("TAG! tournament tag_weekly created/available")
  end

  local leaderboards, leaderboard_list_error = nk.leaderboard_list(100)
  if leaderboard_list_error then
    nk.logger_info("TAG! leaderboard list failed: " .. tostring(leaderboard_list_error))
  else
    local found = false
    for _, entry in ipairs(leaderboards or {}) do
      if entry.id == "tag_online_wins" then found = true end
    end
    nk.logger_info("TAG! leaderboard visible=" .. tostring(found))
  end

  local tournaments, tournament_list_error = nk.tournament_list(0, 127, 0, 0, 100)
  if tournament_list_error then
    nk.logger_info("TAG! tournament list failed: " .. tostring(tournament_list_error))
  else
    local found = false
    for _, entry in ipairs(tournaments or {}) do
      if entry.id == "tag_weekly" then found = true end
    end
    nk.logger_info("TAG! weekly tournament visible=" .. tostring(found))
  end
end)

return M
