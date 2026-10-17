extends "res://tests/test_case.gd"
## Inventory, health and win / lose flow of the GameState autoload script.

const GameStateScript := preload("res://scripts/autoload/game_state.gd")

var state


func before_each() -> void:
	state = GameStateScript.new()
	state.config = {"player": {"max_health": 50}, "features": ["inventory"]}
	state.reset()


func test_reset_uses_configured_health() -> void:
	assert_eq(state.max_health, 50, "max health")
	assert_eq(state.health, 50, "health")
	state.free()


func test_inventory_add_and_remove() -> void:
	state.add_item("key_1", "Red Key")
	state.add_item("key_1", "Red Key")
	assert_eq(state.inventory.size(), 1, "duplicates are ignored")
	assert_true(state.has_item("key_1"), "has key")
	assert_eq(state.item_display_names()[0], "Red Key", "display name")
	assert_true(state.remove_item("key_1"), "remove returns true")
	assert_false(state.has_item("key_1"), "key removed")
	state.free()


func test_damage_kills_player_once() -> void:
	var deaths := [0]
	state.player_died.connect(func() -> void: deaths[0] += 1)
	state.damage(30)
	assert_eq(state.health, 20, "health after damage")
	state.damage(100)
	state.damage(10)
	assert_eq(state.health, 0, "health is clamped")
	assert_true(state.is_game_over, "game over")
	assert_eq(deaths[0], 1, "died exactly once")
	state.free()


func test_complete_level() -> void:
	var wins := [0]
	state.level_completed.connect(func() -> void: wins[0] += 1)
	state.complete_level()
	state.complete_level()
	assert_eq(wins[0], 1, "level completed once")
	state.free()


func test_feature_flags() -> void:
	assert_true(state.has_feature("inventory"), "inventory enabled")
	assert_false(state.has_feature("multiplayer"), "multiplayer disabled")
	state.free()
