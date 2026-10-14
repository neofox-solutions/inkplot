# Set up inkplot for an AI agent

inkplot ships two **skills**: folders of instructions an AI agent reads when you ask it for a chart. Installing one means putting its folder where your tool looks for skills. Every tool below uses the same folder format (a `SKILL.md` and the files it names), so you get the folders once and copy them to the right place.

| Skill | Folder | Use it when |
|---|---|---|
| `inkplot` | `skill/inkplot` | The agent writes inkplot code for your app. It needs no tools: it works anywhere a skill does. |
| `inkplot-data-charts` | `skill` | The agent turns a spreadsheet, CSV or JSON file into charts (an HTML page, SVG or PNG files, or figures for a report). It runs `inkplot-scratch`, so it needs a shell and the npm registry. It contains the `inkplot` skill. |

## Get the folders

```sh
npm i -D inkplot-scratch
```

The folders are now in `node_modules/inkplot-scratch/skill`. Below, `<skills>` is the skills folder of your tool, and each command copies one of the two (the folder's name has to be the skill's name):

```sh
# the library skill
cp -r node_modules/inkplot-scratch/skill/inkplot <skills>/inkplot
# the data-charts skill (this one includes the library skill)
cp -r node_modules/inkplot-scratch/skill <skills>/inkplot-data-charts
```

To upload instead of copying, make a zip with the skill's folder inside it:

```sh
mkdir -p out && cp -r node_modules/inkplot-scratch/skill out/inkplot-data-charts
(cd out && zip -r inkplot-data-charts.zip inkplot-data-charts)
```

(Use `skill/inkplot` and `inkplot` for the library skill.)

## Claude and Claude Desktop

In Claude on the web and in the desktop app, open **Settings → Capabilities**, make sure code execution and file creation is on, and under **Skills** choose **Upload skill** and pick the zip. Switch the skill on in the list. Skills need a Pro, Max, Team or Enterprise plan; on Team and Enterprise an owner may have to allow them first. `inkplot-data-charts` also needs the code sandbox to reach the npm registry; if it cannot, use the `inkplot` skill.

## Claude Code

Copy the folder into `.claude/skills/` in your project (shared with your team through git) or `~/.claude/skills/` (all your projects). Start a new session. Claude Code loads the skill when a request matches its description, and you can name it (`/inkplot`).

## ChatGPT

Open **Plugins** in the sidebar, then the **Skills** tab, **Create**, **Upload from your computer**, and choose the skill (the zip above). ChatGPT scans an upload before it can be used. Skills are in Business, Enterprise, Healthcare and Edu workspaces, and on Enterprise and Edu an admin turns on skill uploading. Without that, paste the contents of `skill/inkplot/SKILL.md` into a project's instructions or a custom GPT's instructions, and attach the `topics` folder as files: the library skill is plain text and works that way.

## Codex

Copy the folder into `.agents/skills/` in your project or `~/.agents/skills/`.

## VS Code (GitHub Copilot Chat)

Copy the folder into `.github/skills/` in your project or `~/.copilot/skills/`. VS Code also reads `.claude/skills/` and `.agents/skills/`, so a project that already has one of those needs nothing more. Skills are used in agent mode; type `/` and the skill's name to call one, or `/skills` to see what is installed.

## Cursor

Copy the folder into `.cursor/skills/` in your project or `~/.cursor/skills/` (Cursor also reads `.agents/skills/`).

## Gemini CLI

Copy the folder into `.gemini/skills/` in your project or `~/.gemini/skills/` (it also reads `.agents/skills/`).

## Anything else

If your tool has no skills but reads an instructions file (`AGENTS.md`, a rules folder, a system prompt), put the skill folder in the project and add a line to that file: "To write inkplot charts, read `skills/inkplot/SKILL.md` first, then only the topic files it names." The agent needs to be able to read files in the folder.

## Check that it works

Ask for something small, such as "make a line chart of these numbers with a title and axis labels". An agent with the skill reads `SKILL.md` before it writes any code, and its answer uses `Chart`, `CartesianPlane` and `Axis` elements rather than an invented API. If it does not, the skill was not found: check that the folder name matches the skill's name and that you started a new session.
