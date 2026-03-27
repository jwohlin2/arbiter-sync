# Arbiter Sync

Pulls your game assignments from Arbiter Sports, adds them to Google Calendar, and sends day-before confirmation emails to host schools.

## What it does

- Pulls your Arbiter schedule and syncs it to Google Calendar
- Shows upcoming Referee games in a simple web UI
- Sends confirmation emails to host school contacts the day before each game
- Runs automatically every day at 9 AM via Windows Task Scheduler

## Prerequisites

- Windows PC
- [Node.js](https://nodejs.org) (download the LTS version)
- A Google account with Google Calendar

## Setup

### 1. Download the project

Click the green **Code** button on this page → **Download ZIP** → extract it somewhere on your PC (e.g. `C:\arbiter-sync`).

### 2. Install dependencies

Open PowerShell, navigate to the folder, and run:

```
cd C:\arbiter-sync
npm install
npx playwright install chromium
```

### 3. Get the Google credentials file

Contact the repository owner for the `gcal-credentials.json` file. Place it in the `data/` folder inside the project.

> You also need to be added as an authorized user — send the repo owner your Gmail address.

### 4. Log into Arbiter

Double-click `start.bat` to open the app, then click **Connect Arbiter**. A browser window will open — log in with your email and userername _**NOT YOUR GOOGLE ACCOUNT**_ account and complete MFA. Once you can see your schedule, click **I'm logged in**.

### 5. Connect Google Calendar

Click **Connect Google Calendar** in the app and sign in with your Google account.

### 6. Set your info

Fill in your name and phone number in the **Your Info** section and click **Save**. This is used in the email signature.

### 7. Sync

Click **Sync Now** to pull your games and add them to Google Calendar.

### 8. Schedule automatic daily sync (optional)

Run `schedule-task.bat` from a CMD window (right-click → Run as administrator) to set up a daily 9 AM sync and email send.

## Daily use

- Double-click `start.bat` to open the app
- Click **Sync Now** to refresh your games
- Click **Send Confirmation** on any upcoming Referee game to send a day-before email to the host school

## Re-connecting

Google sessions last a long time. Arbiter sessions may expire occasionally — just click **Re-connect Arbiter** in the app if sync stops working.
