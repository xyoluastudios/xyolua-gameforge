extends CharacterBody2D
## Top-down player: 8-way movement, sprint and interaction (E).
## Speeds in data/game_config.json are tiles per second (1 tile = 32 px).

const TILE := 32.0
const INTERACT_RADIUS := 44.0

var move_speed := 5.0
var sprint_speed := 8.0
var _facing := Vector2.DOWN


func _ready() -> void:
	add_to_group("player")
	move_speed = float(GameState.get_setting("player", "move_speed", move_speed))
	sprint_speed = float(GameState.get_setting("player", "sprint_speed", sprint_speed))


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("interact"):
		interact()


func _physics_process(_delta: float) -> void:
	if GameState.is_game_over:
		velocity = Vector2.ZERO
		return
	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var speed := (sprint_speed if Input.is_action_pressed("sprint") else move_speed) * TILE
	velocity = input * speed
	if input != Vector2.ZERO:
		_facing = input.normalized()
		queue_redraw()
	move_and_slide()


## Uses the nearest interactable object (doors, keys, ...).
func interact() -> void:
	var nearest: Node2D = null
	var best := INTERACT_RADIUS
	for node in get_tree().get_nodes_in_group("interactable"):
		if node is Node2D:
			var distance := global_position.distance_to((node as Node2D).global_position)
			if distance <= best:
				best = distance
				nearest = node
	if nearest != null and nearest.has_method("interact"):
		nearest.call("interact", self)


func _draw() -> void:
	draw_circle(Vector2.ZERO, 11.0, Color(0.36, 0.72, 0.95))
	draw_circle(_facing * 7.0, 3.5, Color(0.92, 0.96, 1.0))
