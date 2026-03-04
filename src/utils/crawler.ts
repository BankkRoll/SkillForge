/**
 * SkillForge URL Crawler
 * Extracts content from URLs using Playwright and converts to markdown
 */

import TurndownService from "turndown";
import { JSDOM } from "jsdom";

// ============================================================================
// TYPES
// ============================================================================

export interface CrawlResult {
  url: string;
  title: string;
  description?: string;
  markdown: string;
  links: string[];
  metadata: {
    author?: string;
    publishDate?: string;
    keywords?: string[];
    language?: string;
  };
  success: boolean;
  error?: string;
}

export interface CrawlOptions {
  timeout?: number;
  waitForSelector?: string;
  extractLinks?: boolean;
  maxDepth?: number;
  includeImages?: boolean;
  removeSelectors?: string[];
  headless?: boolean;
}

export interface CrawlSession {
  pages: CrawlResult[];
  totalLinks: number;
  visited: Set<string>;
}

// ============================================================================
// TURNDOWN CONFIGURATION
// ============================================================================

function createTurndownService(options?: {
  includeImages?: boolean;
}): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });

  // Add code block handling
  turndown.addRule("codeBlocks", {
    filter: (node) => {
      return node.nodeName === "PRE" && node.querySelector("code") !== null;
    },
    replacement: (content, node) => {
      const code = (node as HTMLElement).querySelector("code");
      const language = code?.className?.match(/language-(\w+)/)?.[1] || "";
      const text = code?.textContent || content;
      return `\n\`\`\`${language}\n${text.trim()}\n\`\`\`\n`;
    },
  });

  // Handle inline code
  turndown.addRule("inlineCode", {
    filter: (node) => {
      return node.nodeName === "CODE" && node.parentNode?.nodeName !== "PRE";
    },
    replacement: (content) => {
      return `\`${content}\``;
    },
  });

  // Remove images if not needed
  if (!options?.includeImages) {
    turndown.addRule("removeImages", {
      filter: "img",
      replacement: () => "",
    });
  }

  // Handle tables
  turndown.addRule("tables", {
    filter: "table",
    replacement: (content, node) => {
      // Simple table conversion
      const table = node as HTMLTableElement;
      const rows = Array.from(table.querySelectorAll("tr"));

      if (rows.length === 0) return content;

      const lines: string[] = [];

      rows.forEach((row, i) => {
        const cells = Array.from(row.querySelectorAll("th, td"));
        const cellTexts = cells.map((cell) => cell.textContent?.trim() || "");
        lines.push(`| ${cellTexts.join(" | ")} |`);

        // Add header separator after first row
        if (i === 0) {
          lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
        }
      });

      return "\n" + lines.join("\n") + "\n";
    },
  });

  return turndown;
}

// ============================================================================
// CONTENT EXTRACTION
// ============================================================================

function extractMainContent(document: Document): Element | null {
  // Try common content selectors in order of specificity
  const selectors = [
    "article",
    '[role="main"]',
    "main",
    ".content",
    ".post-content",
    ".article-content",
    ".entry-content",
    ".documentation",
    ".docs-content",
    "#content",
    "#main",
    ".main-content",
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (
      element &&
      element.textContent &&
      element.textContent.trim().length > 100
    ) {
      return element;
    }
  }

  // Fallback to body
  return document.body;
}

function removeUnwantedElements(element: Element, selectors: string[]): void {
  const defaultRemove = [
    "script",
    "style",
    "nav",
    "header",
    "footer",
    ".navigation",
    ".nav",
    ".sidebar",
    ".advertisement",
    ".ads",
    ".cookie-banner",
    ".popup",
    ".modal",
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    ".social-share",
    ".comments",
    "#comments",
  ];

  const allSelectors = [...defaultRemove, ...selectors];

  for (const selector of allSelectors) {
    const elements = element.querySelectorAll(selector);
    elements.forEach((el) => el.remove());
  }
}

