import { describe, expect, it } from "vitest";
import { chatRequestSchema } from "@/lib/ai/types";
import {
  getGeneratedImageAttachments,
  getImageAttachment,
  getImageAttachments,
  getDocumentAttachments,
  imageAttachmentToDataUrl,
} from "@/lib/data/attachments";
import type {
  MessageDoc,
  MessageDocumentAttachment,
  MessageGeneratedImageAttachment,
  MessageImageAttachment,
} from "@/lib/data/types";
import { messageToInsert, rowToMessage } from "@/lib/supabase/mappers";

const image: MessageImageAttachment = {
  type: "image",
  base64: "Zm9yZ2U=",
  mimeType: "image/png",
};

const generatedImage: MessageGeneratedImageAttachment = {
  type: "generated_image",
  imageUrl: "https://img.example/forge.png",
  prompt: "A cinematic Forge OS workstation rendered in warm industrial light.",
};

const document: MessageDocumentAttachment = { type: "document", name: "report.pdf" };

describe("vision attachment contract", () => {
  it("accepts multiple images, documents, and scanned PDFs on chat requests", () => {
    const parsed = chatRequestSchema.parse({
      messages: [{ role: "user", content: "what do you see?" }],
      forgeModelId: "spark-2.5",
      effort: "medium",
      thinking: false,
      attachedImages: [
        { base64: image.base64, mimeType: image.mimeType },
        { base64: "c2Vjb25k", mimeType: "image/jpeg" },
      ],
      documents: [{ name: "notes.pdf", text: "hello world" }],
      scannedPdfs: [{ name: "scan.pdf", pages: [{ base64: "cGFnZQ==", mimeType: "image/png" }] }],
    });

    expect(parsed.attachedImages).toHaveLength(2);
    expect(parsed.documents).toEqual([{ name: "notes.pdf", text: "hello world" }]);
    expect(parsed.scannedPdfs?.[0].pages).toHaveLength(1);
  });

  it("round-trips image attachments through the Supabase message mapper", () => {
    const message: MessageDoc = {
      id: "msg_1",
      role: "user",
      content: "look at this",
      parentId: null,
      createdAt: Date.UTC(2026, 0, 2),
      attachments: image,
    };

    const row = messageToInsert(message, "uid_1", "conv_1");
    expect(row.attachments).toEqual(image);

    const mapped = rowToMessage({
      id: "msg_1",
      role: "user",
      content: "look at this",
      parent_id: null,
      created_at: new Date(message.createdAt).toISOString(),
      attachments: row.attachments,
    });

    expect(getImageAttachment(mapped.attachments)).toEqual(image);
    expect(imageAttachmentToDataUrl(image)).toBe("data:image/png;base64,Zm9yZ2U=");
  });

  it("round-trips generated image attachments through the Supabase message mapper", () => {
    const message: MessageDoc = {
      id: "msg_2",
      role: "assistant",
      content: "",
      parentId: "msg_1",
      createdAt: Date.UTC(2026, 0, 3),
      attachments: generatedImage,
    };

    const row = messageToInsert(message, "uid_1", "conv_1");
    expect(row.attachments).toEqual(generatedImage);

    const mapped = rowToMessage({
      id: "msg_2",
      role: "assistant",
      content: "",
      parent_id: "msg_1",
      created_at: new Date(message.createdAt).toISOString(),
      attachments: row.attachments,
    });

    expect(getGeneratedImageAttachments(mapped.attachments)).toEqual([generatedImage]);
  });

  it("extracts multiple images and document chips from a mixed attachment array", () => {
    const second: MessageImageAttachment = { type: "image", base64: "c2Vjb25k", mimeType: "image/jpeg" };
    const analyzedDoc: MessageDocumentAttachment = { type: "document", name: "scan.pdf", analyzed: true };
    const mixed = [image, second, document, analyzedDoc];

    expect(getImageAttachments(mixed)).toEqual([image, second]);
    expect(getDocumentAttachments(mixed)).toEqual([document, analyzedDoc]);
    // The singular helper still returns the first image (back-compat).
    expect(getImageAttachment(mixed)).toEqual(image);
  });

  it("round-trips a document attachment chip through the Supabase mapper", () => {
    const message: MessageDoc = {
      id: "msg_3",
      role: "user",
      content: "summarize this",
      parentId: null,
      createdAt: Date.UTC(2026, 0, 4),
      attachments: [image, document],
    };

    const row = messageToInsert(message, "uid_1", "conv_1");
    const mapped = rowToMessage({
      id: "msg_3",
      role: "user",
      content: "summarize this",
      parent_id: null,
      created_at: new Date(message.createdAt).toISOString(),
      attachments: row.attachments,
    });

    expect(getImageAttachments(mapped.attachments)).toEqual([image]);
    expect(getDocumentAttachments(mapped.attachments)).toEqual([document]);
  });
});
