extends StaticBody2D
## Locked door. Opens when the player interacts while carrying the matching key.

const TILE := 32.0

var door_id := ""
var key_id := ""
var key_name := "key"
var cell := Vector2i.ZERO
## The level builder (receives on_door_opened so enemies can path through).
var level: Node
var is_open := false

var _collision := CollisionShape2D.new()


func _ready() -> void:
	add_to_group("door")
	add_to_group("interactable")
	var rect := RectangleShape2D.new()
	rect.size = Vector2(TILE, TILE)
	_collision.shape = rect
	add_child(_collision)


func interact(_player: Node) -> void:
	if is_open:
		return
	if key_id == "" or GameState.has_item(key_id):
		open()
	else:
		AudioManager.play("door_locked")
		GameState.post_message("Locked. You need the %s." % key_name)


func open(play_sound: bool = true) -> void:
	if is_open:
		return
	is_open = true
	GameState.mark_door_opened(door_id)
	_collision.set_deferred("disabled", true)
	if level != null and level.has_method("on_door_opened"):
		level.call("on_door_opened", cell)
	if play_sound:
		AudioManager.play("door_open")
		GameState.post_message("The door opens.")
	queue_redraw()


func _draw() -> void:
	var color := Color(0.42, 0.26, 0.15, 0.25) if is_open else Color(0.55, 0.33, 0.18)
	draw_rect(Rect2(-TILE / 2.0, -TILE / 2.0, TILE, TILE), color)
	if not is_open:
		draw_circle(Vector2(6, 0), 3.0, Color(0.9, 0.75, 0.3))