function extractMetadata(document: Document): CrawlResult["metadata"] {
  const metadata: CrawlResult["metadata"] = {};

  // Author
  const authorMeta = document.querySelector('meta[name="author"]');
  if (authorMeta) {
    metadata.author = authorMeta.getAttribute("content") || undefined;
  }

  // Publish date
  const dateMeta =
    document.querySelector('meta[property="article:published_time"]') ||
    document.querySelector('meta[name="date"]') ||
    document.querySelector("time[datetime]");
  if (dateMeta) {
    metadata.publishDate =
      dateMeta.getAttribute("content") ||
      dateMeta.getAttribute("datetime") ||
      undefined;
  }

  // Keywords
  const keywordsMeta = document.querySelector('meta[name="keywords"]');
  if (keywordsMeta) {
    const content = keywordsMeta.getAttribute("content");
    if (content) {
      metadata.keywords = content.split(",").map((k) => k.trim());
    }
  }

  // Language
  const htmlLang = document.documentElement.getAttribute("lang");
  if (htmlLang) {
    metadata.language = htmlLang;
  }

  return metadata;
}

function extractLinks(element: Element, baseUrl: string): string[] {
  const links: string[] = [];
  const anchors = element.querySelectorAll("a[href]");

  anchors.forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
      try {
        const absoluteUrl = new URL(href, baseUrl).toString();
        links.push(absoluteUrl);
      } catch {
        // Invalid URL, skip
      }
    }
  });

  return [...new Set(links)];
}

// ============================================================================
// CRAWLER CLASS
// ============================================================================

export class Crawler {
  private options: Required<CrawlOptions>;
  private turndown: TurndownService;
  private visited: Set<string> = new Set();

  constructor(options: CrawlOptions = {}) {
    this.options = {
      timeout: options.timeout ?? 30000,
      waitForSelector: options.waitForSelector ?? "body",
      extractLinks: options.extractLinks ?? true,
      maxDepth: options.maxDepth ?? 1,
      includeImages: options.includeImages ?? false,
      removeSelectors: options.removeSelectors ?? [],
      headless: options.headless ?? true,
    };

    this.turndown = createTurndownService({
      includeImages: this.options.includeImages,
    });
  }

