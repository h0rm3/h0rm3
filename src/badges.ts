/** GitHub Linguist language name -> devicon slug. Unmapped languages get no badge rather than a guess. */
const DEVICON_SLUGS: Record<string, string> = {
  JavaScript: "javascript",
  TypeScript: "typescript",
  Python: "python",
  Java: "java",
  "C++": "cplusplus",
  C: "c",
  "C#": "csharp",
  Go: "go",
  Rust: "rust",
  Ruby: "ruby",
  PHP: "php",
  Swift: "swift",
  Kotlin: "kotlin",
  HTML: "html5",
  CSS: "css3",
  SCSS: "sass",
  Shell: "bash",
  PowerShell: "powershell",
  Dockerfile: "docker",
  Vue: "vuejs",
  Svelte: "svelte",
  "Objective-C": "objectivec",
  Scala: "scala",
  Dart: "dart",
  Lua: "lua",
  Perl: "perl",
  Haskell: "haskell",
  R: "r",
  "Jupyter Notebook": "jupyter",
  PLpgSQL: "postgresql",
};

const CDN = "https://cdn.jsdelivr.net/gh/devicons/devicon/icons";

/** Only publishes badge URLs that actually resolve (plain variant, then original). */
export async function resolveBadges(languages: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const lang of languages) {
    const slug = DEVICON_SLUGS[lang];
    if (!slug) continue;
    for (const variant of ["plain", "original"]) {
      const url = `${CDN}/${slug}/${slug}-${variant}.svg`;
      const res = await fetch(url, { method: "HEAD" }).catch(() => null);
      if (res?.ok) {
        urls.push(url);
        break;
      }
    }
  }
  return urls;
}
