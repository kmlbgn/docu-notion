import * as fs from "fs-extra";
import { Option, program } from "commander";
import { setLogLevel, warning } from "./log";

import { notionPull } from "./pull";
import path from "path";

export async function run(): Promise<void> {
  const pkg = require("../package.json");
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  console.log(`docu-notion version ${pkg.version}`);

  program.name("docu-notion").description("");
  program.usage("-n <token> -r <root> [options]");
  program
    .requiredOption(
      "-n, --notion-token <string>",
      "notion api token, which looks like secret_3bc1b50XFYb15123RHF243x43450XFY33250XFYa343"
    )
    .requiredOption(
      "-r, --root-page <string>",
      "The 31 character ID of the page which is the root of your docs page in notion. The code will look like 9120ec9960244ead80fa2ef4bc1bba25. This page must have a child page named 'Outline'"
    )
    .option(
      "-m, --markdown-output-path  <string>",
      "Root of the hierarchy for md files. WARNING: docu-notion will delete files from this directory. Note also that if it finds localized images, it will create an i18n/ directory as a sibling.",
      "./docs"
    )
    .option(
      "--css-output-directory  <string>",
      "docu-notion has a docu-notion-styles.css file that you will need to use to get things like notion columns to look right. This option specifies where that file should be copied to.",
      "./css"
    )
    .option(
      "-t, --status-tag  <string>",
      "Database pages without a Notion page property 'status' matching this will be ignored. Use '*' to ignore status altogether.",
      "Publish"
    )
    .option(
      "--locales  <codes>",
      "Comma-separated list of iso 639-2 codes, the same list as in docusaurus.config.js, minus the primary (i.e. 'en'). This is needed for image localization.",
      parseLocales,
      []
    )
    .option("-y, --yes", 
    "Automatically overwrite existing files without prompting"
    )

    .addOption(
      new Option("-l, --log-level <level>", "Log level").choices([
        "info",
        "verbose",
        "debug",
      ])
    )
    .option(
      "-i, --img-output-path  <string>",
      "Path to directory where images will be stored. If this is not included, images will be placed in the same directory as the document that uses them, which then allows for localization of screenshots."
    )
    .option(
      "-p, --img-prefix-in-markdown <string>",
      "When referencing an image from markdown, prefix with this path instead of the full img-output-path. Should be used only in conjunction with --img-output-path."
    );

  program.showHelpAfterError();
  program.parse();
  setLogLevel(program.opts().logLevel);
  
  const options = program.opts();
  const safeOptions = { ...options, notionToken: 'REDACTED' }; // Don't console log notion token for safety
  console.log(JSON.stringify(safeOptions)); 

  // copy in the this version of the css needed to make columns (and maybe other things?) work
  let pathToCss = "";
  try {
    pathToCss = require.resolve(
      "docu-notion-kira/dist/docu-notion-styles.css"
    );
  } catch (e) {
    // when testing from the docu-notion project itself:
    pathToCss = "./src/css/docu-notion-styles.css";
  }
  // make any missing parts of the path exist
  fs.ensureDirSync(program.opts().cssOutputDirectory);
  fs.copyFileSync(
    pathToCss,
    path.join(program.opts().cssOutputDirectory, "docu-notion-styles.css")
  );

  async function moveTmpContents() {
    const destTmpPath = "src/pages";
    const srcTmpPath = path.join(options.markdownOutputPath.replace(/\/+$/, "")+ '/tmp');
    warning(`dest:${destTmpPath}`)
    warning(`src:${srcTmpPath}`)
    fs.ensureDirSync(destTmpPath);
  
    const tmpFiles = fs.readdirSync(srcTmpPath);
    for (const file of tmpFiles) {
      const destFilePath = path.join(destTmpPath, file);
      const srcFilePath = path.join(srcTmpPath, file);
  
      if (fs.existsSync(destFilePath)) {
        // Prompt user for overwriting
        const overwrite = await promptUserForOverwrite(file, options.yes); 
        if (!overwrite) {
        console.log(`Skipping overwrite of '${file}'`);
        continue;
        } else {
          console.log(`Overwriting '${file}'`);
        }
      }
  
      fs.moveSync(srcFilePath, destFilePath, { overwrite: true });
    }
    // After moving all files, delete the tmp folder
    fs.removeSync(srcTmpPath);
  }

  // pull and move custom pages
  await notionPull(program.opts());
  await moveTmpContents();
  console.log("Pull from Notion successful. Custom pages were moved to src/pages.");

}

function parseLocales(value: string): string[] {
  return value.split(",").map(l => l.trim().toLowerCase());
}

// user prompt when custom pages already exists
const readline = require('readline');

function promptUserForOverwrite(fileName: string, autoYes: Option) {
  // Check if the --y flag is set in the options
  if (autoYes) {
    return Promise.resolve(true);
  }

  // If the --y flag is not set, continue with the user prompt
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`The file '${fileName}' already exists in 'src/test'. Do you want to overwrite it? (y/any) `, (answer: string) => {
      resolve(answer.toLowerCase() === 'y');
      rl.close();
    });
  });
}