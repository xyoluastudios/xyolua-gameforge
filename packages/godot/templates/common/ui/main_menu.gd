extends Control
## Main menu: start, continue (when a save exists) and quit.

const UiKit := preload("res://ui/ui_kit.gd")
const GAME_SCENE := "res://scenes/main.tscn"


func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	get_tree().paused = false
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	var background := ColorRect.new()
	background.color = Color(0.03, 0.035, 0.045)
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(background)

	var column := VBoxContainer.new()
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	column.add_theme_constant_override("separation", 14)
	column.add_child(UiKit.label(str(GameState.config.get("title", "Untitled Game")), 56))
	column.add_child(UiKit.label(str(GameState.config.get("tagline", "")), 18, UiKit.MUTED))
	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(0, 24)
	column.add_child(spacer)

	var play := UiKit.button("Play", _on_play)
	column.add_child(play)
	if GameState.has_feature("save_system") and SaveSystem.has_save():
		column.add_child(UiKit.button("Continue", _on_continue))
	column.add_child(UiKit.button("Quit", _on_quit))
	column.add_child(spacer.duplicate())
	column.add_child(UiKit.label("Made with XyoLua GameForge", 12, UiKit.MUTED))
	add_child(UiKit.centered(column))
	play.grab_focus.call_deferred()


func _on_play() -> void:
	get_tree().change_scene_to_file(GAME_SCENE)


func _on_continue() -> void:
	SaveSystem.load_on_start = true
	get_tree().change_scene_to_file(GAME_SCENE)


func _on_quit() -> void:
	get_tree().quit()
