# Trying Capsules: install guide for design partners

Thank you for trying Capsules before it is public. This guide takes about 15 minutes. Every step can be undone (step 9).

**What Capsules is.** A free command-line tool that keeps a short record, in your repo, of what each part of your app is for and which rules must stay true. It shows that record to you and to your AI agent (Claude Code), and it stops the agent from quietly weakening your tests or rules. It makes **no network requests and no AI calls**: nothing about your code leaves your computer.

**What it touches.** Only a new `.capsules/` folder and a few files under `.claude/` (commands, two helper agents, a skill, rule files) plus your local Claude Code settings. It never changes your app's code, `package.json`, lockfiles or build settings. Step 6 proves it.

You received two things: this guide and a file named `pyscoparth-capsules-0.1.0-rc.1.tgz`. Please don't share the file; it is a private test version.

---

## 1. Check what you need

Open a terminal (macOS: Terminal; Windows: PowerShell or Git Bash) and run:

```sh
node --version
git --version
```

You need Node **22 or later** (`v22.…` or higher) and any recent Git. If Node is older, install the current LTS from <https://nodejs.org>.

You also need **Claude Code** for the agent parts (steps 7 and 8).

## 2. Check the file arrived intact (optional, 1 minute)

In the folder where you saved the file:

- macOS or Linux: `shasum -a 256 pyscoparth-capsules-0.1.0-rc.1.tgz`
- Windows (PowerShell): `Get-FileHash pyscoparth-capsules-0.1.0-rc.1.tgz -Algorithm SHA256`

The long code it prints should match the one Parth sent you with the file.

## 3. Install Capsules

Still in the folder with the file:

```sh
npm install -g ./pyscoparth-capsules-0.1.0-rc.1.tgz
capsules --version
```

You should see `0.1.0-rc.1`. (The install downloads a few small open-source libraries Capsules uses from npm, as any npm install does. Installing it globally, rather than with `npx`, keeps the checks fast while you work.)

If `npm install -g` says "permission denied" on macOS or Linux, don't use `sudo`; tell Parth, and he'll send a one-line fix for your setup.

## 4. Commit your work first

Go to your project and make sure everything is committed, so you can see exactly what Capsules adds:

```sh
cd path/to/your-project
git status
```

`git status` should say "nothing to commit". If not, commit or stash first.

## 5. Set up Capsules in your project

```sh
capsules init
```

It first prints a **plan**: every file it will create or change, and why. Read it, then type `y` to go ahead. It then tells you the next steps.

If it prints a **note** that it "can't tell which commits are yours", open `.capsules/permissions.yaml`. Under `humans:` there is one line for you, for example:

```yaml
sam-lee: { owns: ["**"], emails: [] }
```

Add your GitHub username to it, like this (keep the two spaces at the start):

```yaml
sam-lee: { github: "samlee", owns: ["**"], emails: [] }
```

That lets Capsules recognise your commits as the owner's when you commit with GitHub's private email address.

## 6. Prove your app is unaffected

```sh
capsules doctor
```

It lists every file Capsules created or changed and confirms none is app code, `package.json`, a lockfile or a build output. It should end with **"your app is unaffected by capsules."**

To make it also run your build and tests, open `.capsules/config.yaml` and set, for example:

```yaml
build:
  command: "npm run build"
  test: "npm test"
```

Then run `capsules doctor` again: it runs both and reports pass or fail, exactly as before Capsules.

## 7. Let Claude Code draft your capsules

Open Claude Code in your project (restart it if it was already open) and type:

```text
/capsules-draft
```

Claude reads your code and docs, proposes a tree of areas (for example billing, web, users) and cross-cutting concerns (for example auth, payments, pii), and writes them into `.capsules/`. It then shows you the **intents** (what each part is for, in plain words) and **examples** for approval. Read them and correct anything that's wrong: this is the one part that needs you.

Then, in the terminal:

```sh
capsules lock
capsules compile
capsules check --no-run
capsules map --open
```

The last one opens a map of your app in your browser: what each part is for, its rules, and what needs attention.

When you're happy, commit `.capsules/` and the new files under `.claude/` (not `.claude/settings.local.json`: that one is personal to your machine and Git already ignores it).

## 8. Work as usual for two weeks

Use Claude Code as you normally do. Capsules works in the background:

- If Claude tries to weaken an existing test, edit a rule it shouldn't, or switch off its own checks, Capsules **blocks** the edit and tells Claude why and what to do instead.
- When Claude finishes, Capsules may show a short note about rules that went out of date.
- `/capsules-map` explains the map in plain words; `/capsules-work <area>` starts focused work on one area.

**Please keep short notes** each time Capsules blocks or warns, and send them to Parth once a week:

| Date | What you or Claude tried | What Capsules said | Was it right? |
| ---- | ------------------------ | ------------------ | ------------- |

Also useful: anything confusing, anything slow, and whether Claude kept the capsules up to date without being asked. Capsules sends nothing by itself; you choose what to share. Your capsules describe your app, so look before you share them.

## 9. Remove it (any time)

In your project:

```sh
capsules remove --all
npm uninstall -g @pyscoparth/capsules
```

`capsules remove --all` takes out everything Capsules added, including `.capsules/`, and restores your Claude Code settings exactly as they were. Leave out `--all` to keep your capsules. If you never committed anything from step 7, `git status` then shows your repo exactly as before. If you did, `git status` shows those files as deleted: commit that to remove them from your repo too.

---

## Known limits of this test version

- **No CI yet.** The GitHub check that runs on pull requests needs the public npm package, which isn't published yet. The live checks in Claude Code work fully.
- **The shell check is best effort.** Capsules checks Claude's file edits exactly, but clever shell commands can get past it. In the public version, CI is the final gate.
- **One person per machine.** The live checks are set up per computer: each teammate runs `capsules init` once.
- If anything goes wrong, Capsules is designed never to block Claude because of its own bug; it shows an error and lets the edit through. Please tell Parth when that happens.

Questions or problems: reply to Parth directly.
