extends CharacterBody3D
## First-person player: walk, sprint, mouse look, interact (E) and flashlight (F).

@onready var head: Node3D = $Head
@onready var camera: Camera3D = $Head/Camera3D
@onready var ray: RayCast3D = $Head/Camera3D/InteractRay
@onready var flashlight: SpotLight3D = $Head/Camera3D/Flashlight

var move_speed := 4.0
var sprint_speed := 6.5
var mouse_sensitivity := 0.0025
var battery := 1.0
var battery_seconds := 180.0
var has_flashlight := false
var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 9.8)
var _max_energy := 2.0


func _ready() -> void:
	add_to_group("player")
	move_speed = float(GameState.get_setting("player", "move_speed", move_speed))
	sprint_speed = float(GameState.get_setting("player", "sprint_speed", sprint_speed))
	mouse_sensitivity = float(GameState.get_setting("player", "mouse_sensitivity", mouse_sensitivity))
	battery_seconds = maxf(float(GameState.get_setting("flashlight", "battery_seconds", battery_seconds)), 1.0)
	has_flashlight = GameState.has_feature("flashlight")
	_max_energy = flashlight.light_energy
	flashlight.spot_range = float(GameState.get_setting("flashlight", "range", flashlight.spot_range))
	# Start with the flashlight on (if the game has one): first impressions matter in the dark.
	flashlight.visible = has_flashlight
	ray.add_exception(self)
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var motion := event as InputEventMouseMotion
		rotate_y(-motion.relative.x * mouse_sensitivity)
		head.rotate_x(-motion.relative.y * mouse_sensitivity)
		head.rotation.x = clampf(head.rotation.x, deg_to_rad(-85.0), deg_to_rad(85.0))
	elif event is InputEventMouseButton and event.is_pressed() and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		if not get_tree().paused:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event.is_action_pressed("interact"):
		interact()
	elif event.is_action_pressed("flashlight") and has_flashlight:
		toggle_flashlight()


func _physics_process(delta: float) -> void:
	if GameState.is_game_over:
		velocity = Vector3.ZERO
		return
	if not is_on_floor():
		velocity.y -= _gravity * delta
	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var direction := (transform.basis * Vector3(input.x, 0.0, input.y)).normalized()
	var speed := sprint_speed if Input.is_action_pressed("sprint") else move_speed
	if direction != Vector3.ZERO:
		velocity.x = direction.x * speed
		velocity.z = direction.z * speed
	else:
		velocity.x = move_toward(velocity.x, 0.0, speed)
		velocity.z = move_toward(velocity.z, 0.0, speed)
	move_and_slide()
	_drain_battery(delta)


## Uses whatever the player is looking at (doors, keys, ...).
func interact() -> void:
	ray.force_raycast_update()
	var target := ray.get_collider()
	if target != null and target.has_method("interact"):
		target.call("interact", self)


func toggle_flashlight() -> void:
	if battery <= 0.0:
		GameState.post_message("The flashlight battery is empty.")
		return
	flashlight.visible = not flashlight.visible


func _drain_battery(delta: float) -> void:
	if not flashlight.visible:
		return
	battery = maxf(battery - delta / battery_seconds, 0.0)
	flashlight.light_energy = _max_energy * clampf(0.25 + battery * 3.0, 0.25, 1.0)
	GameState.battery_changed.emit(battery)
	if battery <= 0.0:
		flashlight.visible = false
		GameState.post_message("The flashlight battery is empty.")
