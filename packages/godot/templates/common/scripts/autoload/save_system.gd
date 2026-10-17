extends Node
## Save / load (autoload "SaveSystem"). F5 saves, F9 loads.
##
## The save file is plain JSON in user:// so it is easy to inspect and test.

const SAVE_PATH := "user://savegame.json"

## Set by the main menu's "Continue" button; the game scene loads after building.
var load_on_start := false


func _unhandled_input(event: InputEvent) -> void:
	if not GameState.has_feature("save_system") or get_tree().get_first_node_in_group("player") == null:
		return
	if event.is_action_pressed("save_game"):
		if save_game():
			GameState.post_message("Game saved.")
	elif event.is_action_pressed("load_game"):
		if load_game():
			GameState.post_message("Game loaded.")


func has_save(path: String = SAVE_PATH) -> bool:
	return FileAccess.file_exists(path)


func serialize() -> Dictionary:
	var data := {
		"version": 1,
		"health": GameState.health,
		"inventory": GameState.inventory.duplicate(),
		"item_names": GameState.item_names.duplicate(),
		"opened_doors": GameState.opened_doors.duplicate(),
	}
	var player: Node = get_tree().get_first_node_in_group("player") if is_inside_tree() else null
	if player is Node3D:
		var p3 := (player as Node3D).global_position
		data["position"] = [p3.x, p3.y, p3.z]
		data["rotation_y"] = (player as Node3D).rotation.y
	elif player is Node2D:
		var p2 := (player as Node2D).global_position
		data["position"] = [p2.x, p2.y]
	return data


func apply(data: Dictionary) -> void:
	GameState.health = clampi(int(data.get("health", GameState.max_health)), 1, GameState.max_health)
	GameState.health_changed.emit(GameState.health, GameState.max_health)
	GameState.inventory.clear()
	GameState.item_names.clear()
	var names: Variant = data.get("item_names", {})
	for item in data.get("inventory", []):
		var item_id := str(item)
		GameState.inventory.append(item_id)
		GameState.item_names[item_id] = names.get(item_id, item_id) if names is Dictionary else item_id
	GameState.inventory_changed.emit()
	if not is_inside_tree():
		return
	var opened: Variant = data.get("opened_doors", [])
	for door in get_tree().get_nodes_in_group("door"):
		if opened is Array and (opened as Array).has(str(door.get("door_id"))):
			door.call("open", false)
	for pickup in get_tree().get_nodes_in_group("key_pickup"):
		if GameState.has_item(str(pickup.get("item_id"))):
			pickup.queue_free()
	var player := get_tree().get_first_node_in_group("player")
	var pos: Variant = data.get("position", [])
	if not (pos is Array):
		return
	var values := pos as Array
	if player is Node3D and values.size() == 3:
		(player as Node3D).global_position = Vector3(float(values[0]), float(values[1]), float(values[2]))
		(player as Node3D).rotation.y = float(data.get("rotation_y", 0.0))
	elif player is Node2D and values.size() == 2:
		(player as Node2D).global_position = Vector2(float(values[0]), float(values[1]))


func save_game(path: String = SAVE_PATH) -> bool:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("Could not write save file: %s" % path)
		return false
	file.store_string(JSON.stringify(serialize(), "\t"))
	file.close()
	return true


func load_game(path: String = SAVE_PATH) -> bool:
	if not FileAccess.file_exists(path):
		GameState.post_message("No saved game found.")
		return false
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (parsed is Dictionary):
		push_error("Save file is corrupt: %s" % path)
		return false
	apply(parsed)
	return true
