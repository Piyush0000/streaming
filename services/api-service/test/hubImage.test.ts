import test from 'node:test';
import assert from 'node:assert/strict';
import { contentTypeForFile, decodeCursor, detectImageExt, encodeCursor } from '../src/hubImage';

const pad = (b: number[]) => Buffer.concat([Buffer.from(b), Buffer.alloc(32)]);

test('detects png/jpeg/gif/webp by magic bytes', () => {
  assert.equal(detectImageExt(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.equal(detectImageExt(pad([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(detectImageExt(Buffer.from('GIF89a' + '\0'.repeat(20), 'latin1')), 'gif');
  assert.equal(detectImageExt(Buffer.from('GIF87a' + '\0'.repeat(20), 'latin1')), 'gif');
  assert.equal(
    detectImageExt(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)])),
    'webp'
  );
});

test('rejects svg, html, wav (RIFF non-WEBP), truncated and empty input', () => {
  assert.equal(detectImageExt(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(detectImageExt(Buffer.from('<html><script>alert(1)</script>')), null);
  assert.equal(
    detectImageExt(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(8)])),
    null
  );
  assert.equal(detectImageExt(Buffer.from([0x89, 0x50])), null);
  assert.equal(detectImageExt(Buffer.alloc(0)), null);
});

test('media filename validation + content type map', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(contentTypeForFile(`${id}.png`), 'image/png');
  assert.equal(contentTypeForFile(`${id}.jpg`), 'image/jpeg');
  assert.equal(contentTypeForFile(`${id}.jpeg`), 'image/jpeg');
  assert.equal(contentTypeForFile(`${id}.webp`), 'image/webp');
  assert.equal(contentTypeForFile(`${id}.gif`), 'image/gif');
  assert.equal(contentTypeForFile(`${id}.svg`), null);
  assert.equal(contentTypeForFile(`${id}.PNG`), null);
  assert.equal(contentTypeForFile('../etc/passwd'), null);
  assert.equal(contentTypeForFile(`../${id.slice(3)}.png`), null);
});

test('cursor round trip and rejection of garbage', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const ts = '2026-01-02T03:04:05.123456Z';
  assert.deepEqual(decodeCursor(encodeCursor(ts, id)), { ts, id });
  assert.equal(decodeCursor('not-a-cursor'), null);
  assert.equal(decodeCursor(Buffer.from('bad|bad').toString('base64url')), null);
  assert.equal(decodeCursor(Buffer.from("2026-01-02T03:04:05Z|x'; drop").toString('base64url')), null);
});
