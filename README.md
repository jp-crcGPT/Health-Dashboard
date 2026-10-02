# Health Baseline

A private health tracker for two people, with a pregnancy-planning view. It runs in Chrome on your phone, works offline, and keeps everything on the phone. Lab reports are read on the phone too; nothing is uploaded anywhere.

## Put it online (one time, about 10 minutes, on a computer)

1. Unzip this file. You get a folder called `health-baseline` with 15 files.
2. On github.com, create a new repository, for example `health-baseline`. Choose **Public**: the repository holds only the app's code, never your results. Leave the other options alone and create it.
3. On the new repository's page, click **uploading an existing file**. Open the `health-baseline` folder, select all the files inside it, drag them in, then click **Commit changes**.
4. Open **Settings**, then **Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, Branch to **main** and the folder to **/ (root)**, then **Save**.
5. After a minute or two, the Pages screen shows the address, like `https://your-username.github.io/health-baseline/`.

## Install on your phone

1. Open that address in Chrome on the phone.
2. Open Chrome's menu (three dots), choose **Add to home screen**, then **Install**.
3. Open the app once while online so it saves itself for offline use.

## Keep a backup

Results live in Chrome's storage on this phone. They survive closing and restarting the app, but clearing Chrome's data for github.io, uninstalling Chrome or switching phones would remove them.

Open **Settings** (gear icon) and use **Download backup** or **Share backup** (Share lets you save it straight to Google Drive). **Restore from backup** brings everything back, on this phone or a new one. The app reminds you when your last backup is more than 30 days old.

## Importing reports

- Works with the digital report files labs send. If you can select text in the report, it will import.
- Scanned or photographed reports have no text inside; type those values in with **Add result**.
- Password-protected reports: the app asks for the password from the lab's email or message.
- Check every value on the review screen before saving. Untick anything that looks wrong.
- If a test isn't recognised, open **Lines not recognised** and pick what it is. The app remembers that name for future reports from the same lab.

## Updating to a newer version

Upload the new files to the same repository, replacing the old ones. The next time you open the app it shows **An update is ready**; tap **Reload**. Your data is not affected.

## About the flags

Flags compare results with published ranges, using Indian cut-offs where they exist (for example the 2025 Indian obesity definition and Cardiological Society of India 2024 cholesterol targets). The full source list is in Settings, under About. Flags are prompts to discuss with a doctor, not a diagnosis.

## Licences

Report reading uses pdf.js by Mozilla (Apache License 2.0, see `LICENSE-pdfjs.txt`). The typeface is Atkinson Hyperlegible Next (SIL Open Font License 1.1, see `LICENSE-font.txt`).
