# The AI runner: setup, step by step

The runner is a small program on your own computer. It does two jobs, each one only if you say yes:

- **Answers your apps' AI requests** (a coach review of your week, a practice plan) through your private
  cloud folder, so no browser tab has to stay open and replies reach every device.
- **The fitness feed**: reads your Garmin and Strava activities and weigh-ins every three hours and saves
  ONE combined list in your cloud folder, each workout counted once even when both services have it.
  The hub uses it for your weekly targets and character sheet, and the fitness apps can read it instead
  of each fetching the same data.

- **The daily brief**, ready by 06:30: your calendar, tasks, weather, training and recovery, and what your
  apps say, written into one page you read on the hub (**Brief**, top right). It follows your own recipe
  if you have one (`Documents\Cowork\MorningBrief\TASK-PROMPT.md`), otherwise a built-in one. Your mail
  is never read.

It is optional: every app works without it.

What it does, and what it never does:

- It reads the requests your apps put in your cloud folder, asks an AI to answer each one, checks the
  answer and puts it back. **The apps still show you every answer before anything changes.**
- The AI it uses has **no tools**: it cannot open files, run anything or reach the internet. It only reads
  the request and writes an answer.
- It sends a request to an AI only after you say yes (step 3), and only to the AI you chose.
- It never reads your mail and never writes to any outside service. Garmin's connector can also change
  things in your Garmin account; the runner only ever calls two named read tools and refuses anything else.
- Everything it keeps (your choices, your sign-in, a log) stays in a folder in your home folder,
  `.adervec-runner`. Nothing goes to the maker.

Today it runs on **Windows**, every 30 minutes **while you are logged in**. It needs about two minutes
of your time once.

## 1. What you need

- **Python 3.9 or newer.** In a terminal, `python --version` should print it. If not, install it from
  python.org and tick "Add python.exe to PATH".
- **An AI to answer**, one of:
  - **Claude Code**, signed in with your Claude subscription (the simplest), or
  - **an API key** for OpenAI or any service that speaks the same API (you pay that service per use).
    A ChatGPT subscription on its own does not include an API key.
- **The runner itself**: `runner.py` from this repository, saved anywhere on your computer.

## 2. Your cloud

Your apps keep their synced copy in your private Google Drive app folder (Dropbox and OneDrive are coming).
The runner signs in to the same folder through its own small sign-in client.

> For now the runner's sign-in client is not shipped with it: the maker places it at
> `.adervec-runner\desktop.json`. Making that automatic is the next step before other people can use
> the runner.

## 3. Set it up

In a terminal, in the folder where you saved `runner.py`:

```
python runner.py setup
```

It walks through five steps; you can skip any of them:

1. **The AI**: Claude Code if it finds it, or an API key (kept on this computer only).
2. **Your cloud**: opens your browser once to sign in. You may see "Google hasn't verified this app":
   choose *Advanced*, then continue. It asks only for the app folder, not your Drive files.
   Optionally, also folders on this computer that apps already use for cowork.
3. **Consent**: it tells you which AI service will receive your apps' requests, and asks if that is
   all right. Then it asks, separately, whether to read Garmin and Strava. Without a yes, nothing is
   ever sent or read.
4. **The schedule**: every 30 minutes while you are logged in.
5. **A check** of everything (below).

### For the fitness feed

- **Garmin**: the runner uses a free Garmin connector on your computer. Install `uv` (from astral.sh),
  then sign in once in a terminal (it asks for your Garmin email, password and, if you use one, a code):

  ```
  uvx --python 3.12 --from git+https://github.com/Taxuspt/garmin_mcp garmin-mcp-auth
  ```

  This is a community project, not Garmin's own, and it can break when Garmin changes their sign-in.
  Your password is not stored; a sign-in pass is kept in `.garminconnect` in your home folder.
- **Strava**: read through your Claude Strava connector (claude.ai > Settings > Connectors), so it needs
  Claude Code as the engine. The AI only makes the call; the runner keeps Strava's own numbers.

## 4. In each app

Open the app's **AI cowork** panel and press **Use my cloud**. From then on the app's requests go to your
cloud, and its replies show up there, on any device where you are signed in.

## 5. Is it working?

```
python runner.py check
```

prints one line per part, PASS or FAIL, with the exact fix for each FAIL. You can also see the runner's
last run on the hub: **Settings > Your AI runner**.

Other commands:

| Command | What it does |
|---|---|
| `python runner.py run` | answer whatever is waiting, now |
| `python runner.py status` | what the last run did, app by app |
| `python runner.py consent` | change what the runner may send |
| `python runner.py schedule remove` | stop the schedule |
| `python runner.py run --force <app>/<channel>` | try one request again |
| `python runner.py run --force brief` | write today's brief again now |
| `python runner.py run --force fitness` | fetch Garmin and Strava now |

## When something is wrong

| What you see | Why | What to do |
|---|---|---|
| `Storage: your cloud` FAIL, "not signed in" | the sign-in was never made, or was withdrawn | `python runner.py setup`, step 2 |
| It stops working after about a week | while the maker's Google sign-in is in testing, Google ends sign-ins after seven days | run setup, step 2, again |
| `Consent` FAIL | you have not said yes yet, or you changed the AI | `python runner.py consent` |
| The hub says it has not run for a while | the computer is off or logged out, or the schedule is gone | `python runner.py check` on that computer |
| An app shows "agent reported: ..." | the AI could not answer that request; the reason is in the message | press **Send requests** in the app to ask again |
| `Engine: Claude Code answers` FAIL | Claude Code is signed out | open Claude Code once and sign in |
| The hub shows the fitness feed as "partly", Garmin failing | Garmin ended the sign-in, or changed it | run the Garmin sign-in command above again |
| Strava failing: "not connected in Claude" | the Strava connector is off in claude.ai | connect it in claude.ai > Settings > Connectors |

The log is in `.adervec-runner\runner.log` in your home folder. It never holds keys, tokens or email addresses.
