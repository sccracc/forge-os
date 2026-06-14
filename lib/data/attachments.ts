import {
  IMAGE_MIME_TYPES,
  type ImageMimeType,
  type MessageAttachment,
  type MessageAttachments,
  type MessageDocumentAttachment,
  type MessageGeneratedImageAttachment,
  type MessageImageAttachment,
} from "./types";

export function isImageMimeType(value: unknown): value is ImageMimeType {
  return typeof value === "string" && IMAGE_MIME_TYPES.includes(value as ImageMimeType);
}

export function isMessageImageAttachment(value: unknown): value is MessageImageAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Record<string, unknown>;
  return (
    attachment.type === "image" &&
    typeof attachment.base64 === "string" &&
    isImageMimeType(attachment.mimeType)
  );
}

export function getImageAttachment(value: unknown): MessageImageAttachment | undefined {
  if (isMessageImageAttachment(value)) return value;
  if (Array.isArray(value)) return value.find(isMessageImageAttachment);
  return undefined;
}

/** All image attachments (a message can carry several). */
export function getImageAttachments(value: unknown): MessageImageAttachment[] {
  if (isMessageImageAttachment(value)) return [value];
  if (Array.isArray(value)) return value.filter(isMessageImageAttachment);
  return [];
}

export function isMessageDocumentAttachment(
  value: unknown
): value is MessageDocumentAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Record<string, unknown>;
  return attachment.type === "document" && typeof attachment.name === "string";
}

export function getDocumentAttachments(value: unknown): MessageDocumentAttachment[] {
  if (isMessageDocumentAttachment(value)) return [value];
  if (Array.isArray(value)) return value.filter(isMessageDocumentAttachment);
  return [];
}

export function isMessageGeneratedImageAttachment(
  value: unknown
): value is MessageGeneratedImageAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Record<string, unknown>;
  return (
    attachment.type === "generated_image" &&
    typeof attachment.imageUrl === "string" &&
    attachment.imageUrl.length > 0 &&
    typeof attachment.prompt === "string"
  );
}

export function getGeneratedImageAttachments(
  value: unknown
): MessageGeneratedImageAttachment[] {
  if (isMessageGeneratedImageAttachment(value)) return [value];
  if (Array.isArray(value)) return value.filter(isMessageGeneratedImageAttachment);
  return [];
}

export function normalizeMessageAttachments(value: unknown): MessageAttachments | undefined {
  if (
    isMessageImageAttachment(value) ||
    isMessageGeneratedImageAttachment(value) ||
    isMessageDocumentAttachment(value)
  ) {
    return value;
  }
  if (!Array.isArray(value)) return undefined;

  const normalized: MessageAttachment[] = [];
  for (const item of value) {
    if (
      isMessageImageAttachment(item) ||
      isMessageGeneratedImageAttachment(item) ||
      isMessageDocumentAttachment(item)
    ) {
      normalized.push(item);
    }
  }
  return normalized.length ? normalized : undefined;
}

export function imageAttachmentToDataUrl(image: MessageImageAttachment): string {
  return `data:${image.mimeType};base64,${image.base64}`;
}
