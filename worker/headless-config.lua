-- Installed only in Flea's isolated write directory, refreshed for every replay.
-- Zero-K reads this before enumerating widgets. Keep its call-in dispatcher,
-- but do not load the lobby, Chili, graphics, audio, or gameplay UI widgets.
-- Later config reads use an empty environment, so guard access to VFS.
if VFS then
  local originalDirList = VFS.DirList
  VFS.DirList = function(directory, pattern, mode, ...)
    if type(directory) == 'string' and directory:gsub('\\', '/'):lower():gsub('/+$', '') == 'luaui/widgets' and pattern == '*.lua' then
      VFS.DirList = originalDirList
      Spring.Echo('Flea headless profile: exporter-only widget list')
      return {'LuaUI/Widgets/flea_export.lua'}
    end
    return originalDirList(directory, pattern, mode, ...)
  end
end
return {
  version = 9,
  ['Local Widgets Config'] = {
    useLocalWidgets = true,
    useLocalWidgetsFirst = true,
  },
}
