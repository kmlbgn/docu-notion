import * as fs from "fs-extra";
import { NotionPage } from "./NotionPage";

// Here a fuller name would be File Tree Layout Strategy. That is,
// as we walk the Notion outline and create files, where do we create them, what do we name them, etc.
export abstract class LayoutStrategy {
  protected rootDirectory = "";

  public setRootDirectoryForMarkdown(markdownOutputPath: string): void {
    this.rootDirectory = markdownOutputPath;
  }

  public abstract newLevel(
    rootDir: string,
    order: number,
    context: string,
    levelLabel: string
  ): string;
  
  public abstract getPathForPage(
    page: NotionPage,
    extensionWithDot: string
  ): string;

  public getLinkPathForPage(page: NotionPage): string {
    // the url we return starts with a "/", meaning it is relative to the root of the markdown root (e.g. /docs root in Docusaurus)
    return ("/" + page.slug).replaceAll("//", "/");
  }
}
