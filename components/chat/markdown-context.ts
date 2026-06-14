"use client";

import { createContext } from "react";

/** True while the surrounding message is still streaming (drives the
 *  "creating file" artifact animation). */
export const ArtifactStreaming = createContext(false);

export type ArtifactSurface = "chat" | "dock";

/** Where a code block is rendered: "chat" opens the slide-in side panel,
 *  "dock" (Forge Code) opens a modal since there's no chat side panel there. */
export const ArtifactSurfaceCtx = createContext<ArtifactSurface>("chat");
