# Description
KIRA's documentation system integrates with docu-notion-kira, a forked version of [docu-notion](https://github.com/sillsdev/docu-notion) tailored for Kira Network. 

Docu-notion allows the use of Notion as the primary editing platform to produce content suitable for static site generators; Docusaurus in this case. This combination meets several challenging requirements, such as automatique deployment, editing workflow features, localization support via Crowdin, and capabilities for both online and offline distribution. Future plans include adding versioning capabilities.

# How It Works ?

Docu-notion fetches content from a provided Notion root page and produce a structured folder of markdown-base files of its content. The root page has two main components:

1. **The Database (Optional)** - This is where the documentation pages are stored. They include content and are equipped with workflow properties to facilitate a Kanban-style management process where pages can have metadata that can be leveraged and are published according to their ‘status’.
2. **The Outline Page (Mandatory)** - This is a central Notion page that organizes content hierarchically. It serves as the foundation of the documentation structure. The arrangement of sub-pages within the Outline is directly reflected in the final documentation site and its sidebar navigation. These sub-pages should link back to the relevant documents housed in the database.

### **Page Structure in the Outline**

Blocks listed under the Outline page can be of the following types:

- A page level without Index : A page containing child pages or links to database pages, but doesn't have any content.
- A page level with Index : A page containing child pages and/or links to database pages, and has content. An index.md will be created and all child pages and link to database page will be stripped out from it. 
- A link to a database page
- Or a standard page with content
    
    The use of the database is optional because pages with content can be directly included in the Outline. However, these pages won't have access to the advanced workflow features provided by the database properties. A level page (a.k.a Category in Docusaurus) function as subsections of the documentation. They are transformed into dropdown menus in the sidebar of the documentation site. If they hold content it will be parsed into an index.md.

### **Links**

Docu-notion automatically identifies and removes blocks that are either child pages or links to pages located at the root level of the page. If you need to include such blocks within your content, they must be embedded within another block type, like a table or a column, or they should be accompanied by some text within the same block to trick this logic.

# **Custom Pages**

Docusaurus automatically generates custom pages from the `src/pages` directory, creating corresponding slugs and links. Pages located at the root but outside the 'Outline' are treated as custom pages, converted to markdown, and moved to `src/pages`. This setup supports both standard pages and links to database pages.

**Note on Conflicts**: If the 'Outline' contains content, an `index.md` is generated. However, if there's also an `index.js` in `src/pages`, Docusaurus prioritizes the last processed page. Testing indicates that `src/pages` takes precedence over pages in the `docs` folder, therefore `index.md` will not be taken into account.


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

# Setup: Docu-notion-kira + docusaurus

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
  * Go to the root page and add docu-notion-kira integration. This page should have, as direct children, "Outline" (required) and "Database" (optional) pages. Follow these instructions. Source: [Notion integration](https://developers.notion.com/docs/create-a-notion-integration#give-your-integration-page-permissions)

3. **Install Dependencies:**
  ```bash
  npm install
  ```

4. **Parse Pages with docu-notion:**

  ```bash
  npx docu-notion-kira -n $DOCU_NOTION_INTEGRATION_TOKEN -r $DOCU_NOTION_SAMPLE_ROOT_PAGE
  ```

## Starting Docusaurus Server

1. **Navigate to the Project Directory:**
2. **Start the Docusaurus Server:**
  ```bash
  yarn start
  ```
  * Source [Docusaurus Intallation Guide](https://docusaurus.io/docs/installation)

# Docu-notion Command line

Usage: docu-notion-kira -n <token> -r <root> [options]

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
