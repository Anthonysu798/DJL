// FILE: documentPlugins.ts
// Purpose: DJL's own document plugins (Word, PowerPoint, Excel, PDF). They have no tool server
//          and no sign-in: each one is a set of instructions the agent follows with the tools it
//          already has, so they are always on and work offline.

import type { PluginCatalogEntry } from "@synara/contracts";

const CATEGORY = "Documents";

const SHARED = [
  "Save the file in the user's project folder unless they name another place, and never overwrite a file they gave you: write the result under a new name unless they asked to change it in place.",
  "Check what is already installed before installing anything. If a library is missing, create a virtual environment in a temporary folder and install it there; never install into the system Python or globally with npm.",
  "Do not say the file is done until you have opened the saved file again and checked it. Finish with the file's full path and one line on what it contains. If a step could not be done on this machine, say which one and why.",
].join(" ");

interface DocumentPlugin {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly shortDescription: string;
  readonly longDescription: string;
  readonly brandColor: string;
  /** The product site whose icon is this file type's familiar logo. */
  readonly iconDomain: string;
  readonly skill: string;
  readonly examplePrompts: readonly [string, string, string];
  readonly instructions: string;
}

const DOCUMENT_PLUGINS: ReadonlyArray<DocumentPlugin> = [
  {
    id: "djl-word",
    name: "word",
    displayName: "Word Documents",
    shortDescription: "Create and edit .docx files",
    longDescription:
      "Write reports, letters, proposals and other Word documents, or edit one you already have. The agent builds the file on your computer, so nothing is uploaded and no account is needed.",
    brandColor: "#2b579a",
    iconDomain: "word.cloud.microsoft",
    skill: "word-documents",
    examplePrompts: [
      "Write a one-page project proposal for [project] as a Word document",
      "Turn this conversation into meeting notes in a .docx file",
      "Edit [file].docx: tighten the introduction and fix the heading levels",
    ],
    instructions: [
      "The user selected the Word Documents plugin: produce or edit a .docx file.",
      "Use python-docx (import name docx). Build structure with real styles: Title, Heading 1 to 3, Normal, List Bullet, List Number, and tables with a table style. Never fake a heading with bold text or a list with typed dashes or numbers.",
      "Set the page size and margins once on the section, add page numbers in the footer for anything longer than two pages, and insert images with a set width so they fit inside the margins.",
      "To edit an existing file, open it, change only what was asked, and keep its styles, headers, footers and numbering. python-docx cannot write tracked changes or comments; if the user asks for them, say so and offer a clean edited copy plus a short list of what changed.",
      "Check the result: reopen it and confirm the headings, paragraph count and tables are what you intended. If LibreOffice (soffice) is installed, convert the file to PDF and look at the pages for overflow, stray blank pages and broken tables.",
      SHARED,
    ].join(" "),
  },
  {
    id: "djl-powerpoint",
    name: "powerpoint",
    displayName: "PowerPoint Presentations",
    shortDescription: "Create and edit .pptx slide decks",
    longDescription:
      "Build slide decks from a brief, an outline or a document, or rework a deck you already have. The agent builds the file on your computer, so nothing is uploaded and no account is needed.",
    brandColor: "#c43e1c",
    iconDomain: "powerpoint.cloud.microsoft",
    skill: "powerpoint-presentations",
    examplePrompts: [
      "Make a 10-slide deck that explains [topic] to [audience]",
      "Turn [document] into a presentation with speaker notes",
      "Edit [file].pptx: shorten the text on every slide and add a summary slide",
    ],
    instructions: [
      "The user selected the PowerPoint Presentations plugin: produce or edit a .pptx file.",
      "Use python-pptx (import name pptx). For a new deck set a 16:9 slide size (13.333 by 7.5 inches) and build every slide from a slide layout and its placeholders, so titles and body text stay consistent and editable.",
      "Plan the deck before building it: one idea per slide, a title that states the point, at most about six short bullets, body text no smaller than 18 pt. Put detail in the speaker notes, not on the slide. Use one typeface family and a small set of colors for the whole deck.",
      "Add charts with the native chart API from the real numbers, and tables as real tables; do not paste them in as pictures. Size images to keep their proportions.",
      "To edit an existing deck, keep its slide master, layouts and theme; change the content that was asked for and leave the rest.",
      "Text that does not fit is the most common fault. Check each text box against its size, and if LibreOffice (soffice) is installed, convert the deck to PDF and look at every slide for overflowing or overlapping text before you report.",
      SHARED,
    ].join(" "),
  },
  {
    id: "djl-excel",
    name: "excel",
    displayName: "Excel Spreadsheets",
    shortDescription: "Create and edit .xlsx workbooks",
    longDescription:
      "Build budgets, trackers, reports and models as Excel workbooks with working formulas, or change a workbook you already have. The agent builds the file on your computer, so nothing is uploaded and no account is needed.",
    brandColor: "#217346",
    iconDomain: "excel.cloud.microsoft",
    skill: "excel-spreadsheets",
    examplePrompts: [
      "Build a monthly budget workbook with totals and a summary sheet",
      "Turn [file].csv into a formatted Excel report with a chart",
      "In [file].xlsx, add a column that calculates [value] for every row",
    ],
    instructions: [
      "The user selected the Excel Spreadsheets plugin: produce or edit a .xlsx file.",
      "Use openpyxl. Anything that is calculated must be a formula in the cell (for example =SUM(B2:B13)), not a number you worked out in code, so the workbook keeps working when the user changes an input. Keep inputs, calculations and summary apart, and never hide a hard-coded constant inside a formula.",
      "Make it readable: a bold header row, frozen panes below it, column widths that fit the content, and number formats for currency, percentages and dates. Use one sheet per subject with a clear name.",
      "To edit an existing workbook, load it normally and keep its formulas, formats and other sheets. Never load with data_only=True and then save: that replaces every formula with its last value.",
      "openpyxl does not calculate formulas. Reopen the saved file and check that each formula is in the cell you intended and refers to the right range. If LibreOffice (soffice) is installed, have it recalculate the workbook and confirm no cell shows an error such as #REF!, #DIV/0! or #NAME?. If it is not installed, say the formulas were written but not recalculated here.",
      SHARED,
    ].join(" "),
  },
  {
    id: "djl-pdf",
    name: "pdf",
    displayName: "PDF",
    shortDescription: "Create, read, merge and fill PDF files",
    longDescription:
      "Create PDFs, pull the text and tables out of one, merge or split files, and fill in forms. The agent works on the file on your computer, so nothing is uploaded and no account is needed.",
    brandColor: "#b30b00",
    iconDomain: "acrobat.adobe.com",
    skill: "pdf-files",
    examplePrompts: [
      "Summarize [file].pdf and list the key numbers in it",
      "Merge these PDFs into one file in this order: [files]",
      "Create a one-page PDF invoice for [customer] for [amount]",
    ],
    instructions: [
      "The user selected the PDF plugin: read, create or change a PDF file.",
      "To read a PDF, extract its text with pypdf, and use pdfplumber when you need tables or the position of text on the page. If a page gives back no text it is a scan: it needs OCR (ocrmypdf or tesseract). If neither is installed, say so instead of guessing what the page says.",
      "To create a PDF, use reportlab: flowing text with Platypus (paragraphs, tables, page breaks), exact placement with the canvas. Set the page size and margins and add page numbers for anything longer than two pages.",
      "To merge, split, reorder or rotate pages, or to fill in form fields, use pypdf. List the form's field names before filling them, and check afterwards that each value was set.",
      "Check the result: reopen the file, confirm the page count, and extract the text of the first and last page to see that it is what you intended.",
      SHARED,
    ].join(" "),
  },
];

export const DOCUMENT_PLUGIN_ENTRIES: ReadonlyArray<PluginCatalogEntry> = DOCUMENT_PLUGINS.map(
  (plugin) => ({
    id: plugin.id,
    name: plugin.name,
    displayName: plugin.displayName,
    shortDescription: plugin.shortDescription,
    longDescription: plugin.longDescription,
    category: CATEGORY,
    featured: false,
    builtIn: true,
    developer: "DJL",
    version: "1.0.0",
    brandColor: plugin.brandColor,
    iconDomain: plugin.iconDomain,
    capabilities: ["Read", "Write"],
    examplePrompts: plugin.examplePrompts,
    apps: [],
    skills: [{ name: plugin.skill, description: plugin.shortDescription }],
  }),
);

/** What the agent is told when the user mentions a document plugin, by plugin id. */
export const DOCUMENT_PLUGIN_INSTRUCTIONS: ReadonlyMap<string, string> = new Map(
  DOCUMENT_PLUGINS.map((plugin) => [plugin.id, plugin.instructions]),
);
