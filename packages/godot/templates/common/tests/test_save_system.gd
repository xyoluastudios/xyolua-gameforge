extends "res://tests/test_case.gd"
## Save files round-trip inventory and health.
## Needs the GameState autoload (available when tests run through the engine).

const SaveSystemScript := preload("res://scripts/autoload/save_system.gd")
const TEST_SAVE := "user://test_savegame.json"


func test_save_and_load_round_trip() -> void:
	var tree := Engine.get_main_loop() as SceneTree
	var game_state = tree.root.get_node_or_null("GameState") if tree != null else null
	if game_state == null:
		skip("GameState autoload is not available in this run mode")
		return
	game_state.reset()
	game_state.add_item("key_1", "Red Key")
	game_state.damage(10)
	var saver = SaveSystemScript.new()
	assert_true(saver.save_game(TEST_SAVE), "save written")
	game_state.reset()
	assert_false(game_state.has_item("key_1"), "inventory cleared")
	assert_true(saver.load_game(TEST_SAVE), "save loaded")
	assert_true(game_state.has_item("key_1"), "inventory restored")
	assert_eq(game_state.health, game_state.max_health - 10, "health restored")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(TEST_SAVE))
	saver.free()
