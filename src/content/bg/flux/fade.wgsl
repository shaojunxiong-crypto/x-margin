// 拖尾：上一帧整体按比例衰减
struct Fade { decay: f32, pad0: f32, pad1: f32, pad2: f32 }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> fade: Fade;
@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return textureLoad(src, vec2i(pos.xy), 0) * fade.decay;
}
