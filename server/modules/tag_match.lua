local nk = require("nakama")

local function match_init(context, params)
  return {
    state = { players = {}, started_at = os.time(), last_state = nil },
    tick_rate = 10,
    label = "TAG! online match"
  }
end

local function match_join_attempt(context, dispatcher, tick, state, presence, metadata)
  if #state.players >= 4 then
    return state, false, "This TAG! room is full."
  end
  return state, true
end

local function match_join(context, dispatcher, tick, state, presences)
  for _, p in ipairs(presences) do
    state.players[p.user_id] = { username = p.username, joined = tick }
  end
  dispatcher.broadcast_message(10, nk.json_encode({
    type = "presence",
    count = (function() local n=0 for _ in pairs(state.players) do n=n+1 end return n end)()
  }), nil, nil, true)
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
      -- TAG! clients exchange movement snapshots and round state through
      -- the Nakama match dispatcher. Server membership and message routing
      -- remain authoritative; gameplay simulation is currently client-hosted.
      dispatcher.broadcast_message(op, message.data, message.sender, nil, true)
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
  local match_id = nk.match_create("tag_match", { created_by = "matchmaker" })
  return match_id
end

local function InitModule(ctx, logger, nk_api, initializer)
  if not nk.leaderboard_get("tag_online_wins") then
    nk.leaderboard_create("tag_online_wins", "reset_never", "asc", "set", {})
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
  logger_info = logger.info
  logger_info("TAG! Nakama runtime loaded")
end

return { InitModule = InitModule }