  /**
   * Crawl a single URL and extract content
   */
  async crawl(url: string): Promise<CrawlResult> {
    try {
      // Use fetch for basic HTML retrieval (no JavaScript rendering)
      // For JavaScript-heavy sites, Playwright would be used
      const response = await fetch(url, {
        headers: {
          "User-Agent": "SkillForge Crawler/1.0",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(this.options.timeout),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      return this.parseHTML(html, url);
    } catch (error) {
      return {
        url,
        title: "",
        markdown: "",
        links: [],
        metadata: {},
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Crawl using Playwright for JavaScript-rendered content
   */
  async crawlWithPlaywright(url: string): Promise<CrawlResult> {
    try {
      // Dynamic import for Playwright (only when needed)
      const { chromium } = await import("playwright");

      const browser = await chromium.launch({
        headless: this.options.headless,
      });
      const page = await browser.newPage();

      try {
        await page.goto(url, {
          timeout: this.options.timeout,
          waitUntil: "networkidle",
        });

        if (this.options.waitForSelector !== "body") {
          await page.waitForSelector(this.options.waitForSelector, {
            timeout: this.options.timeout,
          });
        }

        const html = await page.content();
        return this.parseHTML(html, url);
      } finally {
        await browser.close();
      }
    } catch (error) {
      // Fallback to basic fetch if Playwright fails
      console.warn(`Playwright crawl failed, falling back to fetch: ${error}`);
      return this.crawl(url);
    }
  }

  /**
   * Parse HTML and convert to markdown
   */
  private parseHTML(html: string, url: string): CrawlResult {
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    // Extract title
    const title =
      document.querySelector("title")?.textContent?.trim() ||
      document.querySelector("h1")?.textContent?.trim() ||
      "Untitled";

    // Extract description
    const description =
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content") ||
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content") ||
      undefined;

    // Get main content
    const mainContent = extractMainContent(document);

    if (!mainContent) {
      return {
        url,
        title,
        description,
        markdown: "",
        links: [],
        metadata: {},
        success: false,
        error: "Could not find main content",
      };
    }

    // Clone to avoid modifying original
    const contentClone = mainContent.cloneNode(true) as Element;

    // Remove unwanted elements
    removeUnwantedElements(contentClone, this.options.removeSelectors);

    // Extract metadata
    const metadata = extractMetadata(document);

    // Extract links before conversion
    const links = this.options.extractLinks
      ? extractLinks(contentClone, url)
      : [];

    // Convert to markdown
    const markdown = this.turndown.turndown(contentClone.innerHTML);

    this.visited.add(url);

    return {
      url,
      title,
      description,
      markdown,
      links,
      metadata,
      success: true,
    };
  }

  /**
   * Crawl multiple URLs with depth control
   */
  async crawlDeep(
    startUrl: string,
    maxPages: number = 10,
  ): Promise<CrawlSession> {
    const session: CrawlSession = {
      pages: [],
      totalLinks: 0,
      visited: new Set(),
    };

    const queue: Array<{ url: string; depth: number }> = [
      { url: startUrl, depth: 0 },
    ];

    while (queue.length > 0 && session.pages.length < maxPages) {
      const { url, depth } = queue.shift()!;

      if (session.visited.has(url)) continue;
      if (depth > this.options.maxDepth) continue;

      session.visited.add(url);

      const result = await this.crawl(url);
      session.pages.push(result);

      if (result.success && depth < this.options.maxDepth) {
        // Filter links to same domain
        const baseHost = new URL(startUrl).host;
        const sameHostLinks = result.links.filter((link) => {
          try {
            return new URL(link).host === baseHost;
          } catch {
            return false;
          }
        });

        session.totalLinks += sameHostLinks.length;

        for (const link of sameHostLinks) {
          if (!session.visited.has(link)) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }
    }

    return session;
  }

  /**
   * Extract specific documentation sections
   */
  async extractDocumentation(
    url: string,
    sections?: string[],
  ): Promise<{
    content: Record<string, string>;
    combined: string;
  }> {
    const result = await this.crawl(url);

    if (!result.success) {
      throw new Error(`Failed to crawl ${url}: ${result.error}`);
    }

    const content: Record<string, string> = {
      full: result.markdown,
    };

    if (sections) {
      const dom = new JSDOM(`<div>${result.markdown}</div>`);
      const doc = dom.window.document;

      for (const section of sections) {
        const sectionEl = doc.querySelector(section);
        if (sectionEl) {
          content[section] = this.turndown.turndown(sectionEl.innerHTML);
        }
      }
    }

    return {
      content,
      combined: result.markdown,
    };
  }
}

// ============================================================================
// STANDALONE FUNCTIONS
// ============================================================================

/**
 * Quick crawl a single URL
 */
export async function crawlUrl(
  url: string,
  options?: CrawlOptions,
): Promise<CrawlResult> {
  const crawler = new Crawler(options);
  return crawler.crawl(url);
}

/**
 * Crawl with Playwright for JavaScript-heavy sites
 */
export async function crawlWithJS(
  url: string,
  options?: CrawlOptions,
): Promise<CrawlResult> {
  const crawler = new Crawler(options);
  return crawler.crawlWithPlaywright(url);
}

/**
 * Crawl multiple pages starting from a URL
 */
export async function crawlSite(
  startUrl: string,
  maxPages: number = 10,
  options?: CrawlOptions,
): Promise<CrawlSession> {
  const crawler = new Crawler(options);
  return crawler.crawlDeep(startUrl, maxPages);
}
