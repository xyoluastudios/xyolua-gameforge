extends Node
## Plays the sound events defined in audio/sound_events.json (autoload "AudioManager").
##
## Unknown events or missing files are ignored, so gameplay never breaks
## because of audio. Replace the placeholder .wav files in audio/ with real
## sounds — the event names stay the same.

const EVENTS_PATH := "res://audio/sound_events.json"
const POOL_SIZE := 8

var _events: Dictionary = {}
var _streams: Dictionary = {}
var _pool: Array[AudioStreamPlayer] = []
var _ambience: AudioStreamPlayer


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	var data := GameState.load_json(EVENTS_PATH)
	var events: Variant = data.get("events", {})
	if events is Dictionary:
		_events = events
	for i in POOL_SIZE:
		var player := AudioStreamPlayer.new()
		add_child(player)
		_pool.append(player)
	_ambience = AudioStreamPlayer.new()
	add_child(_ambience)
	_ambience.finished.connect(_ambience.play)


func has_event(event_name: String) -> bool:
	return _events.has(event_name)


func play(event_name: String) -> void:
	var stream := _get_stream(event_name)
	if stream == null:
		return
	for player in _pool:
		if not player.playing:
			player.stream = stream
			player.volume_db = float(_event_value(event_name, "volume_db", 0.0))
			player.pitch_scale = randf_range(0.95, 1.05)
			player.play()
			return


func start_ambience(event_name: String = "ambience") -> void:
	var stream := _get_stream(event_name)
	if stream == null:
		return
	_ambience.stream = stream
	_ambience.volume_db = float(_event_value(event_name, "volume_db", -12.0))
	_ambience.play()


func stop_ambience() -> void:
	_ambience.stop()


func _event_value(event_name: String, key: String, fallback: Variant) -> Variant:
	var event: Variant = _events.get(event_name, {})
	if event is Dictionary:
		return (event as Dictionary).get(key, fallback)
	return fallback


func _get_stream(event_name: String) -> AudioStream:
	if _streams.has(event_name):
		return _streams[event_name]
	var path := str(_event_value(event_name, "file", ""))
	var stream: AudioStream = null
	if path != "" and ResourceLoader.exists(path):
		stream = load(path) as AudioStream
	_streams[event_name] = stream
	return stream


func _exit_tree() -> void:
	# Release playbacks so nothing leaks when the game quits.
	if _ambience.finished.is_connected(_ambience.play):
		_ambience.finished.disconnect(_ambience.play)
	for player in _pool + [_ambience]:
		player.stop()
		player.stream = null
	_streams.clear()
