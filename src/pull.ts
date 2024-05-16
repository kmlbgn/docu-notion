import * as fs from "fs-extra";
import { NotionToMarkdown } from "notion-to-md";
import { HierarchicalNamedLayoutStrategy } from "./HierarchicalNamedLayoutStrategy";
import { LayoutStrategy } from "./LayoutStrategy";
import { NotionPage, PageType } from "./NotionPage";
import { initImageHandling } from "./images";

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
let allTabsPages: Record<string, NotionPage[]> = {};
let currentTabPages: Array<NotionPage>;
let counts = {
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

  verbose(`Options:${JSON.stringify(optionsForLogging, null, 2)}`);
  await initImageHandling(
    options.imgPrefixInMarkdown || options.imgOutputPath || "",
    options.imgOutputPath || "",
    options.locales
  );

  const notionClient = initNotionClient(options.notionToken);
  notionToMarkdown = new NotionToMarkdown({ notionClient });

  info("Connecting to Notion...");

  // Do a quick test to see if we can connect to the root so that we can give a better error than just a generic "could not find page" one.
  try {
    await executeWithRateLimitAndRetries("retrieving root page", async () => {
      await notionClient.pages.retrieve({ page_id: options.rootPage });
    });
  } catch (e: any) {
    error(
      `Nocusaurus could not retrieve the root page from Notion. \r\na) Check that the root page id really is "${
        options.rootPage
      }".\r\nb) Check that your Notion API token (the "Integration Secret") is correct. It starts with "${
        optionsForLogging.notionToken
      }".\r\nc) Check that your root page includes your "integration" in its "connections".\r\nThis internal error message may help:\r\n    ${
        e.message as string
      }`
    );
    exit(1);
  }

  // Create a base folder using markdownOutputPath (default "tabs")
  await fs.mkdir(options.markdownOutputPath.replace(/\/+$/, "").toLowerCase(), { recursive: true });
  
  //TODO group stage 1 should be extracted from getTabs to here
  await getTabs(options, "", "root", options.rootPage);

  group(
    `Stage 2: Convert ${currentTabPages.length} Notion pages to markdown and save locally...`
  );
  // Load config
  const config = await loadConfigAsync();

  await outputPages(options, config, allTabsPages);
  endGroup();
}

async function getTabs(
  options: DocuNotionOptions,
  incomingContext: string,
  parentId: string,
  pageId: string,
) {
  // Create root page to fetch metadata
  const rootPage = await fromPageId(
    "",
    parentId,
    pageId,
    0,
    true,
    false
  );

  // Get all tabs (sub-pages of root page) 
  const r = await getBlockChildren(rootPage.pageId);
  const pageInfo = await rootPage.getContentInfo(r);

  warning(`Scan: Root page is "${rootPage.nameOrTitle}". Scanning for tabs...`);

  // Recursively process each tabs
  for (const tabPageInfo of pageInfo.childPageIdsAndOrder) {
    // Get tabs page metadata
    const currentTab = await fromPageId(
      incomingContext,
      parentId,
      tabPageInfo.id,
      tabPageInfo.order,
      false,
      false
    );

    warning(`Scan: Found tab "${currentTab.nameOrTitle}". Processing tab's pages tree...`);

    // Initalize a structure for this tab
    // TODO this probably dont need to be global
    layoutStrategy = new HierarchicalNamedLayoutStrategy();
    currentTabPages = new Array<NotionPage>();
    
    //TODO: this is static dont need to be looped 
    layoutStrategy.setRootDirectoryForMarkdown(options.markdownOutputPath);

    // Process tab's pages
    group(
      `Stage 1: walk children of tabs "${currentTab.nameOrTitle}"`
    );
    await getTabsPagesRecursively(options, "", options.rootPage, currentTab.pageId, 0);
    logDebug("getPagesRecursively", JSON.stringify(currentTabPages, null, 2));
    info(`Found ${currentTabPages.length} pages`);
    allTabsPages[currentTab.nameOrTitle.toLowerCase()] = currentTabPages;
    endGroup();
  }
}

