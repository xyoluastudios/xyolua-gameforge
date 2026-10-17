extends Node
## Random ambient events: flickering room lights and distant noises.

var _timer := 0.0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_rng.randomize()
	_schedule()


func _process(delta: float) -> void:
	if GameState.is_game_over:
		return
	_timer -= delta
	if _timer > 0.0:
		return
	_schedule()
	trigger_random_event()


## Triggers one event now and returns its kind ("flicker" or "sound").
func trigger_random_event() -> String:
	var lights := get_tree().get_nodes_in_group("room_light")
	if not lights.is_empty() and _rng.randf() < 0.6:
		_flicker(lights[_rng.randi_range(0, lights.size() - 1)] as Light3D)
		return "flicker"
	AudioManager.play("distant_noise")
	return "sound"


func _schedule() -> void:
	var low := float(GameState.get_setting("random_events", "min_interval", 12.0))
	var high := float(GameState.get_setting("random_events", "max_interval", 30.0))
	_timer = _rng.randf_range(low, maxf(low, high))


func _flicker(light: Light3D) -> void:
	if light == null:
		return
	var energy := light.light_energy
	var tween := create_tween()
	for i in 4:
		tween.tween_property(light, "light_energy", energy * 0.1, 0.06)
		tween.tween_property(light, "light_energy", energy, 0.08)
	AudioManager.play("flicker")
