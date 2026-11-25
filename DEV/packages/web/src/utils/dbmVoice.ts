let lastSpokenText = '';
let lastSpokenAtMs = 0;

/**
 * 使用浏览器 Web Speech API 播报 4 字左右 DBM 短语音。
 * 自动打断上一条未播完的语音并做短窗去重，避免高并发时语音排队滞后。
 */
export function speakDbmVoice(text: string | undefined | null): void {
  const phrase = (text || '').trim();
  if (!phrase) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  const now = Date.now();
  if (phrase === lastSpokenText && now - lastSpokenAtMs < 1500) {
    return;
  }
  lastSpokenText = phrase;
  lastSpokenAtMs = now;

  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(phrase);
    utter.lang = 'zh-CN';
    utter.rate = 1.18;
    utter.volume = 0.9;
    synth.speak(utter);
  } catch {
    // 浏览器禁用或无语音引擎时静默忽略
  }
}
