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

  public getLinkPathForPage(targetPage: { page?: NotionPage; tab?: string }): string {
    let tab = "";
    if (targetPage.tab !== undefined) {
      tab = targetPage.tab;
    }
    if (targetPage.page && targetPage.page.slug.startsWith("/")) {
      return (tab + targetPage.page.slug);
    } else if (targetPage.page) {
      return targetPage.page.layoutContext.toLocaleLowerCase() + "/" + targetPage.page.slug;
    } else {
      return "";
    }
  }

  public getPageSlug(page: NotionPage): string {
    // the url we return starts with a "/", meaning it is relative to the root of the markdown root (e.g. /docs root in Docusaurus)
    return ("/" + page.slug).replaceAll("//", "/");
  }
}
