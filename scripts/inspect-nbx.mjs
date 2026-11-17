import { readFileSync } from 'node:fs';

function load(file) {
  const b = readFileSync(file);
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const view = new DataView(buf);
  const hlen = view.getUint32(4, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hlen)));
  const sec = (k) => {
    const s = h.s[k];
    return buf.slice(s.off, s.off + s.len);
  };
  return {
    h,
    pos: new Int16Array(sec('pos')),
    off: new Uint32Array(sec('off')),
    ht: new Float32Array(sec('ht')),
    fl: new Uint8Array(sec('fl')),
    raw: buf,
  };
}

for (const f of ['0_0', '2_2', '-3_1']) {
  const { h, pos, off, ht, fl, raw } = load(`public/data/tiles/${f}.nbx`);
  console.log('=====', f, 'count', h.count, 'ox', h.ox, 'oy', h.oy);
  console.log(' sections', JSON.stringify(h.s));
  const offU = Array.from(off.slice(0, 10));
  const offDiff = [];
  for (let i = 0; i < 9; i++) offDiff.push((off[i + 1] - off[i]) >>> 0);
  console.log(' off u32 ', offU.join(','));
  console.log(' off diff', offDiff.join(','));
  const htF = Array.from(ht.slice(0, 10)).map((x) => x.toFixed(2));
  const htU = Array.from(new Uint32Array(ht.buffer, ht.byteOffset, 10));
  console.log(' ht  f32 ', htF.join(','));
  console.log(' ht  u32 ', htU.join(','));
  console.log(' fl  u8  ', Array.from(fl.slice(0, 10)).join(','));
  console.log(' pos i16 ', Array.from(pos.slice(0, 14)).join(','));
  // raw hex at the off section
  const so = h.s.off;
  console.log(' hex@off', Buffer.from(raw.slice(so, so + 40)).toString('hex'));
  const sh = h.s.ht;
  console.log(' hex@ht ', Buffer.from(raw.slice(sh, sh + 40)).toString('hex'));
}
