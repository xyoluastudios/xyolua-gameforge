extends Area3D
## Reaching the exit wins the level.


func _ready() -> void:
	add_to_group("exit")
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1.6, 2.0, 1.6)
	shape.shape = box
	add_child(shape)
	var marker := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.7
	mesh.bottom_radius = 0.7
	mesh.height = 0.05
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.2, 0.9, 0.5)
	material.emission_enabled = true
	material.emission = Color(0.2, 0.9, 0.5)
	mesh.material = material
	marker.mesh = mesh
	marker.position.y = -0.95
	add_child(marker)
	var glow := OmniLight3D.new()
	glow.light_color = Color(0.3, 1.0, 0.6)
	glow.light_energy = 1.2
	glow.omni_range = 4.0
	add_child(glow)
	body_entered.connect(_on_body_entered)


func _on_body_entered(body: Node3D) -> void:
	if body.is_in_group("player"):
		GameState.complete_level()
