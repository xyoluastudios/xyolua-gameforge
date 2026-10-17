extends Area2D
## Key pickup. Collected by walking into it or by interacting with it.

var item_id := ""
var display_name := "Key"
var color := Color(1.0, 0.8, 0.2)

var _time := 0.0


func _ready() -> void:
	add_to_group("key_pickup")
	add_to_group("interactable")
	var shape := CollisionShape2D.new()
	var circle := CircleShape2D.new()
	circle.radius = 12.0
	shape.shape = circle
	add_child(shape)
	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	_time += delta
	queue_redraw()


func interact(_player: Node) -> void:
	collect()


func collect() -> void:
	if is_queued_for_deletion():
		return
	GameState.add_item(item_id, display_name)
	AudioManager.play("pickup")
	GameState.post_message("Picked up: %s" % display_name)
	queue_free()


func _on_body_entered(body: Node2D) -> void:
	if body.is_in_group("player"):
		collect()


func _draw() -> void:
	var bob := sin(_time * 3.0) * 2.0
	draw_circle(Vector2(-4, bob), 5.0, color)
	draw_rect(Rect2(0, bob - 1.5, 10, 3), color)
	draw_rect(Rect2(6, bob, 2, 4), color)
