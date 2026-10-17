extends "res://tests/test_case.gd"
## The generated level must be solvable: every key is reachable before the
## door it opens, and the exit only after all doors are open.

const LevelData := preload("res://scripts/core/level_data.gd")
const LEVEL_PATH := "res://data/levels/level_01.json"

var level: LevelData


func before_each() -> void:
	level = LevelData.new()
	level.load_file(LEVEL_PATH)


func test_level_loads() -> void:
	assert_true(level.width > 0 and level.height > 0, "level has a size")
	assert_true(level.rooms.size() >= 2, "level has rooms")


func test_spawn_and_exit_are_walkable() -> void:
	assert_true(level.is_walkable(level.spawn), "spawn is walkable")
	assert_true(level.is_walkable(level.exit_cell), "exit is walkable")


func test_border_is_closed() -> void:
	for x in level.width:
		assert_true(level.is_wall(Vector2i(x, 0)) and level.is_wall(Vector2i(x, level.height - 1)), "top/bottom border at x=%d" % x)
	for y in level.height:
		assert_true(level.is_wall(Vector2i(0, y)) and level.is_wall(Vector2i(level.width - 1, y)), "left/right border at y=%d" % y)


func test_level_is_solvable_in_order() -> void:
	assert_eq(level.keys.size(), level.doors.size(), "one key per door")
	for i in level.doors.size():
		var key_cell := LevelData.to_cell(level.keys[i])
		assert_false(level.find_path(level.spawn, key_cell).is_empty(), "key %d reachable" % (i + 1))
		assert_true(level.find_path(level.spawn, level.exit_cell).is_empty(), "exit locked before door %d" % (i + 1))
		level.set_door_open(LevelData.to_cell(level.doors[i]), true)
	assert_false(level.find_path(level.spawn, level.exit_cell).is_empty(), "exit reachable after all doors")


func test_enemies_spawn_on_floor() -> void:
	for enemy in level.enemies:
		assert_true(level.is_walkable(LevelData.to_cell(enemy)), "enemy spawn is walkable")
