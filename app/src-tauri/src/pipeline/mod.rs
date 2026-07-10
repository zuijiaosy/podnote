// 管线:小宇宙链接 → 云端转写(带说话人) → LLM 结构化笔记
// 各模块与 Node CLI(仓库根 src/*.mjs)逐一对应,API 参数以现网验证过的为准
pub mod asr;
pub mod note;
pub mod resolve;
pub mod summarize;
pub mod tts;
