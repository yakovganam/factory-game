// Browser entry for check-music.mjs: how does this browser's decodeAudioData treat each file?
(window as unknown as { __decode: (b64: string, sr: number) => Promise<unknown> }).__decode = async (b64: string, sr: number) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try {
    const ctx = new OfflineAudioContext(2, 1, sr);
    const buf = await ctx.decodeAudioData(bytes.buffer);
    const d = buf.getChannelData(0);
    let lead = 0;
    while (lead < d.length && lead < 8192 && Math.abs(d[lead]) < 1e-7) lead++;
    return { ok: true, length: buf.length, sampleRate: buf.sampleRate, leadingZeros: lead };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};
