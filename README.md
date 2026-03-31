# Arbiter Sync

Pulls your game assignments from Arbiter Sports, adds them to Google Calendar, and sends day-before confirmation emails to host schools.

## What it does

- Syncs your Arbiter schedule to Google Calendar automatically
- Shows upcoming Referee games in a simple web UI
- Sends confirmation emails to host school contacts the day before each game
- Can run automatically every morning via Windows Task Scheduler

## Prerequisites

- [Node.js](https://nodejs.org) — download and install the **LTS** version
- A Google account with Google Calendar

## First-time setup

### 1. Download the project

Click the green **Code** button → **Download ZIP** → extract it anywhere on your computer.

### 2. Get the Google credentials file

Contact the repository owner for the `gcal-credentials.json` file and place it inside the `data/` folder.

> You also need to be added as an authorized user — send the repo owner your Gmail address so they can add you.

### 3. Run the setup script

**Windows:** Double-click `windows-setup.bat`. If it says Node.js is not found, install it from [nodejs.org](https://nodejs.org) first and try again.

**Mac:** Right-click `mac-setup.command` → **Open** → approve it in System Settings → Privacy & Security if prompted. After that, double-click works normally.

Both scripts install all dependencies and download the Chromium browser used to access Arbiter.

### 4. Launch the app

**Windows:** Double-click `ArbiterSync.vbs`

**Mac:** Double-click `ArbiterSync.command`

The app opens in your browser at `http://localhost:3000`.

### 5. Connect Arbiter

Click **Connect Arbiter**. A browser window opens — log in with your **Arbiter username and password** (***not*** your Google account) and complete MFA. Once you can see your game schedule, click **I'm logged in — Save Session**.

### 6. Connect Google Calendar

Click **Connect Google Calendar** and sign in. You may see an "unverified app" warning — click **Advanced** → **Go to Arbiter Sync** to proceed.

### 7. Set your info

Fill in your name and phone number under **Your Info** and click **Save**. This appears in the email signature.

### 8. Sync

Click **Sync Now** to pull your games into Google Calendar.

## Daily use

1. Double-click `ArbiterSync.vbs` (Windows) or `ArbiterSync.command` (Mac)
2. Click **Sync Now** to refresh your schedule
3. Click **Send Confirmation** on any Referee game to email the host school

## Automatic daily sync — Windows only

Run `schedule-task.bat` from a CMD window (right-click → Run as administrator) to schedule a daily 9 AM sync and automatic email send.

To also send confirmation emails automatically, check the **Automatically send confirmation emails** box in the Your Info section and click Save before setting up the schedule.

## Troubleshooting

**Arbiter session expired** — Click **Re-connect Arbiter** and log in again.

**Google Calendar stopped syncing** — Click **Re-authorize** next to Google Calendar.

**App won't open on Mac** — Right-click the `.command` file → Open. macOS blocks unrecognized scripts on first launch.

**Node.js not found on Windows** — Install from [nodejs.org](https://nodejs.org), then open a new PowerShell window and try again.
