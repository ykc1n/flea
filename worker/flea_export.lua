function widget:GetInfo()
  return {name="Flea Replay Export", desc="Structured full-view replay telemetry", author="Flea", license="MIT", layer=0, enabled=true}
end
local output
local initialized = false
local function encode(v)
  local t = type(v)
  if t == 'string' then
    return '"' .. v:gsub('\\','\\\\'):gsub('"','\\"'):gsub('[%z\1-\31]',function(c) return string.format('\\u%04x',string.byte(c)) end) .. '"'
  elseif t == 'boolean' or t == 'number' then return tostring(v)
  elseif t == 'table' then
    local values = {}
    for k,x in pairs(v) do values[#values+1] = encode(tostring(k)) .. ':' .. encode(x) end
    return '{' .. table.concat(values,',') .. '}'
  end
  return 'null'
end
local function emit(event)
  if output then
    event.time = Spring.GetGameFrame()/Game.gameSpeed
    output:write(encode(event) .. '\n')
  end
end
local function unitEvent(kind,id,def,team)
  local d = UnitDefs[def]
  local x,y,z = Spring.GetUnitPosition(id)
  emit({type=kind,unitId=id,unit=d.name,name=d.humanName,team=team,factory=d.isFactory or false,x=x,z=z})
end
function widget:Initialize()
  if not Spring.IsReplay() then widgetHandler:RemoveWidget(self); return end
  Spring.CreateDir('LuaUI/Logs')
  output = assert(io.open('LuaUI/Logs/flea-events.jsonl','w'))
  Spring.SendCommands('specfullview 3')
  Spring.SendCommands('setspeed 20')
end
function widget:GameFrame(frame)
  if not initialized then
    local spectating,fullView = Spring.GetSpectatingState()
    emit({type='meta',mapWidth=Game.mapSizeX,mapHeight=Game.mapSizeZ,map=Game.mapName,fullView=fullView,positionSampleSeconds=60})
    for _,id in ipairs(Spring.GetPlayerList()) do
      local name,active,spec,team,ally,ping,cpu,country,rank,custom = Spring.GetPlayerInfo(id,false)
      if not spec then emit({type='player',name=name,team=team,lobbyId=custom and custom.lobbyid,rank=rank}) end
    end
    initialized = true
  end
  -- Lifecycle events retain exact times; movement snapshots are once per minute.
  if frame % (Game.gameSpeed*60) == 0 then
    for _,id in ipairs(Spring.GetAllUnits()) do
      local def = Spring.GetUnitDefID(id)
      if def and UnitDefs[def].canMove then unitEvent('position',id,def,Spring.GetUnitTeam(id)) end
    end
    if output then output:flush() end
  end
end
function widget:UnitCreated(id,def,team) unitEvent('created',id,def,team) end
function widget:UnitFinished(id,def,team) unitEvent('finished',id,def,team) end
function widget:UnitDestroyed(id,def,team) unitEvent('destroyed',id,def,team) end
function widget:TeamDied(team) emit({type='team_died',team=team}) end
function widget:GameOver()
  emit({type='game_over'})
  if output then output:flush(); output:close(); output=nil end
  Spring.SendCommands('quitforce')
end
function widget:Shutdown() if output then output:close(); output=nil end end
