// 合成：背景色上叠拖尾，密度用 1-exp(-d) 压缩，亮暗主题共用
struct Comp { bg: vec4f, gain: f32, glow: f32, pad0: f32, pad1: f32 }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> comp: Comp;
@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let s = textureLoad(src, vec2i(pos.xy), 0);
  let d = max(s.a, 0.0);
  let col = s.rgb / max(d, 1e-4);
  let a = 1.0 - exp(-d * comp.gain);
  let dims = vec2f(textureDimensions(src));
  let uv = pos.xy / dims;
  // 很淡的暗角，让画面有景深
  let vig = 1.0 - comp.glow * dot(uv - 0.5, uv - 0.5);
  return vec4f(mix(comp.bg.rgb * vig, col, a), 1.0);
}
