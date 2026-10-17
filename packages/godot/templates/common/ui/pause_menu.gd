extends CanvasLayer
## Pause menu (Esc): resume, save, back to the main menu or quit.

const UiKit := preload("res://ui/ui_kit.gd")
const MENU_SCENE := "res://ui/main_menu.tscn"

var _root: Control


func _ready() -> void:
	layer = 20
	process_mode = Node.PROCESS_MODE_ALWAYS
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.visible = false
	add_child(_root)

	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.6)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.add_child(dim)

	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 10)
	column.add_child(UiKit.label("Paused", 32))
	column.add_child(UiKit.button("Resume", resume))
	if GameState.has_feature("save_system"):
		column.add_child(UiKit.button("Save game", _on_save))
	if ResourceLoader.exists(MENU_SCENE):
		column.add_child(UiKit.button("Main menu", _on_menu))
	column.add_child(UiKit.button("Quit", func() -> void: get_tree().quit()))
	var panel := UiKit.panel()
	panel.add_child(column)
	_root.add_child(UiKit.centered(panel))


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") and not GameState.is_game_over:
		if _root.visible:
			resume()
		else:
			pause()
		get_viewport().set_input_as_handled()


func pause() -> void:
	_root.visible = true
	get_tree().paused = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func resume() -> void:
	_root.visible = false
	get_tree().paused = false
	if str(GameState.config.get("dimension", "3d")) == "3d":
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _on_save() -> void:
	if SaveSystem.save_game():
		GameState.post_message("Game saved.")
	resume()


func _on_menu() -> void:
	get_tree().paused = false
	get_tree().change_scene_to_file(MENU_SCENE)
