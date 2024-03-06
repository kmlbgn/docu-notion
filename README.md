# Nocusorus
Nocusorus is a tool that fetches content from a provided Notion root page and generates a structured folder of markdown-based files containing its content for Docusaurus. Nocusaurus is built from [docu-notion](https://github.com/sillsdev/docu-notion).

The root page in Notion serves as the foundation for the generated documentation structure. It contains one or more "Tabs Pages", each representing a separate folder structure or content hierarchy, similar to a merkle tree or a separate navigation section.

Cross-linking between different Tab structures is supported, allowing for interconnected documentation across multiple content hierarchies.

Nocusaurus supports custom parsing through plugins, making it versatile for use with various static site generators beyond Docusaurus. This flexibility allows you to create documentation websites or other projects using the static generator of your choice while still leveraging Notion as CMS.

# How It Works
Nocusorus requires a Notion root page with two main components:

1. Tabs Page (Mandatory)
A Tab page is a Notion page that organizes content hierarchically. Each Tab page represents a separate folder structure or content hierarchy in the generated documentation. The arrangement of sub-pages within a Tab is directly reflected in the final documentation and the Tab's sidebar navigation. The Tab's sub-pages link back to the relevant documents housed in the database (if applicable).

For example, in a Docusaurus website using multi-instances, each Tab page could represent the foundation for the "docs", "blog", or other other top navigation sections.

2. Databases (Optional)
Databases in Notion can be used to store the documentation pages within a Tab. When pages are stored in a database, they can have metadata that can be leveraged, and they are published according to their 'status'. This enables a Kanban-style workflow management process for the documentation pages.

### **Page Structure in the Outline**

Blocks listed under the Outline page can be of the following types:

- A page level without Index : A page containing child pages or links to database pages, but doesn't have any content.
- A page level with Index : A page containing child pages and/or links to database pages, and has content. An index.md will be created and all child pages and link to database page will be stripped out from it. 
- A link to a database page
- Or a standard page with content
    
    The use of the database is optional because pages with content can be directly included in the Outline. However, these pages won't have access to the advanced workflow features provided by the database properties. A level page (a.k.a Category in Docusaurus) function as subsections of the documentation. They are transformed into dropdown menus in the sidebar of the documentation site. If they hold content it will be parsed into an index.md.

### **Links**

Nocusorus automatically identifies and removes blocks that are either child pages or links to pages located at the root level of the page. If you need to include such blocks within your content, they must be embedded within another block type, like a table or a column, or they should be accompanied by some text within the same block to trick this logic.

# **Custom Pages**

Docusaurus automatically generates custom pages from the `src/pages` directory, creating corresponding slugs and links. You can create any page within the root page in Notion, for instance naming it "src/page", and manually move these pages into the Docusaurus `src/pages` folder as needed. This approach is simpler and easily managed using github workflow or your own terminal.

**Note on Conflicts**: Pages within `src/pages` are prioritized by Docusaurus and can lead to conflicts with pages that have matching slugs elsewhere in the project. E.g. If both an index.md or a page with "/" slug in the main documentation and an "index.js" in `src/pages` exist, Docusaurus will prioritize the content in `src/pages`, potentially overlooking the index.md.

# Custom parsing (Plugins)

Custom parsing logic can be created using plugins. See the [plugin readme](src/plugins/README.md).

# Callouts ➜ Admonitions

To map Notion callouts to Docusaurus admonitions, ensure the icon is for the type you want.

- ℹ️ ➜ note
- 📝➜ note
- 💡➜ tip
- ❗➜ info
- ⚠️➜ caution
- 🔥➜ danger

The default admonition type, if no matching icon is found, is "note".

# Setup: Nocusorus + docusaurus

#### Host specs:

Ubuntu 20.04

#### Software specs:

- NodeJS `[v21.4.0]`
- npm `[v10.2.4]`
- yarn `[v1.22.21]`

## NodeJS installation

1. **Create a Temporary Directory:**

  ```bash
  mkdir -p ~/tmp && cd ~/tmp 
  ```

2. **Download NodeJS:** 

  ```bash
  wget https://nodejs.org/dist/v21.4.0/node-v21.4.0-linux-x64.tar.xz
  ```

3. **Unpack NodeJS and Set Environment Variables:**
   * Use one of the following methods:
    * **Method A (Persistent Environment Variables):**
        ```bash
        sudo mkdir -p /usr/local/lib/nodejs
        sudo tar -xJvf node-v21.4.0-linux-x64.tar.xz -C /usr/local/lib/nodejs
        echo 'export NODEJS_HOME=/usr/local/lib/nodejs/node-v21.4.0-linux-x64' | sudo tee -a /etc/profile
        echo 'export PATH=$NODEJS_HOME/bin:$PATH' | sudo tee -a /etc/profile
        source /etc/profile
        ```
    
    * **Method B (Temporary Environment Variables):**
        ```bash
        sudo mkdir -p /usr/local/lib/nodejs
        sudo tar -xJvf node-v21.4.0-linux-x64.tar.xz -C /usr/local/lib/nodejs
        echo 'export NODEJS_HOME=/usr/local/lib/nodejs/node-v21.4.0-linux-x64' | sudo tee -a /etc/profile
        echo 'export PATH=$NODEJS_HOME/bin:$PATH' | sudo tee -a /etc/profile
        source /etc/profile
        ```

4. **Install yarn:**

  ```bash
  npm install --global yarn
  ```

5. **Check Installed Versions:**

  ```bash
  node -v
  npm -v
  yarn -v
  ```

## Clone and Prepare Repository for Docusaurus

1. **Clone the Repository:**

  ```bash
  cd ~/tmp
  git clone https://github.com/kmlbgn/docs.kira.network.git
  ```

2. **Set Notion API Token and Root Page:**
  * Replace *** with your Notion token and root page ID. 
  * Set Environment Variables:
    ```bash
    export DOCU_NOTION_SAMPLE_ROOT_PAGE=[***]
    export DOCU_NOTION_INTEGRATION_TOKEN=[***]
    ```
  * Go to the root page and add nocusaurus integration. This page should have, as direct children, a Tab (required) and a "Database" associated to this tab (optional). Follow these instructions. Source: [Notion integration](https://developers.notion.com/docs/create-a-notion-integration#give-your-integration-page-permissions)

3. **Install Dependencies:**
  ```bash
  npm install
  ```

4. **Parse Pages with docu-notion:**

  ```bash
  npx nocusaurus -n $DOCU_NOTION_INTEGRATION_TOKEN -r $DOCU_NOTION_SAMPLE_ROOT_PAGE
  ```

## Starting Docusaurus Server

1. **Navigate to the Project Directory:**
2. **Start the Docusaurus Server:**
  ```bash
  yarn start
  ```
  * Source [Docusaurus Intallation Guide](https://docusaurus.io/docs/installation)

# Nocusorus Command line

Usage: nocusaurus -n <token> -r <root> [options]

Options:

| flag                                  | required? | description                                                                                                                                                                                                        |
| ------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| -n, --notion-token <string>           | required  | notion api token, which looks like `secret_3bc1b50XFYb15123RHF243x43450XFY33250XFYa343`                                                                                                                            |
| -r, --root-page <string>              | required  | The 31 character ID of the page which is the root of your docs page in notion. The code will look like `9120ec9960244ead80fa2ef4bc1bba25`. This page must have a child page named 'Outline'                        |
| -m, --markdown-output-path <string>   |           | Root of the hierarchy for md files. WARNING: node-pull-mdx will delete files from this directory. Note also that if it finds localized images, it will create an i18n/ directory as a sibling. (default: "./docs") |
| -t, --status-tag <string>             |           | Database pages without a Notion page property 'status' matching this will be ignored. Use '\*' to ignore status altogether. (default: `Publish`)                                                                   |
| --locales <codes>                     |           | Comma-separated list of iso 639-2 codes, the same list as in docusaurus.config.js, minus the primary (i.e. 'en'). This is needed for image localization. (default: [])                                             |
| -l, --log-level <level>               |           | Log level (choices: `info`, `verbose`, `debug`)                                                                                                                                                                    |
| -i, --img-output-path <string>        |           | Path to directory where images will be stored. If this is not included, images will be placed in the same directory as the document that uses them, which then allows for localization of screenshots.             |
| -p, --img-prefix-in-markdown <string> |           | When referencing an image from markdown, prefix with this path instead of the full img-output-path. Should be used only in conjunction with --img-output-path.                                                     |
| -h, --help                            |           | display help for command                                                                                                                                                                                           |
