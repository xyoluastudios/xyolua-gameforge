extends Node2D
## Builds the 2D level from the grid level data: floor and wall tiles,
## wall collisions, doors, keys, room labels and the exit.

const LevelData := preload("res://scripts/core/level_data.gd")
const Door := preload("res://scripts/world/door.gd")
const KeyPickup := preload("res://scripts/world/key_pickup.gd")
const ExitZone := preload("res://scripts/world/exit_zone.gd")
const EnemyScene := preload("res://scenes/enemy.tscn")

const TILE := 32.0

@export_file("*.json") var level_path := "res://data/levels/level_01.json"

var data := LevelData.new()
var _floor_color := Color("#2a2d33")
var _wall_color := Color("#4c535c")


func _ready() -> void:
	add_to_group("level")


func build() -> void:
	data.load_file(level_path)
	_floor_color = Color.html(str(GameState.get_setting("world", "floor_color", "#2a2d33")))
	_wall_color = Color.html(str(GameState.get_setting("world", "wall_color", "#4c535c")))
	_build_walls()
	_build_doors()
	_build_keys()
	_build_exit()
	_build_labels()
	queue_redraw()


func cell_to_world(cell: Vector2i) -> Vector2:
	return Vector2((cell.x + 0.5) * TILE, (cell.y + 0.5) * TILE)


func world_to_cell(world: Vector2) -> Vector2i:
	return Vector2i(floori(world.x / TILE), floori(world.y / TILE))


func spawn_position() -> Vector2:
	return cell_to_world(data.spawn)


func spawn_enemies() -> void:
	var configs: Variant = GameState.config.get("enemies", [])
	for spawn in data.enemies:
		var index := int(spawn.get("type", 0))
		var settings: Dictionary = {}
		if configs is Array and index < (configs as Array).size():
			settings = (configs as Array)[index]
		var enemy := EnemyScene.instantiate()
		enemy.set("level", self)
		enemy.set("settings", settings)
		add_child(enemy)
		enemy.global_position = cell_to_world(LevelData.to_cell(spawn))


func on_door_opened(cell: Vector2i) -> void:
	data.set_door_open(cell, true)


func _draw() -> void:
	for y in data.height:
		for x in data.width:
			var cell := Vector2i(x, y)
			var rect := Rect2(x * TILE, y * TILE, TILE, TILE)
			if data.is_wall(cell):
				draw_rect(rect, _wall_color)
			else:
				draw_rect(rect, _floor_color)
				draw_rect(rect, _floor_color.darkened(0.15), false, 1.0)


func _build_walls() -> void:
	var walls := StaticBody2D.new()
	walls.name = "Walls"
	add_child(walls)
	for y in data.height:
		var run_start := -1
		for x in data.width + 1:
			var solid := x < data.width and data.is_wall(Vector2i(x, y))
			if solid and run_start == -1:
				run_start = x
			elif not solid and run_start != -1:
				var length := x - run_start
				var shape := CollisionShape2D.new()
				var rect := RectangleShape2D.new()
				rect.size = Vector2(length * TILE, TILE)
				shape.shape = rect
				shape.position = Vector2((run_start + length / 2.0) * TILE, (y + 0.5) * TILE)
				walls.add_child(shape)
				run_start = -1


func _build_doors() -> void:
	for entry in data.doors:
		var door := Door.new()
		door.door_id = str(entry.get("id", ""))
		door.key_id = str(entry.get("key", ""))
		door.key_name = str(entry.get("key_name", "key"))
		door.cell = LevelData.to_cell(entry)
		door.level = self
		add_child(door)
		door.position = cell_to_world(door.cell)


func _build_keys() -> void:
	for entry in data.keys:
		var pickup := KeyPickup.new()
		pickup.item_id = str(entry.get("id", ""))
		pickup.display_name = str(entry.get("name", "Key"))
		pickup.color = Color.html(str(entry.get("color", "#ffcc33")))
		add_child(pickup)
		pickup.position = cell_to_world(LevelData.to_cell(entry))


func _build_exit() -> void:
	var exit_zone := ExitZone.new()
	exit_zone.name = "Exit"
	add_child(exit_zone)
	exit_zone.position = cell_to_world(data.exit_cell)


func _build_labels() -> void:
	for room in data.rooms:
		var title := str(room.get("name", ""))
		if title == "":
			continue
		var label := Label.new()
		label.text = title
		label.add_theme_font_size_override("font_size", 11)
		label.add_theme_color_override("font_color", Color(0.75, 0.78, 0.82, 0.8))
		label.position = Vector2(float(room.get("x", 0)) * TILE + 4.0, float(room.get("y", 0)) * TILE + 2.0)
		add_child(label)
