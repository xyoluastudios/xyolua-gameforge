extends "res://tests/test_case.gd"
## Validates the data files written by GameForge (game config and sound events).

const GameStateScript := preload("res://scripts/autoload/game_state.gd")

var loader


func before_each() -> void:
	loader = GameStateScript.new()


func test_game_config_is_valid() -> void:
	var config: Dictionary = loader.load_json("res://data/game_config.json")
	assert_false(config.is_empty(), "game_config.json parses")
	var player: Dictionary = config.get("player", {})
	assert_true(float(player.get("move_speed", 0)) > 0.0, "move speed > 0")
	assert_true(float(player.get("sprint_speed", 0)) >= float(player.get("move_speed", 0)), "sprint >= walk")
	assert_true(int(player.get("max_health", 0)) > 0, "max health > 0")
	assert_false((config.get("features", []) as Array).is_empty(), "features listed")
	loader.free()


func test_sound_event_files_exist() -> void:
	var data: Dictionary = loader.load_json("res://audio/sound_events.json")
	var events: Dictionary = data.get("events", {})
	assert_false(events.is_empty(), "sound events defined")
	for event_name in events:
		var file := str((events[event_name] as Dictionary).get("file", ""))
		assert_true(FileAccess.file_exists(file), "sound file for '%s' exists (%s)" % [event_name, file])
	loader.free()


func test_main_scene_exists() -> void:
	var main_scene := str(ProjectSettings.get_setting("application/run/main_scene", ""))
	assert_true(main_scene != "" and ResourceLoader.exists(main_scene), "main scene exists: %s" % main_scene)
	assert_true(ResourceLoader.exists("res://scenes/main.tscn"), "game scene exists")
	loader.free()
