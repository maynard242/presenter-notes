export interface ParsedFrontmatter {
  title: string | null;
  event: string | null;
  eventDate: string | null;
  tags: string[];
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { title: null, event: null, eventDate: null, tags: [], body: raw };
  }

  const yamlBlock = match[1];
  const body = match[2];

  const titleMatch = yamlBlock.match(/^title:\s*(.+)$/m);
  const eventMatch = yamlBlock.match(/^event:\s*(.+)$/m);
  const dateMatch = yamlBlock.match(/^(?:date|eventDate):\s*(.+)$/m);
  const tagsInline = yamlBlock.match(/^tags:\s*\[([^\]]*)\]/m);
  const tagsList = yamlBlock.match(/^tags:\s*\n((?:\s+-\s*.+\n?)+)/m);

  let tags: string[] = [];
  if (tagsInline) {
    tags = tagsInline[1]
      .split(",")
      .map((t) => t.trim().replace(/['"]/g, ""))
      .filter(Boolean);
  } else if (tagsList) {
    tags = tagsList[1]
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
  }

  const strip = (s: string) => s.trim().replace(/^['"]|['"]$/g, "");

  return {
    title: titleMatch ? strip(titleMatch[1]) : null,
    event: eventMatch ? strip(eventMatch[1]) : null,
    eventDate: dateMatch ? strip(dateMatch[1]) : null,
    tags,
    body: body.trim(),
  };
}
