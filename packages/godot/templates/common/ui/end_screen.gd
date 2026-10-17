extends CanvasLayer
## Shown when the player wins or dies: retry or go back to the menu.

const UiKit := preload("res://ui/ui_kit.gd")
const MENU_SCENE := "res://ui/main_menu.tscn"

var _root: Control
var _title := UiKit.label("", 40)
var _subtitle := UiKit.label("", 18, UiKit.MUTED)
var _retry: Button


func _ready() -> void:
	layer = 30
	process_mode = Node.PROCESS_MODE_ALWAYS
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.visible = false
	add_child(_root)

	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.75)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.add_child(dim)

	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	column.add_child(_title)
	column.add_child(_subtitle)
	_retry = UiKit.button("Try again", _on_retry)
	column.add_child(_retry)
	if ResourceLoader.exists(MENU_SCENE):
		column.add_child(UiKit.button("Main menu", _on_menu))
	var panel := UiKit.panel()
	panel.add_child(column)
	_root.add_child(UiKit.centered(panel))

	GameState.player_died.connect(func() -> void: show_result(false))
	GameState.level_completed.connect(func() -> void: show_result(true))


func show_result(won: bool) -> void:
	_title.text = GameState.get_text("win_title", "You escaped") if won else GameState.get_text("lose_title", "You died")
	_subtitle.text = GameState.get_text("win", "") if won else GameState.get_text("lose", "")
	if won:
		AudioManager.play("win")
	_root.visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	get_tree().paused = true
	_retry.grab_focus.call_deferred()


func _on_retry() -> void:
	get_tree().paused = false
	get_tree().reload_current_scene()


func _on_menu() -> void:
	get_tree().paused = false
	get_tree().change_scene_to_file(MENU_SCENE)
