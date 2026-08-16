// A dependency-free WAV recorder. MediaRecorder's containers (webm/opus on Chrome, mp4 on
// Safari) are rejected by the 0G router's Whisper endpoint — it wants classic audio files — so we
// capture raw PCM off the mic with WebAudio and build a 16-bit mono WAV ourselves. Downsampled to
// 16 kHz: exactly what speech models want, and a 30-second clip stays under a megabyte.

export type WavRecorder = {
  stop: () => Promise<Blob>;
  cancel: () => void;
  /** WAV of EVERYTHING captured so far, without stopping — powers live transcription. */
  snapshot: () => Blob;
  /** Seconds of audio captured so far. */
  duration: () => number;
};

const TARGET_RATE = 16_000;

export async function startWavRecording(): Promise<WavRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated-but-universal; an AudioWorklet needs a separate module file,
  // which fights the bundler for no gain at journaling clip lengths.
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  proc.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(proc);
  proc.connect(ctx.destination);

  const teardown = () => {
    try {
      proc.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    } catch {
      /* already torn down */
    }
  };

  const joinAll = () => {
    let total = 0;
    for (const c of chunks) total += c.length;
    const joined = new Float32Array(total);
    let off = 0;
    for (const c of chunks) {
      joined.set(c, off);
      off += c.length;
    }
    return joined;
  };

  return {
    cancel: teardown,
    // Cumulative snapshot, khoj-style: re-transcribing the WHOLE clip every few seconds costs
    // fractions of a cent and never splits a word at a chunk boundary the way rolling-window
    // chunks do - the transcript simply gets more complete each pass.
    snapshot: () => encodeWav(downsample(joinAll(), ctx.sampleRate, TARGET_RATE), TARGET_RATE),
    duration: () => {
      let total = 0;
      for (const c of chunks) total += c.length;
      return total / ctx.sampleRate;
    },
    stop: async () => {
      teardown();
      const pcm = downsample(joinAll(), ctx.sampleRate, TARGET_RATE);
      return encodeWav(pcm, TARGET_RATE);
    },
  };
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate >= fromRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // Average the source window - a cheap anti-aliasing box filter, plenty for speech.
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

function encodeWav(pcm: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM format
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  let o = 44;
  for (let i = 0; i < pcm.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}
