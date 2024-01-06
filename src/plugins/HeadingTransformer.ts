import { NotionBlock } from "../types";
import { IPlugin } from "./pluginTypes";
import { logDebug, warning } from "../log";

// Makes links to headings work in docusaurus
// https://github.com/sillsdev/docu-notion/issues/20
async function headingTransformer(
  block: NotionBlock
): Promise<string> {
  // First, remove the prefix we added to the heading type
  (block as any).type = block.type.replace("DN_", "");

  const markdown = await headingToMarkdown(block);
  

  logDebug(
    "headingTransformer, markdown of a heading before adding id",
    markdown
  );
  warning(
    `[headingTransformer] Parsed ${markdown}`
  );

  // To make heading links work in docusaurus, we append an id. E.g.
  //  ### Hello World {#my-explicit-id}
  // See https://docusaurus.io/docs/markdown-features/toc#heading-ids.

  // For some reason, inline links come in without the dashes, so we have to strip
  // dashes here to match them.
  //console.log("block.id", block.id)
  const blockIdWithoutDashes = block.id.replaceAll("-", "");

  // Finally, append the block id so that it can be the target of a link.
  
  return `${markdown} {#${blockIdWithoutDashes}}`;
}

export const standardHeadingTransformer: IPlugin = {
  name: "standardHeadingTransformer",

  // AP wrote: We have to do this because if
  // we simply set a custom transformer to heading_n, it will keep
  // recursively calling this code, with blockToMarkdown using the custom transformer
  // over and over. Instead, we want blockToMarkdown to give us the normal
  // result, to which we will append the block ID to enable heading links.
  // Also we increment heading number by one because Docusaurus does not display heading_1 as it is considered reserved for the page title.
  // If we do not do so, we loose 1 out of 3 existing heading types in Notion... sad. 
  notionBlockModifications: [
    {
      modify: (block: NotionBlock) => {
        (block as any).type = block.type.replace("heading", "DN_heading");
      },
    },
  ],
  // then when it comes time to do markdown conversions, we'll get called for each of these
  notionToMarkdownTransforms: [
    {
      type: "DN_heading_1",
      getStringFromBlock: (context, block) =>
        headingTransformer(block),
    },
    {
      type: "DN_heading_2",
      getStringFromBlock: (context, block) =>
        headingTransformer(block),
    },
    {
      type: "DN_heading_3",
      getStringFromBlock: (context, block) =>
        headingTransformer(block),
    },
  ],
};

function headingToMarkdown(block: NotionBlock) {
  let content = "";
  const { type } = block;

  switch (type) {
      case "heading_1":
          content = block.heading_1.rich_text.map((item: any) => item.plain_text).join("");
          return `## ${sanitize(content)}`;

      case "heading_2":
          content = block.heading_2.rich_text.map((item: any) => item.plain_text).join("");
          return `### ${sanitize(content)}`;

      case "heading_3":
          content = block.heading_3.rich_text.map((item: any) => item.plain_text).join("");
          return `#### ${sanitize(content)}`;

      default:
          return ""; // Ignore all other types
  }
}

function sanitize(text: string) {
  // Remove Markdown bold and italic formatting
  const cleanedText = text.replace(/[*_]/g, '');

  const words = cleanedText.split(' ');

  // Capitalize the first word and lowercase the rest
  return words.map((word, index) => index === 0 ? 
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() :
    word.toLowerCase()
  ).join(' ');
}
