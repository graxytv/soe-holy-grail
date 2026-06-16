# SoE Holy Grail

SoE Holy Grail is a desktop grail tracker for Sanctuary of Exile players who want a lightweight automatic grail tracker. It scans your shared stash and selected character save, marks new grail completions, and keeps those completions permanently after the first discovery.

## Screenshots

### Grail Tracking

![Grail tracking view](docs/screenshots/grail.png)

### Character Scanner

![Character save selection view](docs/screenshots/characters.png)

### Settings, Sounds, And Updates

![Settings view](docs/screenshots/settings.png)

## Features

- Tracks unique items, set items, runes, and Fate Cards.
- Fate Cards complete after one full required stack is found.
- Automatic scans for `pd2_shared.stash`, `pd2_hc_shared.stash`, and the selected `.d2s` character.
- Manual Player Sync plus optional timed active-character sync with configurable interval.
- Persistent grail history, so items stay completed even if you drop or trade them later.
- Settings reset button for starting a fresh grail without changing app configuration.
- Character tab where you can select the character you're actively playing so items in their inventory get tracked!
- Recent Finds panel for the latest 20 grail completions.
- Optional always-on-top progress circle overlay with new-find popup.
- Configurable new-grail sound using bundled SoE Companion sounds and FilterBlade sound options.
- In-app update checking and portable update install support through GitHub Releases.

## Download

Download the latest Windows portable zip from GitHub Releases:

```txt
SoE-Holy-Grail-win32-x64-vX.Y.Z.zip
```

Extract it anywhere and run:

```txt
SoE Holy Grail.exe
```

## Setup

1. Open Settings.
2. Select your shared stash file if the default is not correct.
3. Open Characters and select the character you are actively playing.
4. Use Scan Now or let the app auto-sync after save and exit.

Default shared stash path:

```txt
C:\Program Files (x86)\Diablo II\Save\pd2_shared.stash
```

## Data

User progress is stored outside the app folder at:

```txt
%APPDATA%\soe-holy-grail\grail-state.json
```

The app keeps grail completions after first discovery. Auto-scans add newly completed entries but do not remove old completions when items leave your stash or inventory.
