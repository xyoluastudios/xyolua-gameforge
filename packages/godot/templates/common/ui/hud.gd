extends CanvasLayer
## Heads-up display: health, flashlight battery, inventory, objective and messages.

const UiKit := preload("res://ui/ui_kit.gd")
const VIGNETTE_SHADER := "res://shaders/vignette.gdshader"

var _health_bar := ProgressBar.new()
var _battery_bar: ProgressBar
var _inventory_label := UiKit.label("", 15, UiKit.MUTED)
var _message_label := UiKit.label("", 20)
var _objective_label := UiKit.label("", 16, UiKit.MUTED)
var _message_tween: Tween


func _ready() -> void:
	layer = 5
	_build()
	GameState.health_changed.connect(_on_health_changed)
	GameState.battery_changed.connect(_on_battery_changed)
	GameState.inventory_changed.connect(_on_inventory_changed)
	GameState.message_posted.connect(show_message)
	_on_health_changed(GameState.health, GameState.max_health)
	_on_inventory_changed()


func _build() -> void:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	var is_3d := str(GameState.config.get("dimension", "3d")) == "3d"
	if is_3d and ResourceLoader.exists(VIGNETTE_SHADER):
		var vignette := ColorRect.new()
		vignette.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var material := ShaderMaterial.new()
		material.shader = load(VIGNETTE_SHADER) as Shader
		material.set_shader_parameter("strength", float(GameState.get_setting("world", "vignette", 0.5)))
		vignette.material = material
		root.add_child(vignette)

	var stats := VBoxContainer.new()
	stats.position = Vector2(24, 20)
	stats.custom_minimum_size = Vector2(240, 0)
	stats.add_theme_constant_override("separation", 6)
	root.add_child(stats)
	stats.add_child(UiKit.label("HEALTH", 12, UiKit.MUTED))
	_style_bar(_health_bar, Color(0.78, 0.2, 0.22))
	stats.add_child(_health_bar)
	if GameState.has_feature("flashlight"):
		stats.add_child(UiKit.label("FLASHLIGHT  [F]", 12, UiKit.MUTED))
		_battery_bar = ProgressBar.new()
		_style_bar(_battery_bar, Color(0.95, 0.8, 0.35))
		_battery_bar.value = 100.0
		stats.add_child(_battery_bar)
	stats.add_child(_inventory_label)

	_objective_label.text = GameState.get_text("objective", "Find the exit.")
	_objective_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_objective_label.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_objective_label.position.y = 18
	_objective_label.grow_horizontal = Control.GROW_DIRECTION_BOTH
	root.add_child(_objective_label)

	_message_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_message_label.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	_message_label.position.y -= 90
	_message_label.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_message_label.modulate.a = 0.0
	root.add_child(_message_label)

	if is_3d:
		var crosshair := UiKit.label("·", 28)
		crosshair.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
		crosshair.grow_horizontal = Control.GROW_DIRECTION_BOTH
		crosshair.grow_vertical = Control.GROW_DIRECTION_BOTH
		root.add_child(crosshair)

	var hint := UiKit.label(GameState.get_text("controls", ""), 12, UiKit.MUTED)
	hint.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	hint.position = Vector2(24, hint.position.y - 32)
	root.add_child(hint)


func _style_bar(bar: ProgressBar, color: Color) -> void:
	bar.show_percentage = false
	bar.custom_minimum_size = Vector2(240, 10)
	bar.max_value = 100.0
	var fill := StyleBoxFlat.new()
	fill.bg_color = color
	fill.set_corner_radius_all(3)
	var background := StyleBoxFlat.new()
	background.bg_color = Color(0, 0, 0, 0.55)
	background.set_corner_radius_all(3)
	bar.add_theme_stylebox_override("fill", fill)
	bar.add_theme_stylebox_override("background", background)


func show_message(text: String) -> void:
	_message_label.text = text
	if _message_tween:
		_message_tween.kill()
	_message_label.modulate.a = 1.0
	_message_tween = create_tween()
	_message_tween.tween_interval(2.5)
	_message_tween.tween_property(_message_label, "modulate:a", 0.0, 0.8)


func _on_health_changed(current: int, maximum: int) -> void:
	_health_bar.value = 100.0 * float(current) / float(maxi(maximum, 1))


func _on_battery_changed(percent: float) -> void:
	if _battery_bar:
		_battery_bar.value = percent * 100.0


func _on_inventory_changed() -> void:
	var names := GameState.item_display_names()
	_inventory_label.text = "Items: %s" % (", ".join(names) if not names.is_empty() else "—")
