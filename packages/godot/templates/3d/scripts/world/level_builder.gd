extends Node3D
## Builds the 3D level from the grid level data: floor, ceiling, walls,
## room lights, doors, keys, room signs and the exit.

const LevelData := preload("res://scripts/core/level_data.gd")
const Door := preload("res://scripts/world/door.gd")
const KeyPickup := preload("res://scripts/world/key_pickup.gd")
const ExitZone := preload("res://scripts/world/exit_zone.gd")
const EnemyScene := preload("res://scenes/enemy.tscn")

const TILE := 2.0
const WALL_HEIGHT := 3.0

@export_file("*.json") var level_path := "res://data/levels/level_01.json"

var data := LevelData.new()
var _wall_material := StandardMaterial3D.new()
var _floor_material := StandardMaterial3D.new()


func _ready() -> void:
	add_to_group("level")


func build() -> void:
	data.load_file(level_path)
	_setup_materials()
	_build_floor_and_ceiling()
	_build_walls()
	_build_lights()
	_build_doors()
	_build_keys()
	_build_exit()
	_build_signs()


func cell_to_world(cell: Vector2i) -> Vector3:
	return Vector3((cell.x + 0.5) * TILE, 0.0, (cell.y + 0.5) * TILE)


func world_to_cell(world: Vector3) -> Vector2i:
	return Vector2i(floori(world.x / TILE), floori(world.z / TILE))


func spawn_position() -> Vector3:
	return cell_to_world(data.spawn) + Vector3(0.0, 0.2, 0.0)


## Faces the player towards the open side of the start room.
func spawn_rotation() -> float:
	var best := 0.0
	var best_free := -1
	for direction in [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]:
		var free := 0
		var cell: Vector2i = data.spawn + direction
		while data.is_walkable(cell) and free < 20:
			free += 1
			cell += direction
		if free > best_free:
			best_free = free
			best = atan2(-float(direction.x), -float(direction.y))
	return best


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
		enemy.global_position = cell_to_world(LevelData.to_cell(spawn)) + Vector3(0.0, 0.2, 0.0)


func on_door_opened(cell: Vector2i) -> void:
	data.set_door_open(cell, true)


func _setup_materials() -> void:
	_wall_material.albedo_color = Color.html(str(GameState.get_setting("world", "wall_color", "#5b6460")))
	_floor_material.albedo_color = Color.html(str(GameState.get_setting("world", "floor_color", "#2c2f33")))
	for pair in [[_wall_material, "res://assets/textures/wall.png"], [_floor_material, "res://assets/textures/floor.png"]]:
		var material: StandardMaterial3D = pair[0]
		var path: String = pair[1]
		if ResourceLoader.exists(path):
			material.albedo_texture = load(path) as Texture2D
			material.uv1_triplanar = true
			material.uv1_scale = Vector3(0.5, 0.5, 0.5)


func _build_floor_and_ceiling() -> void:
	var size := Vector3(data.width * TILE, 0.2, data.height * TILE)
	var center := Vector3(size.x / 2.0, -0.1, size.z / 2.0)
	_add_box("Floor", center, size, _floor_material, self)
	if bool(GameState.get_setting("world", "ceiling", true)):
		_add_box("Ceiling", center + Vector3(0.0, WALL_HEIGHT + 0.2, 0.0), size, _wall_material, self)


func _build_walls() -> void:
	var walls := Node3D.new()
	walls.name = "Walls"
	add_child(walls)
	for y in data.height:
		var run_start := -1
		for x in data.width + 1:
			var solid := x < data.width and _is_visible_wall(Vector2i(x, y))
			if solid and run_start == -1:
				run_start = x
			elif not solid and run_start != -1:
				var length := x - run_start
				var center := Vector3((run_start + length / 2.0) * TILE, WALL_HEIGHT / 2.0, (y + 0.5) * TILE)
				_add_box("Wall", center, Vector3(length * TILE, WALL_HEIGHT, TILE), _wall_material, walls)
				run_start = -1


func _is_visible_wall(cell: Vector2i) -> bool:
	if not data.is_wall(cell):
		return false
	for dy in range(-1, 2):
		for dx in range(-1, 2):
			var neighbor := cell + Vector2i(dx, dy)
			if neighbor.x >= 0 and neighbor.y >= 0 and neighbor.x < data.width and neighbor.y < data.height and not data.is_wall(neighbor):
				return true
	return false


func _build_lights() -> void:
	var energy := float(GameState.get_setting("world", "light_energy", 1.0))
	var color := Color.html(str(GameState.get_setting("world", "light_color", "#ffd9a8")))
	for entry in data.lights:
		var light := OmniLight3D.new()
		light.light_color = color
		light.light_energy = energy
		light.omni_range = 9.0
		light.omni_attenuation = 1.2
		light.add_to_group("room_light")
		add_child(light)
		light.position = cell_to_world(LevelData.to_cell(entry)) + Vector3(0.0, WALL_HEIGHT - 0.4, 0.0)


func _build_doors() -> void:
	for entry in data.doors:
		var cell := LevelData.to_cell(entry)
		var door := Door.new()
		door.name = "Door_%s" % str(entry.get("id", ""))
		door.door_id = str(entry.get("id", ""))
		door.key_id = str(entry.get("key", ""))
		door.key_name = str(entry.get("key_name", "key"))
		door.cell = cell
		door.level = self
		var blocks_north_south := data.is_wall(cell + Vector2i(-1, 0)) and data.is_wall(cell + Vector2i(1, 0))
		door.size = Vector3(TILE, WALL_HEIGHT, 0.3) if blocks_north_south else Vector3(0.3, WALL_HEIGHT, TILE)
		add_child(door)
		door.position = cell_to_world(cell) + Vector3(0.0, WALL_HEIGHT / 2.0, 0.0)


func _build_keys() -> void:
	for entry in data.keys:
		var pickup := KeyPickup.new()
		pickup.item_id = str(entry.get("id", ""))
		pickup.display_name = str(entry.get("name", "Key"))
		pickup.color = Color.html(str(entry.get("color", "#ffcc33")))
		add_child(pickup)
		pickup.position = cell_to_world(LevelData.to_cell(entry)) + Vector3(0.0, 1.0, 0.0)


func _build_exit() -> void:
	var exit_zone := ExitZone.new()
	exit_zone.name = "Exit"
	add_child(exit_zone)
	exit_zone.position = cell_to_world(data.exit_cell) + Vector3(0.0, 1.0, 0.0)


func _build_signs() -> void:
	for room in data.rooms:
		var title := str(room.get("name", ""))
		if title == "":
			continue
		var sign_label := Label3D.new()
		sign_label.text = title
		var note := str(room.get("note", ""))
		if note != "":
			sign_label.text += "\n" + note
		sign_label.font_size = 40
		sign_label.outline_size = 8
		sign_label.pixel_size = 0.006
		sign_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		sign_label.modulate = Color(0.85, 0.85, 0.8, 0.8)
		add_child(sign_label)
		sign_label.position = cell_to_world(data.room_center(room)) + Vector3(0.0, 2.3, 0.0)


func _add_box(node_name: String, center: Vector3, size: Vector3, material: Material, parent: Node) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.name = node_name
	var shape := CollisionShape3D.new()
	var box_shape := BoxShape3D.new()
	box_shape.size = size
	shape.shape = box_shape
	body.add_child(shape)
	var mesh_instance := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh.material = material
	mesh_instance.mesh = mesh
	body.add_child(mesh_instance)
	parent.add_child(body)
	body.position = center
	return body
