extends CharacterBody2D
## Enemy with grid path-finding (AStarGrid2D from the level data).
## Behaviors: "chase" hunts the player once it has seen them, "patrol" walks
## from room to room, "wander" roams nearby. Locked doors block enemies too.

const TILE := 32.0

## The level builder (untyped to avoid a preload cycle). Set before _ready.
var level
## This enemy's entry from data/game_config.json "enemies".
var settings: Dictionary = {}

var speed := 4.0
var damage := 20
var behavior := "chase"
var sight_range := 10.0
var attack_range := 0.8
var attack_cooldown := 1.2

var _path: Array[Vector2i] = []
var _repath_timer := 0.0
var _attack_timer := 0.0
var _alerted := false
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	add_to_group("enemy")
	speed = float(settings.get("speed", speed))
	damage = int(settings.get("damage", damage))
	behavior = str(settings.get("behavior", behavior))
	sight_range = float(settings.get("sight_range", sight_range))
	attack_cooldown = float(settings.get("attack_cooldown", attack_cooldown))
	_rng.randomize()


func _physics_process(delta: float) -> void:
	if level == null or GameState.is_game_over:
		return
	_attack_timer = maxf(_attack_timer - delta, 0.0)
	_repath_timer -= delta
	var player := get_tree().get_first_node_in_group("player") as Node2D
	if player != null:
		var sees_player := can_see(player)
		if sees_player and not _alerted:
			_alerted = true
			AudioManager.play("enemy_alert")
		if _repath_timer <= 0.0:
			_repath_timer = 0.4
			_update_path(player, sees_player)
		if global_position.distance_to(player.global_position) <= attack_range * TILE and _attack_timer <= 0.0:
			_attack_timer = attack_cooldown
			GameState.damage(damage)
			AudioManager.play("hurt")
	_follow_path()
	move_and_slide()


## True when nothing blocks the line of sight to the player within sight_range.
func can_see(player: Node2D) -> bool:
	if global_position.distance_to(player.global_position) > sight_range * TILE:
		return false
	var query := PhysicsRayQueryParameters2D.create(global_position, player.global_position, 1, [get_rid()])
	var hit := get_world_2d().direct_space_state.intersect_ray(query)
	return not hit.is_empty() and hit.get("collider") == player


func _update_path(player: Node2D, sees_player: bool) -> void:
	var my_cell: Vector2i = level.world_to_cell(global_position)
	if behavior == "chase" and (sees_player or _alerted):
		var chase: Array[Vector2i] = level.data.find_path(my_cell, level.world_to_cell(player.global_position))
		if not chase.is_empty():
			_set_path(chase)
			return
	if _path.is_empty():
		_set_path(level.data.find_path(my_cell, _random_target(my_cell)))


func _random_target(from: Vector2i) -> Vector2i:
	if behavior == "patrol" and not level.data.rooms.is_empty():
		var room: Dictionary = level.data.rooms[_rng.randi_range(0, level.data.rooms.size() - 1)]
		return level.data.room_center(room)
	var radius := 6
	for attempt in 12:
		var candidate := from + Vector2i(_rng.randi_range(-radius, radius), _rng.randi_range(-radius, radius))
		if level.data.is_walkable(candidate):
			return candidate
	return from


func _set_path(path: Array[Vector2i]) -> void:
	_path = path
	if not _path.is_empty():
		_path.remove_at(0)


func _follow_path() -> void:
	if _path.is_empty():
		velocity = Vector2.ZERO
		return
	var target: Vector2 = level.cell_to_world(_path[0])
	var to_target := target - global_position
	if to_target.length() < 3.0:
		_path.remove_at(0)
		return
	velocity = to_target.normalized() * speed * TILE


func _draw() -> void:
	draw_rect(Rect2(-11, -11, 22, 22), Color(0.82, 0.2, 0.22))
	draw_rect(Rect2(-6, -5, 4, 4), Color(1, 0.9, 0.6))
	draw_rect(Rect2(2, -5, 4, 4), Color(1, 0.9, 0.6))
