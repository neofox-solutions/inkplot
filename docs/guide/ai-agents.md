# Set up inkplot for an AI agent

inkplot has two **skills**: short instruction packs that an AI assistant reads when you ask it for a chart. With one installed, the assistant knows how inkplot works, so it gets charts right instead of guessing. Installing a skill takes a minute. Find your tool below.

| If you use… | Go to |
|---|---|
| Claude (claude.ai or the Claude desktop app), or ChatGPT, and want charts from a spreadsheet | [The simple way](#the-simple-way-claude-and-chatgpt) |
| Claude Code, Codex, VS Code (Copilot), Cursor or Gemini CLI | [One command](#for-coding-tools-one-command) |
| Another tool, or you prefer to copy files yourself | [By hand](#by-hand) |

## The two skills

| Skill | What it does | Who it is for |
|---|---|---|
| **`inkplot-data-charts`** | Turns a spreadsheet, CSV or data file into charts: an interactive web page, picture files, or figures in a Word, PowerPoint or PDF report. | Anyone with data. No coding. |
| **`inkplot`** | Teaches the assistant to write inkplot code in your app. | Developers. |

If you are not a developer, you want `inkplot-data-charts`.

## The simple way: Claude and ChatGPT

You do not need a terminal, and you do not need to install anything on your computer. You download one file and give it to your assistant.

**1. Download the skill.**

- Open the [inkplot releases page](https://github.com/neofox-solutions/inkplot/releases).
- Find the newest release at the top, and look for **Assets** at the bottom of it (click it if it is folded shut).
- Click **`inkplot-data-charts-<version>.zip`** to download it. Do not unzip it: your assistant wants the zip as it is.

**2. Give it to your assistant.**

*Claude (claude.ai or the desktop app):*

1. Open **Customize**, then **Skills**. (In an older version of the app: **Settings**, then **Capabilities**, then **Skills**.)
2. Choose **Upload a skill** and pick the zip you downloaded.
3. Make sure the skill is switched **on** in the list.

Skills need a paid Claude plan (Pro, Max, Team or Enterprise), and "code execution and file creation" has to be switched on in Capabilities. On Team and Enterprise plans an administrator may have to allow skills first.

*ChatGPT:*

1. In the sidebar, open **Plugins**, then the **Skills** tab.
2. Choose **Create**, then **Upload from your computer**, and pick the zip.
3. ChatGPT checks the file first. If it says **Needs Review** or **Blocked**, ask whoever manages your workspace.

Skills are in ChatGPT Business, Enterprise, Healthcare and Edu workspaces, and on Enterprise and Edu an administrator has to allow uploads ("Enable skill uploading").

**3. Ask for a chart.**

Attach your spreadsheet and ask in plain words, for example: *"Make an interactive chart page of sales by region from this file."* The assistant reads the skill, builds the charts, and gives you a file to open in your browser, or pictures to paste into a document.

**If it does not work**

- *"I can't install packages" or "I can't reach npm".* The skill needs the assistant to download inkplot once. Check that code execution is allowed to use the internet in your settings (in Claude, the network access setting under Capabilities), and ask again.
- *The assistant does not seem to use the skill.* Check that it is switched on, and start a new conversation. You can also name it: "Use the inkplot-data-charts skill to…".
- *You have an older copy of the skill.* See [versions](#versions-and-conflicts) below: remove the old one, then add the new one.

## For coding tools: one command

If you work in one of these tools, one command puts the skill where the tool looks for it. It needs Node.js and nothing else: it is part of the `inkplot` package, which has no dependencies, so it starts fast. CI runs it on the current Node.js (26); older versions are not tested.

```sh
npx inkplot install-skill claude-code
```

> While inkplot is in beta, type `npx inkplot@beta` instead of `npx inkplot`.

Replace `claude-code` with your tool:

| Tool | Name to type | Project folder | With `--user` |
|---|---|---|---|
| Claude Code | `claude-code` (or `claude`) | `.claude/skills` | `~/.claude/skills` |
| OpenAI Codex | `codex` | `.agents/skills` | `~/.agents/skills` |
| VS Code (GitHub Copilot Chat) | `vscode` (or `copilot`) | `.github/skills` | `~/.copilot/skills` |
| Cursor | `cursor` | `.cursor/skills` | `~/.cursor/skills` |
| Gemini CLI | `gemini` | `.gemini/skills` | `~/.gemini/skills` |
| Any of the last four | `agents` | `.agents/skills` | `~/.agents/skills` |

Run it from your project, then start a new session in the tool. Run `npx inkplot install-skill` with nothing after it to see all the options:

| Option | What it does |
|---|---|
| `--skill <name>` | Which skill: `inkplot` (the default), `data-charts`, or both separated by a comma. |
| `--all` | Both skills. |
| `--user` | Install for you, in every project, instead of only in this one. |
| `--dir <folder>` | Use this skills folder instead of a tool's. For a tool that is not in the table but reads skill folders. |
| `--dry-run` | Say what would happen and change nothing. |
| `--force` | Replace a folder with the skill's name that is there but was not made by inkplot. |
| `--remove` | Take the skill out. |
| `--list` | Show where each tool looks and which skills are installed there. |

```sh
npx inkplot install-skill cursor --all          # both skills, this project
npx inkplot install-skill vscode --user         # for you, in every project
npx inkplot install-skill --dir ./tool/skills   # a folder of your own
npx inkplot install-skill claude-code --remove  # take it out again
```

The `inkplot` skill is plain text and works anywhere. The `inkplot-data-charts` skill makes the assistant run a command (`inkplot-scratch`), so it needs a tool that can run commands and reach npm.

## By hand

Every tool above reads the same thing: a folder named for the skill, holding a `SKILL.md`. To do it yourself, install inkplot (`npm i inkplot`) and copy a folder from `node_modules/inkplot/skill` into your tool's skills folder (the table above):

```sh
cp -r node_modules/inkplot/skill/inkplot .claude/skills/inkplot
cp -r node_modules/inkplot/skill/inkplot-data-charts .claude/skills/inkplot-data-charts
```

The folder keeps the skill's name, and you copy the folder as it is (the `inkplot` skill has a `topics` folder the assistant opens as it needs them).

For a tool that takes an uploaded zip (Claude on the web or the desktop app, ChatGPT), [download it from the release](#the-simple-way-claude-and-chatgpt): each release has `inkplot-data-charts-<version>.zip` and `inkplot-skill-<version>.zip` (the `inkplot` skill) attached.

For a tool that has no skills but reads an instructions file (`AGENTS.md`, a rules folder, a system prompt), copy the `inkplot` folder into the project and add a line to that file: "To write inkplot charts, read `skills/inkplot/SKILL.md` first, then only the topic files it names."

## Versions and conflicts

A skill describes one version of inkplot. If the assistant follows a skill for another version than the one in your project, it can use an attribute that does not exist yet, or miss one that does. Each skill is marked with its version, and:

- **`install-skill` handles it.** Running it again replaces an older copy whole (so a topic file that no longer exists does not linger), says `updated inkplot from 1.0.0 to 1.1.0`, and does nothing if the copy is already current. It leaves a folder alone that was not made by inkplot (your own edits) unless you give `--force`.
- **It warns about the other copies.** If another tool's folder, in the project or in your home folder, holds a different version, it tells you which, since a tool that reads both may follow the wrong one. Remove it with `--remove`, or update it by running the command for that tool.
- **It warns when the skill and your project differ.** If the project has an `inkplot` version in `node_modules` other than the one that wrote the skill, it tells you so and gives the command to fetch the matching one (`npx inkplot@<your version> install-skill …`). Inside a project, `npx inkplot` runs the project's own copy, so the two agree unless you ask for another.
- **After upgrading inkplot, run it again.** The skill is not updated by `npm update`; it is copied once.

If you uploaded a zip, the skill does not update itself either. To change version, delete the skill in your assistant's skills list and upload the zip from the release that matches the version you want (every release keeps its own zips on its page). The `inkplot-data-charts` skill installs the exact inkplot version it was released with, so its charts and its instructions always agree.

## Check that it works

Ask for something small, such as "make a line chart of these numbers with a title and axis labels". An assistant with the skill reads it before it writes anything, and draws the chart with inkplot's own elements (`Chart`, `CartesianPlane`, `Axis`) rather than an invented API. If it does not, the skill was not found: check that the folder name matches the skill's name, that it is switched on, and that you started a new session.
