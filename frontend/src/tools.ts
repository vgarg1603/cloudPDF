export type ToolId = "merge" | "split" | "compress" | "convert" | "organize" | "protect";

export interface Tool {
  id: ToolId;
  name: string;
  summary: string;
  detail: string;
  icon: string;
  accent: string;
}

export const TOOLS: Tool[] = [
  {
    id: "merge",
    name: "Merge PDF",
    summary: "Combine PDFs in the order you want with the easiest PDF merger available.",
    detail: "Put the files in reading order. The worker concatenates every page and returns a single PDF.",
    icon: "⧉",
    accent: "#e5322d",
  },
  {
    id: "split",
    name: "Split PDF",
    summary: "Separate one page or a whole set for easy conversion into independent PDF files.",
    detail: "A range such as 1-3,5 returns one PDF. Splitting every page returns a ZIP.",
    icon: "✂",
    accent: "#e5322d",
  },
  {
    id: "compress",
    name: "Compress PDF",
    summary: "Reduce file size while optimizing for maximal PDF quality.",
    detail: "Lower quality shrinks photos more. Text-only pages change very little, because there is no image to shrink.",
    icon: "⬇",
    accent: "#3b82f6",
  },
  {
    id: "convert",
    name: "PDF to JPG",
    summary: "Convert each PDF page into an image, or turn JPG, PNG and WebP images into a PDF.",
    detail: "Page images come back as a ZIP. Images are placed one per page, in the order shown here.",
    icon: "◫",
    accent: "#f59e0b",
  },
  {
    id: "organize",
    name: "Organize PDF",
    summary: "Sort pages of your PDF however you like. Delete pages or rotate them at your convenience.",
    detail: "The preview is local. Only the final page list is sent with the job.",
    icon: "☰",
    accent: "#8b5cf6",
  },
  {
    id: "protect",
    name: "Protect PDF",
    summary: "Protect PDF files with a password. Encrypt PDF documents to prevent unauthorized access.",
    detail: "The password uses AES-256. It is held only until the worker finishes, then removed. It is never written to the log.",
    icon: "🔒",
    accent: "#111827",
  },
];

export function findTool(id: string | undefined): Tool | undefined {
  return TOOLS.find((tool) => tool.id === id);
}
