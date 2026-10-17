shader_type canvas_item;

// Dark vignette overlay used by the HUD (adds atmosphere to 3D scenes).
uniform float strength : hint_range(0.0, 1.0) = 0.5;
uniform vec4 tint : source_color = vec4(0.0, 0.0, 0.0, 1.0);

void fragment() {
	vec2 centered = UV - vec2(0.5);
	float distance_from_center = length(centered) * 1.4;
	float amount = smoothstep(0.35, 1.0, distance_from_center) * strength;
	COLOR = vec4(tint.rgb, amount);
}
