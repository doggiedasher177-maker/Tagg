local nk = require("nakama")

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
      -- Room membership and transport are server-managed by Nakama.
      -- Gameplay simulation remains client-hosted for this first beta.
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

local function InitModule(ctx, logger, nk_api, initializer)
  -- Client-authoritative, descending win count; each verified client win adds 1.
  -- pcall makes restarts safe when the leaderboard already exists.
  pcall(nk.leaderboard_create, "tag_online_wins", false, "desc", "incr", nil, {})
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
  logger:info("TAG! Nakama runtime loaded")
end

return { InitModule = InitModule }
