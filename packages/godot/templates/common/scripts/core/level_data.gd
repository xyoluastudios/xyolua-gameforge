extends RefCounted
## Grid-based level description loaded from data/levels/*.json.
##
## Written by the GameForge Level Designer and used by the level builders and
## for enemy path-finding (AStarGrid2D). In "grid", "#" is a wall and every
## other character is walkable floor. Doors are solid until opened.

const WALL := "#"

var level_name := ""
var width := 0
var height := 0
var grid := PackedStringArray()
var rooms: Array = []
var doors: Array = []
var keys: Array = []
var enemies: Array = []
var lights: Array = []
var spawn := Vector2i.ZERO
var exit_cell := Vector2i.ZERO
var astar := AStarGrid2D.new()


func load_file(path: String) -> bool:
	if not FileAccess.file_exists(path):
		push_error("Level file not found: %s" % path)
		return false
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (parsed is Dictionary):
		push_error("Level file is not valid JSON: %s" % path)
		return false
	parse(parsed)
	return true


func parse(data: Dictionary) -> void:
	level_name = str(data.get("name", ""))
	grid = PackedStringArray()
	for row in data.get("grid", []):
		grid.append(str(row))
	height = grid.size()
	width = grid[0].length() if height > 0 else 0
	rooms = data.get("rooms", [])
	doors = data.get("doors", [])
	keys = data.get("keys", [])
	enemies = data.get("enemies", [])
	lights = data.get("lights", [])
	spawn = to_cell(data.get("spawn", {}))
	exit_cell = to_cell(data.get("exit", {}))
	_build_astar()


static func to_cell(value: Variant) -> Vector2i:
	if value is Dictionary:
		var dict := value as Dictionary
		return Vector2i(int(dict.get("x", 0)), int(dict.get("y", 0)))
	return Vector2i.ZERO


func is_wall(cell: Vector2i) -> bool:
	if cell.x < 0 or cell.y < 0 or cell.x >= width or cell.y >= height:
		return true
	return grid[cell.y][cell.x] == WALL


func is_walkable(cell: Vector2i) -> bool:
	return astar.is_in_boundsv(cell) and not astar.is_point_solid(cell)


func walkable_cells() -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for y in height:
		for x in width:
			if is_walkable(Vector2i(x, y)):
				cells.append(Vector2i(x, y))
	return cells


func set_door_open(cell: Vector2i, is_open: bool) -> void:
	if astar.is_in_boundsv(cell):
		astar.set_point_solid(cell, not is_open)


func find_path(from: Vector2i, to: Vector2i) -> Array[Vector2i]:
	if not is_walkable(from) or not is_walkable(to):
		return []
	return astar.get_id_path(from, to)


func room_center(room: Dictionary) -> Vector2i:
	return Vector2i(int(room.get("x", 0)) + int(room.get("w", 1)) / 2, int(room.get("y", 0)) + int(room.get("h", 1)) / 2)


func room_at(cell: Vector2i) -> Dictionary:
	for room in rooms:
		var r := room as Dictionary
		var rect := Rect2i(int(r.get("x", 0)), int(r.get("y", 0)), int(r.get("w", 0)), int(r.get("h", 0)))
		if rect.has_point(cell):
			return r
	return {}


func _build_astar() -> void:
	astar = AStarGrid2D.new()
	astar.region = Rect2i(0, 0, width, height)
	astar.diagonal_mode = AStarGrid2D.DIAGONAL_MODE_NEVER
	astar.update()
	for y in height:
		for x in width:
			if is_wall(Vector2i(x, y)):
				astar.set_point_solid(Vector2i(x, y), true)
	for door in doors:
		astar.set_point_solid(to_cell(door), true)
