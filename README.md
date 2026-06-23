# Prompt Cabinet

Prompt Cabinet is a local-first desktop prompt library for collecting, organizing, analyzing, editing, copying, importing, and exporting reusable work prompts.

It is built with React, Vite, TypeScript, and Electron. The first version works without a backend or database.

## Features

- Add, edit, delete, search, and view prompts
- Manual categories and tags
- Mock Rules analysis with no external API calls
- Optional OpenAI-compatible API analysis
- Optional Local Codex analysis through the Codex SDK
- Local JSON file storage in the Electron desktop app
- Import and export JSON
- Merge imported prompts with existing prompts
- Auto-classify imported prompts with local rules
- Always-on-top desktop window for quick prompt capture

## Categories

- Design
- Writing
- Research
- Coding
- Image
- Video
- Career
- Product

## Run Locally

Install dependencies:

```bash
npm install
```

Run the browser development app:

```bash
npm run dev
```

Run the Electron desktop app:

```bash
npm run desktop:dev
```

Build production assets:

```bash
npm run build
```

## Desktop Data

In the Electron app, prompts are stored locally on the user's computer:

```text
%APPDATA%\prompt-cabinet\prompt-cabinet-data.json
```

Analyze settings are stored locally as:

```text
%APPDATA%\prompt-cabinet\prompt-cabinet-settings.json
```

## Notes

Prompt Cabinet does not require an API key by default. Mock Rules analysis runs locally. OpenAI-compatible API and Local Codex modes are optional user-controlled settings.
