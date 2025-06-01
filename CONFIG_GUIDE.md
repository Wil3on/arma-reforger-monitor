# ARMA REFORGER MONITOR CONFIGURATION GUIDE

This file explains all configuration options for the Arma Reforger Server Monitor.
Copy the settings you need to your `config.json` file.

## Basic Monitoring Settings

```json
{
  "logFileName": "console.log",              // Name of the log file to monitor
  "updateInterval": 5000,                    // Check interval in milliseconds (5 seconds)
  "port": 3001,                             // Web API server port
  "generateSampleVictoryData": false,        // Generate test data (false for production)
  "victoryDuplicateCheckMinutes": 3         // Prevent duplicate victory detection window
}
```

## GameDig Settings (Server Query)

```json
{
  "gamedig": {
    "enabled": true,                         // Enable server querying
    "type": "armareforger",                  // Game type for GameDig
    "host": "35.242.210.141",               // Server IP address
    "port": 17777,                          // Query port
    "gamePort": 2001,                       // Player connection port
    "supportedPlatforms": ["PC", "PS5", "XBOX"], // Supported platforms
    "queryInterval": 20000,                 // Query frequency (20 seconds)
    "timeout": 10000                        // Query timeout
  }
}
```

## Discord Bot Settings

```json
{
  "discord": {
    "enabled": true,                         // Enable Discord integration
    "botToken": "YOUR_BOT_TOKEN",           // Bot token from Discord Developer Portal
    "channelId": "YOUR_CHANNEL_ID",         // Channel to post updates
    "messageId": "YOUR_MESSAGE_ID",         // Existing message to edit (optional)
    "updateInterval": 30000,                // Update frequency (30 seconds)
    "embedColor": "#00d4ff",                // Embed color (hex)
    "serverName": "Your Server Name",       // Display name
    "serverDescription": "discord.gg/invite" // Description/invite link
  }
}
```

## Crash Monitor Settings

```json
{
  "crashMonitor": {
    "enabled": true,                         // Enable crash monitoring
    "isLinux": false,                        // Set to true if running on Linux
    "serverExePath": "C:\\path\\to\\ArmaReforgerServer.exe", // Server executable (Windows)
    "serverWorkingDir": "C:\\path\\to\\server", // Server working directory (Windows)
    "linuxServerExePath": "/home/user/ArmaReforger/ArmaReforgerServer", // Linux server path
    "linuxServerWorkingDir": "/home/user/ArmaReforger/server", // Linux working directory
    "linuxProcessName": "ArmaReforgerServer", // Process name to search for on Linux
    "enableAutoRestart": false,             // Auto-restart on crash
    "restartDelaySeconds": 10,              // Restart delay
    "maxRestartAttempts": 0,                // Max restart attempts (0 = unlimited)
    "restartCooldownMinutes": 5,            // Cooldown between restarts
    "serverDataLogFolder": "server_data_logs", // Log folder name
    "serverDataLogIntervalHours": 24,       // New log file interval
    "statsLogIntervalSec": 60,              // Stats logging frequency
    "crashKeywords": [                      // Keywords indicating crashes
      "Application crashed!",
      "FATAL ERROR",
      "Exception Code:",
      "Segmentation fault",
      "Killed",                             // Linux specific
      "Aborted",                            // Linux specific  
      "Bus error"                           // Linux specific
    ]
  }
}
```

## Log Source Settings

### Local Logs (Default)
```json
{
  "logSource": {
    "type": "local",                        // Use local log files
    "localPath": "C:\\path\\to\\server\\logs" // Path to log directory
  }
}
```

### Remote Logs (SFTP/FTP)
```json
{
  "logSource": {
    "type": "remote",                       // Use remote log fetching
    "remote": {
      "enabled": true,                      // Enable remote fetching
      "protocol": "sftp",                   // Protocol: "sftp" or "ftp"
      "host": "your-server.com",           // Remote server hostname/IP
      "port": 22,                          // Remote port (22 for SFTP)
      "username": "your-username",         // Authentication username
      "password": "your-password",         // Password (OR use privateKeyPath)
      "privateKeyPath": "C:\\path\\to\\key.pem", // Private key file (recommended)
      "remotePath": "/path/to/console.log", // Remote log file path
      "localCachePath": "./temp_logs",     // Local cache directory
      "downloadInterval": 10000,           // Download frequency (10 seconds)
      "keepLocalFiles": true               // Keep cached files
    }
  }
}
```

## Setup Instructions

### 1. Basic Setup
1. Copy `config.example.json` settings to `config.json`
2. Update `logFileName` to match your server's log file
3. Set `localPath` to your server's log directory
4. Configure server IP and ports in `gamedig` section

### 2. Discord Bot Setup
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create new application and bot
3. Copy bot token to `botToken` field
4. Get channel ID by right-clicking channel in Discord (Developer Mode required)
5. Invite bot to server with message permissions

### 3. Remote Log Setup (Optional)
1. Set `type` to `"remote"` in `logSource`
2. Configure SFTP/FTP connection details
3. Use private key authentication for better security
4. Test connection before enabling in production

### 4. Crash Monitoring Setup (Optional)
1. Ensure server executable and working directory paths are correct
2. Test crash keywords against your server logs
3. Set `enableAutoRestart` carefully (test first!)
4. Monitor restart attempts and cooldowns

## Security Notes

- **Discord Bot Token**: Keep your bot token secret and never commit it to version control
- **Remote Credentials**: Use private key authentication instead of passwords when possible
- **File Permissions**: Ensure the monitor has appropriate read/write permissions
- **Firewall**: Configure firewall rules for remote connections if using SFTP/FTP

## Troubleshooting

### Common Issues
- **Log file not found**: Check `localPath` or `remotePath` settings
- **Discord bot not responding**: Verify bot token and channel permissions
- **Remote connection fails**: Check credentials, network connectivity, and firewall settings
- **Crash detection not working**: Verify crash keywords match your server's error messages

### Log Output
Monitor the console output for helpful messages:
```
[LOG SOURCE] Using local log files
[SFTP] Connected to server.com:22
[CRASH MONITOR] Server process found with PID: 1234
[DISCORD] Bot initialized successfully
```
