extends Area2D
## Reaching the exit wins the level.

var _time := 0.0


func _ready() -> void:
	add_to_group("exit")
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(24, 24)
	shape.shape = rect
	add_child(shape)
	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	_time += delta
	queue_redraw()


func _on_body_entered(body: Node2D) -> void:
	if body.is_in_group("player"):
		GameState.complete_level()


func _draw() -> void:
	var pulse := 0.6 + 0.4 * sin(_time * 3.0)
	draw_rect(Rect2(-14, -14, 28, 28), Color(0.2, 0.9, 0.5, 0.35 * pulse))
	draw_rect(Rect2(-14, -14, 28, 28), Color(0.3, 1.0, 0.6), false, 2.0)
