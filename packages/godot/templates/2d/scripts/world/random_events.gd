extends Node
## Random ambient events: the world briefly darkens or a distant noise plays.

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
	var tint := get_tree().get_first_node_in_group("world_tint") as CanvasModulate
	if tint != null and _rng.randf() < 0.5:
		var original := tint.color
		var tween := create_tween()
		for i in 3:
			tween.tween_property(tint, "color", original.darkened(0.6), 0.07)
			tween.tween_property(tint, "color", original, 0.1)
		AudioManager.play("flicker")
		return "flicker"
	AudioManager.play("distant_noise")
	return "sound"


func _schedule() -> void:
	var low := float(GameState.get_setting("random_events", "min_interval", 12.0))
	var high := float(GameState.get_setting("random_events", "max_interval", 30.0))
	_timer = _rng.randf_range(low, maxf(low, high))
