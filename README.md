# Limitless Lifelogs & Chats for Obsidian

![Limitless Lifelogs](https://github.com/Maclean-D/obsidian-limitless-lifelogs/raw/main/limitless-lifelogs.png)

Sync your Limitless AI lifelog entries and chat conversations directly into Obsidian markdown files.

## Features

### Lifelogs
- Download your Limitless AI lifelog entries as markdown files
- Automatically organize entries by date (YYYY-MM-DD.md)
- Sync new entries with a single click
- Preserves original markdown formatting and structure
- Supports incremental syncing (only fetches new or updated entries)

### Chats (New in v1.1.0)
- Sync your Ask AI conversation history
- Multiple file organization formats: per-chat, daily summaries, or monthly archives
- Preserve full conversation context including tool calls and results
- Automatic linking to referenced lifelog entries
- Configurable sync limits and scheduling

## Installation

### Manual Installation

1. Download the latest release from the releases page
2. Extract the zip file into your vault's `.obsidian/plugins` folder
3. Enable the plugin in your Community Plugins list

## Configuration

### Basic Setup
1. Open Obsidian Settings
2. Go to "Limitless Lifelogs & Chats" in the plugin list
3. Enter your Limitless AI API key
4. Choose the folder where you want your lifelog entries to be stored
5. (Optional) Modify the start date for initial sync (defaults to February 9th, 2025)

### Chat Settings (New)
6. Enable "Enable chat sync" to sync conversation history
7. Set the "Chat folder path" for storing conversations
8. Choose your preferred "Chat file format":
   - **One file per chat**: Each conversation gets its own file
   - **Daily chat summaries**: Group all chats by day
   - **Monthly chat archives**: Organize chats by month
9. Set "Max chats per sync" to control batch size (1-200)

## Usage

### Syncing Data

The plugin offers several ways to sync your data:

#### Ribbon Icon (Enhanced)
- **Normal click**: Sync lifelogs only
- **Ctrl/Cmd + click**: Sync chats only
- **Shift + click**: Sync both lifelogs and chats

#### Command Palette Options
Use the command palette (Ctrl/Cmd + P) to access:
- "Limitless Lifelogs & Chats: Sync Lifelogs" - Sync lifelog entries only
- "Limitless Lifelogs & Chats: Sync Chats" - Sync chat conversations only
- "Limitless Lifelogs & Chats: Sync All (Lifelogs + Chats)" - Sync everything

### Initial Setup
1. Configure your API key and folder settings (both lifelog and chat folders)
2. Enable chat sync if you want conversation history
3. Choose your preferred chat file organization format
4. Use any of the sync methods above to start syncing

## File Format

### Lifelog Files
Each lifelog entry is saved in a markdown file named with the date format `YYYY-MM-DD.md`. The content preserves the original structure from Limitless AI, including:

- Entry titles as H1 headings
- Sections as H2 headings
- Messages with timestamps and speaker names
- Original markdown formatting

### Chat Files (New)
Chat conversations are organized based on your chosen format:

#### Per-Chat Format
- Each conversation gets its own file: `[Chat Title] - [Chat ID].md`
- Contains full conversation with metadata, messages, tool calls, and results

#### Daily Format
- All chats from a day grouped in: `YYYY-MM-DD - Chats.md`
- Multiple conversations organized chronologically

#### Monthly Format
- All chats from a month in: `YYYY-MM - Chats.md`
- Conversations organized by date within the month

Each chat file includes:
- Chat metadata (ID, creation date, visibility)
- Full conversation history with timestamps
- Tool calls and their results
- Automatic links to referenced lifelog entries

## FAQ

### How do I get my Limitless AI API key?

1. Log in to your Limitless AI account
2. Navigate to Settings > API
3. Generate a new API key

### What happens if I sync multiple times?

The plugin uses incremental syncing for lifelogs, so it will only fetch new or updated entries since your last sync. For chats, the plugin will sync based on your configured limits and avoid duplicating content.

### Can I sync chats and lifelogs to different folders?

Yes! You can configure separate folder paths for lifelogs and chats in the plugin settings.

### What chat file format should I choose?

- **Per-chat**: Best for detailed analysis of individual conversations
- **Daily**: Good for reviewing all conversations from a specific day
- **Monthly**: Ideal for archival and long-term organization

### Are tool calls and results preserved?

Yes, the plugin preserves all tool calls, their results, and any referenced lifelog entries with automatic linking.

## Troubleshooting

If you encounter any issues:

1. Verify your API key is correct
2. Check your internet connection
3. Ensure you have write permissions in your chosen folder
4. Try restarting Obsidian

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Maclean-D/obsidian-limitless-lifelogs&type=Date)](https://star-history.com/#Maclean-D/obsidian-limitless-lifelogs&Date)

## Contributors

<a href="https://github.com/Maclean-D/obsidian-limitless-lifelogs/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Maclean-D/obsidian-limitless-lifelogs" />
</a>