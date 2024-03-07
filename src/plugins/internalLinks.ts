import { IDocuNotionContext, IPlugin } from "./pluginTypes";
import { warning, verbose } from "../log";
import { NotionPage } from "../NotionPage";

/**
 * Converts an external URL to a local link if it's a link to a page on the Notion site.
 * Intended for plugin use; normally, Notion doesn't provide raw URLs.
 * Returns undefined if the page cannot be found or if no match is found.
 */
export function convertInternalUrl(context: IDocuNotionContext, url: string): string | undefined {
  const kGetIDFromNotionURL = /https:\/\/www\.notion\.so\/([a-z0-9]+).*/;
  const match = kGetIDFromNotionURL.exec(url);
  if (match === null) {
    warning(`Could not parse link ${url} as a Notion URL`);
    return undefined;
  }

  const id = match[1];
  let targetPage: { page: NotionPage | undefined, tab: string | undefined } = { page: undefined, tab: undefined };  for (const tab in context.allTabsPages) {
    const foundPage = context.allTabsPages[tab].find(p => p.matchesLinkId(id));
    if (foundPage) {
      targetPage = { page: foundPage, tab: tab };
      break; // Exit the loop once a matching page is found
    }
  }

  if (targetPage.page && targetPage.tab) {
      return convertLinkHref(context, targetPage.tab, targetPage.page, url); 
  } else {
    warning(`Could not find the target of this link. Links to outline sections are not supported. ${url}.`);
    return `${id}[broken link]`;
  }
}

/**
 * Converts a markdown link to a local link if it's a Notion page link.
 * Skips conversion for image links and links that cannot be resolved to local targets.
 * Returns the original markdown link if it cannot be parsed or converted.
 */
function convertInternalLink(context: IDocuNotionContext, markdownLink: string): string {
  const linkRegExp = /\[([^\]]+)?\]\((?!mailto:)(https:\/\/www\.notion\.so\/[^)]+|\/[^),]+)\)/g;
  const match = linkRegExp.exec(markdownLink);
  if (match === null) {
    warning(`Could not parse link ${markdownLink}`);
    return markdownLink;
  }

  let hrefFromNotion = match[2];
  const labelFromNotion = match[1] || "";
  const imageFileExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg'];
  const isImageLink = imageFileExtensions.some(ext => hrefFromNotion.endsWith(ext));
  if (isImageLink) {
    verbose(`${hrefFromNotion} is an internal image link and will be skipped.`);
    return markdownLink;
  }

  const lastSpecialCharIndex = Math.max(hrefFromNotion.lastIndexOf('-'), hrefFromNotion.lastIndexOf('/'));
  if (lastSpecialCharIndex !== -1) {
      hrefFromNotion = hrefFromNotion.substring(lastSpecialCharIndex + 1);
  }

  let targetPage: { page: NotionPage | undefined, tab: string | undefined } = { page: undefined, tab: undefined };  for (const tab in context.allTabsPages) {
    const foundPage = context.allTabsPages[tab].find(p => p.matchesLinkId(hrefFromNotion));
    if (foundPage) {
      targetPage = { page: foundPage, tab: tab };
      break;
    }
  }

  if (targetPage.page && targetPage.tab) {
    const label = convertLinkLabel(targetPage.page, labelFromNotion);
    const url = convertLinkHref(context, targetPage.tab, targetPage.page, hrefFromNotion);
    return `[${label}](${url})`;
  } else {
    warning(`Could not find a local target for ${hrefFromNotion}.`);
    return `${labelFromNotion}[broken link]`;
  }
}

/**
 * Fixes the link label if it's a "mention" to display the page name or title instead.
 */
function convertLinkLabel(targetPage: NotionPage, text: string): string {
  return text === "mention" ? targetPage.nameOrTitle : text;
}

/**
* Converts the URL to a local link format based on the context of the current tab.
* Appends fragment identifiers to the link if they exist.
* Note: The official Notion API does not include links to headings unless they are part of an inline link.
*/
function convertLinkHref(
 context: IDocuNotionContext,
 tab: string, 
 page: NotionPage,
 url: string
): string {
 let convertedLink = "/" + tab + context.layoutStrategy.getLinkPathForPage(page);

 // Extract the fragment identifier from the URL, if it exists
 const { fragmentId } = parseLinkId(url);
 if (fragmentId !== "") {
   verbose(`[InternalLinkPlugin] Extracted Fragment ID from ${url}: ${fragmentId}`);
 }
 convertedLink += fragmentId;

 return convertedLink;
}


/**
 * Extracts the base link ID and fragment identifier from a full link ID.
 */
export function parseLinkId(fullLinkId: string): { baseLinkId: string; fragmentId: string } {
  const iHash = fullLinkId.indexOf("#");
  if (iHash >= 0) {
    return {
      baseLinkId: fullLinkId.substring(0, iHash),
      fragmentId: fullLinkId.substring(iHash),
    };
  }
  return { baseLinkId: fullLinkId, fragmentId: "" };
}

/**
 * Plugin for converting internal links to local links within Notion pages.
 * Handles both "raw" and "inline" link formats from the Notion or notion-md source.
 */
export const standardInternalLinkConversion: IPlugin = {
  name: "InternalLinkPlugin",
  linkModifier: {
    match: /\[([^\]]+)?\]\((?!mailto:)(https:\/\/www\.notion\.so\/[^)]+|\/[^),]+)\)/,
    convert: convertInternalLink,
  },
};
