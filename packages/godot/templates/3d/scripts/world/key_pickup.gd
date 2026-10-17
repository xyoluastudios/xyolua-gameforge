extends Area3D
## Key pickup. Collected by walking into it or by interacting with it.

var item_id := ""
var display_name := "Key"
var color := Color(1.0, 0.8, 0.2)

var _time := 0.0
var _visual := MeshInstance3D.new()


func _ready() -> void:
	add_to_group("key_pickup")
	add_to_group("interactable")
	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 0.7
	shape.shape = sphere
	add_child(shape)
	var mesh := BoxMesh.new()
	mesh.size = Vector3(0.4, 0.12, 0.12)
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.emission_enabled = true
	material.emission = color
	material.emission_energy_multiplier = 1.5
	mesh.material = material
	_visual.mesh = mesh
	add_child(_visual)
	var glow := OmniLight3D.new()
	glow.light_color = color
	glow.light_energy = 0.6
	glow.omni_range = 2.5
	add_child(glow)
	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	_time += delta
	_visual.rotation.y = _time * 1.5
	_visual.position.y = 0.15 * sin(_time * 2.0)


func interact(_player: Node) -> void:
	collect()


func collect() -> void:
	if is_queued_for_deletion():
		return
	GameState.add_item(item_id, display_name)
	AudioManager.play("pickup")
	GameState.post_message("Picked up: %s" % display_name)
	queue_free()


func _on_body_entered(body: Node3D) -> void:
	if body.is_in_group("player"):
		collect()
