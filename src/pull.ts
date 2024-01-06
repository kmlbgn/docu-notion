import * as fs from "fs-extra";
import { NotionToMarkdown } from "notion-to-md";
import { HierarchicalNamedLayoutStrategy } from "./HierarchicalNamedLayoutStrategy";
import { LayoutStrategy } from "./LayoutStrategy";
import { NotionPage, PageType } from "./NotionPage";
import { initImageHandling, cleanupOldImages } from "./images";

import * as Path from "path";
import {
  endGroup,
  error,
  group,
  info,
  logDebug,
  verbose,
  warning,
} from "./log";
import { IDocuNotionContext } from "./plugins/pluginTypes";
import { getMarkdownForPage } from "./transform";
import {
  BlockObjectResponse,
  GetPageResponse,
  ListBlockChildrenResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { RateLimiter } from "limiter";
import { Client, isFullBlock } from "@notionhq/client";
import { exit } from "process";
import { IDocuNotionConfig, loadConfigAsync } from "./config/configuration";
import { NotionBlock } from "./types";
import { convertInternalUrl } from "./plugins/internalLinks";
import { ListBlockChildrenResponseResults } from "notion-to-md/build/types";

export type DocuNotionOptions = {
  notionToken: string;
  rootPage: string;
  locales: string[];
  markdownOutputPath: string;
  imgOutputPath: string;
  imgPrefixInMarkdown: string;
  statusTag: string;
};

let layoutStrategy: LayoutStrategy;
let notionToMarkdown: NotionToMarkdown;
const pages = new Array<NotionPage>();
const counts = {
  output_normally: 0,
  skipped_because_empty: 0,
  skipped_because_status: 0,
};

export async function notionPull(options: DocuNotionOptions): Promise<void> {
  // It's helpful when troubleshooting CI secrets and environment variables to see what options actually made it to docu-notion.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const optionsForLogging = { ...options };
  // Just show the first few letters of the notion token, which start with "secret" anyhow.
  optionsForLogging.notionToken =
    optionsForLogging.notionToken.substring(0, 10) + "...";

  const config = await loadConfigAsync();

  verbose(`Options:${JSON.stringify(optionsForLogging, null, 2)}`);
  await initImageHandling(
    options.imgPrefixInMarkdown || options.imgOutputPath || "",
    options.imgOutputPath || "",
    options.locales
  );

  const notionClient = initNotionClient(options.notionToken);
  notionToMarkdown = new NotionToMarkdown({ notionClient });

  layoutStrategy = new HierarchicalNamedLayoutStrategy();

  // Create output folder
  await fs.mkdir(options.markdownOutputPath, { recursive: true });
  layoutStrategy.setRootDirectoryForMarkdown(
    options.markdownOutputPath.replace(/\/+$/, "") // trim any trailing slash
  );

  // Create a 'tmp' folder for custom pages
  await fs.mkdir(options.markdownOutputPath.replace(/\/+$/, "") + '/tmp', { recursive: true });

  info("Connecting to Notion...");

  // Do a quick test to see if we can connect to the root so that we can give a better error than just a generic "could not find page" one.
  try {
    await executeWithRateLimitAndRetries("retrieving root page", async () => {
      await notionClient.pages.retrieve({ page_id: options.rootPage });
    });
  } catch (e: any) {
    error(
      `docu-notion could not retrieve the root page from Notion. \r\na) Check that the root page id really is "${
        options.rootPage
      }".\r\nb) Check that your Notion API token (the "Integration Secret") is correct. It starts with "${
        optionsForLogging.notionToken
      }".\r\nc) Check that your root page includes your "integration" in its "connections".\r\nThis internal error message may help:\r\n    ${
        e.message as string
      }`
    );
    exit(1);
  }

  group(
    "Stage 1: walk children of the page named 'Outline', looking for pages..."
  );
  await getPagesRecursively(options, "", options.rootPage, options.rootPage, 0, true);
  logDebug("getPagesRecursively", JSON.stringify(pages, null, 2));
  info(`Found ${pages.length} pages`);
  endGroup();
  group(
    `Stage 2: convert ${pages.length} Notion pages to markdown and save locally...`
  );
  await outputPages(options, config, pages);
  endGroup();
  group("Stage 3: clean up old files & images...");
  await layoutStrategy.cleanupOldFiles();
  await cleanupOldImages();
  endGroup();
}

async function outputPages(
  options: DocuNotionOptions,
  config: IDocuNotionConfig,
  pages: Array<NotionPage>
) {
  const context: IDocuNotionContext = {
    config: config,
    layoutStrategy: layoutStrategy,
    options: options,
    getBlockChildren: getBlockChildren,
    notionToMarkdown: notionToMarkdown,
    directoryContainingMarkdown: "", // this changes with each page
    relativeFilePathToFolderContainingPage: "", // this changes with each page
    convertNotionLinkToLocalDocusaurusLink: (url: string) =>
      convertInternalUrl(context, url),
    pages: pages,
    counts: counts, // review will this get copied or pointed to?
    imports: [],

  };
  for (const page of pages) {
    layoutStrategy.pageWasSeen(page);
    const mdPath = layoutStrategy.getPathForPage(page, ".mdx");

    // most plugins should not write to disk, but those handling image files need these paths
    context.directoryContainingMarkdown = Path.dirname(mdPath);
    // TODO: This needs clarifying: getLinkPathForPage() is about urls, but
    // downstream images.ts is using it as a file system path
    context.relativeFilePathToFolderContainingPage = Path.dirname(
      layoutStrategy.getLinkPathForPage(page)
    );

    if (
      page.type === PageType.DatabasePage &&
      context.options.statusTag != "*" &&
      page.status !== context.options.statusTag
    ) {
      verbose(
        `Skipping page because status is not '${context.options.statusTag}': ${page.nameOrTitle}`
      );
      ++context.counts.skipped_because_status;
    } else {
      //TODO: config no longer needs to be passed now that it is part of context
      const markdown = await getMarkdownForPage(config, context, page);
      writePage(page, markdown);
    }
  }

  info(`Finished processing ${pages.length} pages`);
  info(JSON.stringify(counts));
}

// This walks the "Outline" page and creates a list of all the nodes that will
// be in the sidebar, including the directories, the pages that are linked to
// that are parented in from the "Database", and any pages we find in the
// outline that contain content (which we call "Simple" pages). Later, we can
// then step through this list creating the files we need, and, crucially, be
// able to figure out what the url will be for any links between content pages.
async function getPagesRecursively(
  options: DocuNotionOptions,
  incomingContext: string,
  parentId: string,
  pageId: string,
  pageOrder: number,
  rootLevel: boolean
) {
  const currentPage = await fromPageId(
    options,
    incomingContext,
    parentId,
    pageId,
    pageOrder,
    true,
    false
  );

  info(
    `Looking for children and links from ${incomingContext}/${currentPage.nameOrTitle}`
  );

  const r = await getBlockChildren(currentPage.pageId);
  const pageInfo = await currentPage.getContentInfo(r);

  // case: root page
  if (
    currentPage.pageId == parentId
  ){
    warning(`Scan: Root page is "${currentPage.nameOrTitle}". Scanning...`);
    let layoutContext = incomingContext; 

    // Recursively process each child page...
    for (const childPageInfo of pageInfo.childPageIdsAndOrder) {
      await getPagesRecursively(
        options,
        layoutContext,
        currentPage.pageId,
        childPageInfo.id,
        childPageInfo.order,
        false
      );
    }
    // ... and links to page.
    for (const linkPageInfo of pageInfo.linksPageIdsAndOrder) {
      pages.push(
        await fromPageId(
          options,
          layoutContext,
          currentPage.pageId,
          linkPageInfo.id,
          linkPageInfo.order,
          false,
          true
        )
      );
    }
  }

  // case: custom page contained in the root page to be moved into Docusaurus src/pages folder, except the Outline.
  else if (
    currentPage.nameOrTitle != "Outline" &&
    currentPage.parentId == options.rootPage &&
    currentPage.pageId != options.rootPage
    // pageInfo.hasContent
  ){
    warning(`Scan: Page "${currentPage.nameOrTitle}" is outside the Outline, it will be stored in "src/pages" to be used as your convenience.`);
    // Set subtype flag
    (currentPage.metadata as any).parent.subtype = "custom";
    pages.push(currentPage);
  }

  // case: Category page with an index 
  else if (
    !rootLevel &&
    pageInfo.hasContent &&
    (pageInfo.childPageIdsAndOrder.length > 0 || pageInfo.linksPageIdsAndOrder.length > 0)
  ){
    warning(`Scan: Page "${currentPage.nameOrTitle}" contains both childrens and content so it should produce a level with an index page.`);

    // Set subtype flag
    (currentPage.metadata as any).parent.subtype = "categoryindex";
    
    // Add a new level for this page
    let layoutContext = layoutStrategy.newLevel(
      options.markdownOutputPath,
      currentPage.order,
      incomingContext,
      currentPage.nameOrTitle
    );

    // Forward level for index.md and push it into the pages array
    currentPage.layoutContext = layoutContext;
    pages.push(currentPage);

    // Recursively process each child page and page link
    for (const childPageInfo of pageInfo.childPageIdsAndOrder) {
      await getPagesRecursively(
        options,
        layoutContext,
        currentPage.pageId,
        childPageInfo.id,
        childPageInfo.order,
        false
      );
    }
    for (const linkPageInfo of pageInfo.linksPageIdsAndOrder) {
      pages.push(
        await fromPageId(
          options,
          layoutContext,
          currentPage.pageId,
          linkPageInfo.id,
          linkPageInfo.order,
          false,
          true
        )
      );
    }
  }
  // case: a simple content page
  else if (!rootLevel && pageInfo.hasContent) {
    warning(`Scan: Page "${currentPage.nameOrTitle}" is a simple content page.`);
    pages.push(currentPage);
  }

  // case: A category page without index that exists just to create the level in the sidebar
  else if (
    pageInfo.childPageIdsAndOrder.length ||
    pageInfo.linksPageIdsAndOrder.length
  ) {
    warning(`Scan: Page "${currentPage.nameOrTitle}" only has child pages or links to page; it's a level without index.`);
    let layoutContext = incomingContext;
    // don't make a level for "Outline" page at the root
    if (!rootLevel && currentPage.nameOrTitle !== "Outline") {
      layoutContext = layoutStrategy.newLevel(
        options.markdownOutputPath,
        currentPage.order,
        incomingContext,
        currentPage.nameOrTitle
      );
    }
    for (const childPageInfo of pageInfo.childPageIdsAndOrder) {
      await getPagesRecursively(
        options,
        layoutContext,
        currentPage.pageId,
        childPageInfo.id,
        childPageInfo.order,
        false
      );
    }

    for (const linkPageInfo of pageInfo.linksPageIdsAndOrder) {
      pages.push(
        await fromPageId(
          options,
          layoutContext,
          currentPage.pageId,
          linkPageInfo.id,
          linkPageInfo.order,
          false,
          true
        )
      );
    }
  } 
  
  // case: empty pages and undefined ones
  else {
    console.info(
      warning(
        `Warning: The page "${currentPage.nameOrTitle}" is in the outline but appears to not have content, links to other pages, or child pages. It will be skipped.`
      )
    );
    ++counts.skipped_because_empty;
  }
}

function writePage(page: NotionPage, finalMarkdown: string) {
  const mdPath = layoutStrategy.getPathForPage(page, ".mdx");
  verbose(`writing ${mdPath}`);
  fs.writeFileSync(mdPath, finalMarkdown, {});
  ++counts.output_normally;
}

const notionLimiter = new RateLimiter({
  tokensPerInterval: 3,
  interval: "second",
});

let notionClient: Client;

async function getPageMetadata(id: string): Promise<GetPageResponse> {
  return await executeWithRateLimitAndRetries(`pages.retrieve(${id})`, () => {
    return notionClient.pages.retrieve({
      page_id: id,
    });
  });
}

// While everything works fine locally, on Github Actions we are getting a lot of timeouts, so
// we're trying this extra retry-able wrapper.
export async function executeWithRateLimitAndRetries<T>(
  label: string,
  asyncFunction: () => Promise<T>
): Promise<T> {
  await rateLimit();
  const kRetries = 10;
  let lastException = undefined;
  for (let i = 0; i < kRetries; i++) {
    try {
      return await asyncFunction();
    } catch (e: any) {
      lastException = e;
      if (
        e?.code === "notionhq_client_request_timeout" ||
        e.message.includes("timeout") ||
        e.message.includes("Timeout") ||
        e.message.includes("limit") ||
        e.message.includes("Limit") ||
        e?.code === "notionhq_client_response_error" ||
        e?.code === "service_unavailable"
      ) {
        const secondsToWait = i + 1;
        warning(
          `While doing "${label}", got error "${
            e.message as string
          }". Will retry after ${secondsToWait}s...`
        );
        await new Promise(resolve => setTimeout(resolve, 1000 * secondsToWait));
      } else {
        throw e;
      }
    }
  }

  error(`Error: could not complete "${label}" after ${kRetries} retries.`);
  throw lastException;
}

async function rateLimit() {
  if (notionLimiter.getTokensRemaining() < 1) {
    logDebug("rateLimit", "*** delaying for rate limit");
  }
  await notionLimiter.removeTokens(1);
}

async function getBlockChildren(id: string): Promise<NotionBlock[]> {
  // we can only get so many responses per call, so we set this to
  // the first response we get, then keep adding to its array of blocks
  // with each subsequent response
  let overallResult: ListBlockChildrenResponse | undefined = undefined;
  let start_cursor: string | undefined | null = undefined;

  // Note: there is a now a collectPaginatedAPI() in the notion client, so
  // we could switch to using that (I don't know if it does rate limiting?)
  do {
    const response: ListBlockChildrenResponse =
      await executeWithRateLimitAndRetries(`getBlockChildren(${id})`, () => {
        return notionClient.blocks.children.list({
          start_cursor: start_cursor as string | undefined,
          block_id: id,
        });
      });

    if (!overallResult) {
      overallResult = response;
    } else {
      overallResult.results.push(...response.results);
    }

    start_cursor = response?.next_cursor;
  } while (start_cursor != null);

  if (overallResult?.results?.some(b => !isFullBlock(b))) {
    error(
      `The Notion API returned some blocks that were not full blocks. docu-notion does not handle this yet. Please report it.`
    );
    exit(1);
  }

  const result = (overallResult?.results as BlockObjectResponse[]) ?? [];
  numberChildrenIfNumberedList(result);
  return result;
}
export function initNotionClient(notionToken: string): Client {
  notionClient = new Client({
    auth: notionToken,
  });
  return notionClient;
}
async function fromPageId(
  options: DocuNotionOptions,
  context: string,
  parentId: string,
  pageId: string,
  order: number,
  foundDirectlyInOutline: boolean,
  isLink: boolean
): Promise<NotionPage> {
  const metadata = await getPageMetadata(pageId);
  let currentPage = new NotionPage({
    layoutContext: context,
    parentId,
    pageId,
    order,
    metadata,
    foundDirectlyInOutline,
  });
  if (isLink) {
    if (
      parentId == options.rootPage &&
      pageId != options.rootPage &&
      currentPage.nameOrTitle != "Outline"
    ) {
      (currentPage.metadata as any).parent.subtype = "custom";
      warning(`Scan: Page "${currentPage.nameOrTitle}" is a link outside the Outline, it will be stored in "src/pages" to be used as your convenience.`);
    } else {
      warning(`Scan: Page "${currentPage.nameOrTitle}" is a link to a page.`);
    }
  }
  
  //logDebug("notion metadata", JSON.stringify(metadata));
  return currentPage
}

// This function is copied (and renamed from modifyNumberedListObject) from notion-to-md.
// They always run it on the results of their getBlockChildren.
// When we use our own getBlockChildren, we need to run it too.
export function numberChildrenIfNumberedList(
  blocks: ListBlockChildrenResponseResults
): void {
  let numberedListIndex = 0;

  for (const block of blocks) {
    if ("type" in block && block.type === "numbered_list_item") {
      // add numbers
      // @ts-ignore
      block.numbered_list_item.number = ++numberedListIndex;
    } else {
      numberedListIndex = 0;
    }
  }
}
