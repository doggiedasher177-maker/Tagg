local nk = require("nakama")

nk.logger_info("TAG! runtime module file evaluated")

local function match_init(context, params)
  return {
    state = { players = {}, started_at = os.time() },
    tick_rate = 10,
    label = "TAG! online match"
  }
end

local function match_join_attempt(context, dispatcher, tick, state, presence, metadata)
  local count = 0
  for _ in pairs(state.players) do count = count + 1 end
  if count >= 4 then return state, false, "This TAG! room is full." end
  return state, true
end

local function match_join(context, dispatcher, tick, state, presences)
  for _, p in ipairs(presences) do
    state.players[p.user_id] = { username = p.username, joined = tick }
  end
  return state
end

local function match_leave(context, dispatcher, tick, state, presences)
  for _, p in ipairs(presences) do state.players[p.user_id] = nil end
  return state
end

local function match_loop(context, dispatcher, tick, state, messages)
  for _, message in ipairs(messages) do
    local op = message.op_code
    if op == 0 or op == 1 or op == 2 then
      -- Nakama owns room membership and packet transport.
      -- Physics and tag validation remain client-hosted in this beta.
      dispatcher.broadcast_message(op, message.data, nil, message.sender, true)
    end
  end
  return state
end

local function match_terminate(context, dispatcher, tick, state, grace_seconds)
  return state
end

local function match_signal(context, dispatcher, tick, state, data)
  return state, data
end

local function matchmaker_matched(context, entries)
  return nk.match_create("tag_match", { created_by = "matchmaker" })
end

local function log_optional_error(label, ok, result, returned_error)
  if not ok then
    nk.logger_info("TAG! " .. label .. " raised: " .. tostring(result))
  elseif result ~= nil then
    nk.logger_info("TAG! " .. label .. " returned: " .. tostring(result))
  elseif returned_error ~= nil then
    nk.logger_info("TAG! " .. label .. " returned error: " .. tostring(returned_error))
  else
    nk.logger_info("TAG! " .. label .. " ready")
  end
end

local function InitModule(ctx, logger, nk_api, initializer)
  nk.logger_info("TAG! InitModule entered")

  -- Client-visible leaderboard for cumulative wins. Empty reset schedule = no reset.
  local lb_ok, lb_result, lb_error = pcall(function()
    return nk.leaderboard_create("tag_online_wins", false, "desc", "incr", "", {}, true)
  end)
  log_optional_error("leaderboard tag_online_wins", lb_ok, lb_result, lb_error)

  local lb_list_ok, lb_list, lb_list_error = pcall(nk.leaderboard_list, 100)
  if not lb_list_ok then
    nk.logger_info("TAG! leaderboard_list raised: " .. tostring(lb_list))
  elseif lb_list_error ~= nil then
    nk.logger_info("TAG! leaderboard_list error: " .. tostring(lb_list_error))
  else
    local found = false
    for _, entry in ipairs(lb_list or {}) do
      if entry.id == "tag_online_wins" then found = true end
    end
    nk.logger_info("TAG! leaderboard_list found tag_online_wins=" .. tostring(found))
  end

  local tournament_ok, tournament_result, tournament_error = pcall(function()
    return nk.tournament_create(
      "tag_weekly", false, "desc", "incr", 604800, "0 0 * * 1", {},
      "TAG! Weekly", "Win TAG! online rounds this week.", 1, 0, 0,
      10000, 100000, false, true
    )
  end)
  log_optional_error("tournament tag_weekly", tournament_ok, tournament_result, tournament_error)

  local tournaments_ok, tournaments, tournaments_error = pcall(nk.tournament_list, 0, 127, 0, 0, 100)
  if not tournaments_ok then
    nk.logger_info("TAG! tournament_list raised: " .. tostring(tournaments))
  elseif tournaments_error ~= nil then
    nk.logger_info("TAG! tournament_list error: " .. tostring(tournaments_error))
  else
    local found = false
    for _, entry in ipairs(tournaments or {}) do
      if entry.id == "tag_weekly" then found = true end
    end
    nk.logger_info("TAG! tournament_list found tag_weekly=" .. tostring(found))
  end

  initializer.register_match("tag_match", {
    match_init = match_init,
    match_join_attempt = match_join_attempt,
    match_join = match_join,
    match_leave = match_leave,
    match_loop = match_loop,
    match_terminate = match_terminate,
    match_signal = match_signal
  })
  initializer.register_matchmaker_matched(matchmaker_matched)
  nk.logger_info("TAG! match runtime and matchmaking hook registered")
end

return { InitModule = InitModule }
