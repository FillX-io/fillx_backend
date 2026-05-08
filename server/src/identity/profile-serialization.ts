import { buildAvatarPublicUrl } from "./avatar.rules.js";

export type AvatarBackedProfile = { avatar_key: string | null };

export function serializeAvatarUrl(
  profile: AvatarBackedProfile,
  publicBaseUrl = process.env.AVATAR_PUBLIC_BASE_URL ?? "",
): string | null {
  return buildAvatarPublicUrl({
    publicBaseUrl,
    avatarKey: profile.avatar_key,
  });
}
