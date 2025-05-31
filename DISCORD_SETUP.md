# Discord Integration Setup Guide

This guide will help you set up Discord integration for your Arma Reforger Monitor to display server statistics in your Discord server.

## Features

The Discord bot will display:
- 📊 **Server Status**: Online/Offline, Players, Map, Server IP, Uptime
- ⚡ **Performance**: FPS, Match Duration, Base Captured, Total Players Killed, Last Round Winner
- 🏆 **Victory Standings**: NATO vs RUSSIA wins with percentages and leading status

## Prerequisites

1. **GameDig 5.3.0** - Already installed ✅
2. **discord.js** - Already installed ✅
3. A Discord server where you have administrator permissions
4. A Discord application/bot

## Setup Steps

### 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Give it a name (e.g., "Arma Reforger Monitor")
4. Go to the "Bot" section
5. Click "Add Bot"
6. Copy the **Bot Token** (keep this secret!)

### 2. Invite Bot to Your Server

1. Go to the "OAuth2" > "URL Generator" section
2. Select scopes: `bot`
3. Select bot permissions: `Send Messages`, `View Channels`, `Read Message History`
4. Copy the generated URL and open it in your browser
5. Select your Discord server and authorize the bot

### 3. Get Channel ID

1. Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)
2. Right-click on the channel where you want the bot to post
3. Click "Copy ID"

### 4. Configure config.json

Update your `config.json` file with the Discord settings:

```json
{
  "discord": {
    "enabled": true,
    "botToken": "YOUR_ACTUAL_BOT_TOKEN_HERE",
    "channelId": "YOUR_ACTUAL_CHANNEL_ID_HERE",
    "updateInterval": 300000,
    "embedColor": "#00d4ff",
    "serverName": "Cool server",
    "serverDescription": "Way cooler"
  },
  "gamedig": {
    "enabled": true,
    "type": "armareforger",
    "host": "208.115.206.194",
    "port": 2200,
    "queryInterval": 30000,
    "timeout": 10000
  }
}
```

**Important Configuration Options:**

- `botToken`: Your Discord bot token (replace `YOUR_ACTUAL_BOT_TOKEN_HERE`)
- `channelId`: The Discord channel ID where messages will be posted
- `updateInterval`: How often to update the message (in milliseconds, default: 5 minutes)
- `embedColor`: Hex color for the Discord embed
- `serverName`: Display name for your server
- `serverDescription`: Description text (like Discord invite link)

### 5. GameDig Configuration

The GameDig configuration is used to query your Arma Reforger server:

- `type`: Set to `"armar"` for Arma Reforger
- `host`: Your server's IP address
- `port`: Your server's query port (usually game port + 1)
- `queryInterval`: How often to query the server (milliseconds)
- `timeout`: Query timeout (milliseconds)

### 6. Restart the Application

After updating the configuration:

```bash
npm start
```

## Expected Behavior

1. **Bot Status**: The bot will log in and show "Discord bot logged in as [BotName]"
2. **Initial Message**: A server status card will be posted to the specified channel
3. **Updates**: The message will be updated every 5 minutes (or your configured interval)
4. **Error Handling**: If the server is offline, it will show "Offline" status

## Troubleshooting

### Common Issues

1. **"TokenInvalid" Error**: 
   - Check that your bot token is correct
   - Make sure there are no extra spaces in the token

2. **"Unknown Channel" Error**:
   - Verify the channel ID is correct
   - Ensure the bot has access to the channel

3. **Missing Permissions**:
   - Bot needs "Send Messages" and "View Channels" permissions
   - Check channel-specific permissions

4. **GameDig Query Fails**:
   - Verify server IP and port are correct
   - Check if the server is running and accessible
   - Try increasing the timeout value

### Example Discord Message

The bot will create an embed that looks like this:

```
Cool server name

📊 Server Stats
Status: Online
Players: 16/128
Map: Everon
Server IP: 208.115.206.194:2200
Uptime: 0h 8m 11s

⚡ Performance
FPS: 60
Match Duration: 1 Day, 46 Min, 46 Sec
Base Captured: 17
Total Players Killed (Per Match): 31
Last Round Winner: NATO

🏆 Victory Standings
NATO: 2 wins 67% Leading ↑
RUSSIA: 1 wins 33% Behind ↓

Updated: 31/05/2025, 20:37:05 (Update Interval 5 sec)
```

## Customization

You can customize:
- Update intervals
- Embed colors
- Server name and description
- Query timeouts
- Message formatting (edit `discord-bot.js`)

## Security Notes

- **Never share your bot token publicly**
- **Store sensitive config in environment variables for production**
- **Restrict bot permissions to minimum required**

---

Your Discord integration is now ready! The bot will automatically post and update server statistics in your Discord channel.
