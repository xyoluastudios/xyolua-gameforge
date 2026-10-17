extends Node
## Global game state (autoload "GameState").
##
## Holds the configuration from data/game_config.json, the inventory, the
## player's health and the win / lose flow. Gameplay and UI scripts talk to
## each other through these signals instead of referencing each other.

signal inventory_changed
signal health_changed(current: int, maximum: int)
signal battery_changed(percent: float)
signal message_posted(text: String)
signal player_died
signal level_completed

const CONFIG_PATH := "res://data/game_config.json"

var config: Dictionary = {}
var inventory: Array[String] = []
var item_names: Dictionary = {}
var opened_doors: Array[String] = []
var health := 100
var max_health := 100
var is_game_over := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	config = load_json(CONFIG_PATH)
	reset()


## Reads a JSON file and returns it as a Dictionary ({} if missing or invalid).
func load_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_warning("Missing data file: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if parsed is Dictionary:
		return parsed
	push_error("Invalid JSON object in %s" % path)
	return {}


## Returns config[section][key], or `fallback` when it is missing.
func get_setting(section: String, key: String, fallback: Variant) -> Variant:
	var data: Variant = config.get(section, {})
	if data is Dictionary:
		return (data as Dictionary).get(key, fallback)
	return fallback


func has_feature(feature_id: String) -> bool:
	var features: Variant = config.get("features", [])
	return features is Array and (features as Array).has(feature_id)


func get_text(key: String, fallback: String) -> String:
	return str(get_setting("texts", key, fallback))


func reset() -> void:
	inventory.clear()
	item_names.clear()
	opened_doors.clear()
	max_health = int(get_setting("player", "max_health", 100))
	health = max_health
	is_game_over = false
	inventory_changed.emit()
	health_changed.emit(health, max_health)


func add_item(item_id: String, display_name: String = "") -> void:
	if inventory.has(item_id):
		return
	inventory.append(item_id)
	item_names[item_id] = display_name if display_name != "" else item_id
	inventory_changed.emit()


func has_item(item_id: String) -> bool:
	return inventory.has(item_id)


func remove_item(item_id: String) -> bool:
	var index := inventory.find(item_id)
	if index == -1:
		return false
	inventory.remove_at(index)
	item_names.erase(item_id)
	inventory_changed.emit()
	return true


func item_display_names() -> Array[String]:
	var names: Array[String] = []
	for item_id in inventory:
		names.append(str(item_names.get(item_id, item_id)))
	return names


func mark_door_opened(door_id: String) -> void:
	if not opened_doors.has(door_id):
		opened_doors.append(door_id)


func damage(amount: int) -> void:
	if is_game_over or amount <= 0:
		return
	health = maxi(health - amount, 0)
	health_changed.emit(health, max_health)
	if health == 0:
		is_game_over = true
		player_died.emit()


func heal(amount: int) -> void:
	if is_game_over or amount <= 0:
		return
	health = mini(health + amount, max_health)
	health_changed.emit(health, max_health)


func complete_level() -> void:
	if is_game_over:
		return
	is_game_over = true
	level_completed.emit()


func post_message(text: String) -> void:
	message_posted.emit(text)
