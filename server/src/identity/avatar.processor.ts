import sharp from "sharp";
import { AVATAR_OUTPUT_SIZE_PX } from "./avatar.rules.js";
import { apiError } from "./errors.js";

export async function processAvatarImage(source: Buffer): Promise<Buffer> {
  try {
    return await sharp(source, { limitInputPixels: 16_777_216 })
      .rotate()
      .resize(AVATAR_OUTPUT_SIZE_PX, AVATAR_OUTPUT_SIZE_PX, {
        fit: "cover",
        position: "centre",
      })
      .webp({ quality: 86 })
      .toBuffer();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AVATAR_PROCESSING_FAILED";
    throw apiError(
      "AVATAR_PROCESSING_FAILED",
      `AVATAR_PROCESSING_FAILED: ${message}`,
    );
  }
}
