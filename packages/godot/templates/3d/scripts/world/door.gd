extends StaticBody3D
## Locked door. Opens when the player interacts while carrying the matching key.

var door_id := ""
var key_id := ""
var key_name := "key"
var cell := Vector2i.ZERO
## The level builder (receives on_door_opened so enemies can path through).
var level: Node
var size := Vector3(2.0, 3.0, 0.3)
var is_open := false

var _mesh := MeshInstance3D.new()
var _collision := CollisionShape3D.new()


func _ready() -> void:
	add_to_group("door")
	add_to_group("interactable")
	var box := BoxShape3D.new()
	box.size = size
	_collision.shape = box
	add_child(_collision)
	var mesh := BoxMesh.new()
	mesh.size = size
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.42, 0.24, 0.14)
	mesh.material = material
	_mesh.mesh = mesh
	add_child(_mesh)


func interact(_player: Node) -> void:
	if is_open:
		return
	if key_id == "" or GameState.has_item(key_id):
		open()
	else:
		AudioManager.play("door_locked")
		GameState.post_message("Locked. You need the %s." % key_name)


func open(play_sound: bool = true) -> void:
	if is_open:
		return
	is_open = true
	GameState.mark_door_opened(door_id)
	_collision.set_deferred("disabled", true)
	if level != null and level.has_method("on_door_opened"):
		level.call("on_door_opened", cell)
	if play_sound:
		AudioManager.play("door_open")
		GameState.post_message("The door opens.")
	var tween := create_tween()
	tween.tween_property(_mesh, "position:y", size.y, 0.6).set_trans(Tween.TRANS_SINE)
