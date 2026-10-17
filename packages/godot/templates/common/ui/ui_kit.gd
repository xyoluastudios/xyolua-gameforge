extends RefCounted
## Small helpers to build a consistent, readable UI in code.

const ACCENT := Color(0.91, 0.64, 0.23)
const TEXT := Color(0.88, 0.9, 0.93)
const MUTED := Color(0.55, 0.58, 0.63)
const PANEL := Color(0.06, 0.07, 0.09, 0.92)


static func label(text: String, size: int = 16, color: Color = TEXT) -> Label:
	var node := Label.new()
	node.text = text
	node.add_theme_font_size_override("font_size", size)
	node.add_theme_color_override("font_color", color)
	node.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	node.add_theme_constant_override("outline_size", 4)
	return node


static func button(text: String, on_pressed: Callable) -> Button:
	var node := Button.new()
	node.text = text
	node.custom_minimum_size = Vector2(240, 44)
	node.focus_mode = Control.FOCUS_ALL
	node.add_theme_font_size_override("font_size", 18)
	node.add_theme_stylebox_override("normal", _box(Color(0.12, 0.13, 0.16), Color(0.22, 0.24, 0.28)))
	node.add_theme_stylebox_override("hover", _box(Color(0.16, 0.17, 0.21), ACCENT))
	node.add_theme_stylebox_override("pressed", _box(Color(0.2, 0.16, 0.1), ACCENT))
	node.add_theme_stylebox_override("focus", _box(Color(0, 0, 0, 0), ACCENT))
	node.pressed.connect(on_pressed)
	return node


static func panel() -> PanelContainer:
	var node := PanelContainer.new()
	var style := _box(PANEL, Color(0.2, 0.22, 0.26))
	style.content_margin_left = 32
	style.content_margin_right = 32
	style.content_margin_top = 28
	style.content_margin_bottom = 28
	node.add_theme_stylebox_override("panel", style)
	return node


static func centered(child: Control) -> CenterContainer:
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	center.add_child(child)
	return center


static func _box(fill: Color, border: Color) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = fill
	style.border_color = border
	style.set_border_width_all(1)
	style.set_corner_radius_all(4)
	style.content_margin_left = 12
	style.content_margin_right = 12
	return style
