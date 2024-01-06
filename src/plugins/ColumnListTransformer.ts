import { NotionBlock } from "../types";
import { IDocuNotionContext, IPlugin } from "./pluginTypes";
import { doNotionToMarkdown, doNotionBlockModifications } from "../transform";
import { warning } from "../log";


async function notionColumnListToTabs(
  docunotionContext: IDocuNotionContext,
  getBlockChildren: (id: string) => Promise<NotionBlock[]>,
  block: NotionBlock
): Promise<string> {
  const { id, has_children } = block as any;

  if (!has_children) return "";

  const columnListChildren = await getBlockChildren(id);

  const tabItemsPromises = columnListChildren.map(async (column) => {
    const columnChildren = await getBlockChildren(column.id);

    let label = "Tab";
    if (columnChildren.length > 0 && columnChildren[0].type === 'heading_1') {
      const richTextItems = columnChildren[0].heading_1.rich_text;
      
      if (richTextItems.length > 0 && richTextItems[0].type === 'text') {
        label = richTextItems[0].text.content; // Directly accessing the content of the first text item
      }
    }

    // const markdownContent = await Promise.all(
    //   columnChildren.map(
    //     async child => await docunotionContext.notionToMarkdown.blockToMarkdown(child)
    //   )
    // );
    // const content = markdownContent.join("\n\n");

    //TODO: can we make an sub-content processing flow from getMarkdownFromNotionBlocks ? 
    doNotionBlockModifications(columnChildren, docunotionContext.config);
    
    const content = await doNotionToMarkdown(docunotionContext, columnChildren);

    return `<TabItem value="${label.toLowerCase()}" label="${label}">\n\n${content}\n\n</TabItem>`;
  });

  const tabItems = await Promise.all(tabItemsPromises);
  return `<Tabs>\n${tabItems.join("\n")}</Tabs>`;
}

export const standardColumnListTransformer: IPlugin = {
  name: "standardColumnListTransformer",
  notionToMarkdownTransforms: [
    {
      type: "column_list",
      getStringFromBlock: (context, block) =>
        notionColumnListToTabs(
          context,
          context.getBlockChildren,
          block
        ),
    },
  ],
};
