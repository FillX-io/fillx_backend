import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { processAvatarImage } from "./avatar.processor.js";

test("processAvatarImage returns a square 512px WebP image", async () => {
  const source = await sharp({
    create: {
      width: 64,
      height: 32,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();

  const output = await processAvatarImage(source);
  const metadata = await sharp(output).metadata();

  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
});

test("processAvatarImage rejects invalid image bytes", async () => {
  await assert.rejects(
    processAvatarImage(Buffer.from("not an image")),
    /AVATAR_PROCESSING_FAILED/,
  );
});