// getPagesRecursively navigates the root page and iterates over each page within it,
// treating each as an independent tree structure. It constructs a folder structure of pages for sidebar organization,
// preserving the hierarchical order set in Notion.
async function getTabsPagesRecursively(
  options: DocuNotionOptions,
  incomingContext: string,
  parentId: string,
  pageId: string,
  pageOrder: number,
) {
  const currentPage = await fromPageId(
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

  // Case: Category page with an index, which creates a dropdown with content in the sidebar 
  if (
    pageInfo.hasContent &&
    (pageInfo.childPageIdsAndOrder.length || pageInfo.linksPageIdsAndOrder.length)
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

    // Forward Category's index.md and push it into the pages array
    currentPage.layoutContext = layoutContext;
    currentTabPages.push(currentPage);

    // Recursively process child pages and page links
    for (const childPageInfo of pageInfo.childPageIdsAndOrder) {
      await getTabsPagesRecursively(
        options,
        layoutContext,
        currentPage.pageId,
        childPageInfo.id,
        childPageInfo.order,
      );
    }
    for (const linkPageInfo of pageInfo.linksPageIdsAndOrder) {
      currentTabPages.push(
        await fromPageId(
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

  // Case: A category page without index which creates a dropdown without content in the sidebar
  else if (!pageInfo.hasContent && 
    (pageInfo.childPageIdsAndOrder.length || pageInfo.linksPageIdsAndOrder.length)
  ){
    warning(`Scan: Page "${currentPage.nameOrTitle}" only has child pages or links to page; it's a level without index.`);
    
    let layoutContext = layoutStrategy.newLevel(
        options.markdownOutputPath,
        currentPage.order,
        incomingContext,
        currentPage.nameOrTitle
    );

    for (const childPageInfo of pageInfo.childPageIdsAndOrder) {
      await getTabsPagesRecursively(
        options,
        layoutContext,

        currentPage.pageId,
        childPageInfo.id,
        childPageInfo.order,
      );
    }

    for (const linkPageInfo of pageInfo.linksPageIdsAndOrder) {
      currentTabPages.push(
        await fromPageId(
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

  // Case: A simple content page
  else if (pageInfo.hasContent) {
    warning(`Scan: Page "${currentPage.nameOrTitle}" is a simple content page.`);
    currentTabPages.push(currentPage);
  }
  
  // Case: Empty pages and undefined ones
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
  const mdPath = layoutStrategy.getPathForPage(page, ".mdx").toLowerCase();
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
      `The Notion API returned some blocks that were not full blocks. Nocusaurus does not handle this yet. Please report it.`
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
  layoutContext: string,
  parentId: string,
  pageId: string,
  order: number,
  foundDirectlyInOutline: boolean,
  isLink: boolean
): Promise<NotionPage> {
  const metadata = await getPageMetadata(pageId);
  let currentPage = new NotionPage({
    layoutContext: layoutContext,
    parentId,
    pageId,
    order,
    metadata,
    foundDirectlyInOutline,
  });
  if (isLink) {
    warning(`Scan: Page "${currentPage.nameOrTitle}" is a link to a database page.`);
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

async function outputPages(
  options: DocuNotionOptions,
  config: IDocuNotionConfig,
  allTabsPages: Record<string, NotionPage[]>
) {
  const context: IDocuNotionContext = {
    config,
    layoutStrategy,
    options,
    getBlockChildren,
    notionToMarkdown,
    directoryContainingMarkdown: "", 
    relativeFilePathToFolderContainingPage: "", 
    convertNotionLinkToLocalDocusaurusLink: (url: string) => convertInternalUrl(context, url),
    allTabsPages,
    currentTab: "",
    counts, 
    imports: [],
  };

  for (const tab in allTabsPages) {
    const tabPages = allTabsPages[tab];
    context.currentTab = tab;
    context.counts.skipped_because_status = 0;

    for (const page of tabPages) {
      const mdPath = layoutStrategy.getPathForPage(page, ".mdx");
      context.directoryContainingMarkdown = Path.dirname(mdPath);
      context.relativeFilePathToFolderContainingPage = Path.dirname(layoutStrategy.getLinkPathForPage(page));

      if (page.type === PageType.DatabasePage && context.options.statusTag != "*" && page.status !== context.options.statusTag) {
        verbose(`Skipping page because status is not '${context.options.statusTag}': ${page.nameOrTitle}`);
        ++context.counts.skipped_because_status;
      } else {
        const markdown = await getMarkdownForPage(context, page);
        writePage(page, markdown);
      }
    }

    info(`Finished processing ${tab}`);
    // TODO counts needs refactoring (mixing up total per tab and total all tabs) 
    info(JSON.stringify(counts.skipped_because_status));
  }
}