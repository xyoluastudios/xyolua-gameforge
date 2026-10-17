extends Node
## Bridge to the XyoLua GameForge desktop app (autoload "GameForgeBridge").
##
## Only active when GameForge starts the game with
## `-- --gameforge-preview=<file>`: it then writes a small screenshot of the
## running game twice per second so the editor can show a live preview.
## It does nothing in normal runs, in headless mode and in exported games.

const INTERVAL := 0.5
const MAX_WIDTH := 640
const ARG := "--gameforge-preview="

var _preview_path := ""
var _elapsed := 0.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with(ARG):
			_preview_path = arg.substr(ARG.length())
	if DisplayServer.get_name() == "headless" or OS.has_feature("template"):
		_preview_path = ""
	set_process(_preview_path != "")


func _process(delta: float) -> void:
	_elapsed += delta
	if _elapsed < INTERVAL:
		return
	_elapsed = 0.0
	var texture := get_viewport().get_texture()
	if texture == null:
		return
	var image := texture.get_image()
	if image == null or image.is_empty():
		return
	if image.get_width() > MAX_WIDTH:
		var scaled_height := int(image.get_height() * float(MAX_WIDTH) / float(image.get_width()))
		image.resize(MAX_WIDTH, scaled_height, Image.INTERPOLATE_BILINEAR)
	var temp_path := _preview_path + ".tmp.png"
	if image.save_png(temp_path) == OK:
		DirAccess.rename_absolute(temp_path, _preview_path)
