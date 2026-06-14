import { Space_Grotesk, JetBrains_Mono } from "next/font/google";

// UI / body — Space Grotesk (Molten §5.1)
export const fontSans = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

// Code / mono / metadata — JetBrains Mono (Molten §5.1)
export const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
