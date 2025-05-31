# FPS Monitor

This Node.js application monitors log files for FPS data and exposes an API endpoint to retrieve the latest and average FPS values.

## Features

- Automatically finds and monitors the latest directory in the logs folder
- Extracts FPS values from console.log files
- Calculates average FPS
- Provides an API endpoint to retrieve FPS data
- Configurable via config.json

## Project Overview

The FPS Monitor is designed to help developers and server administrators track the performance of their Arma Reforger servers by monitoring FPS data in real-time. It provides a simple API and a monitoring dashboard for easy visualization.

## Prerequisites

- Node.js (version 14 or higher)
- npm (Node Package Manager)

## Configuration

The application is configured through the `config.json` file. For detailed configuration options and examples, see the [Configuration Guide](CONFIG_GUIDE.md).

### Quick Configuration

1. **Basic Setup**: Update paths and server details
```json
{
  "logFileName": "console.log",
  "updateInterval": 5000,
  "port": 3001
}
```

2. **Log Source**: Choose between local or remote logs
```json
{
  "logSource": {
    "type": "local",
    "localPath": "C:\\path\\to\\server\\logs"
  }
}
```

3. **Discord Integration**: Add bot token and channel ID
```json
{
  "discord": {
    "enabled": true,
    "botToken": "YOUR_BOT_TOKEN",
    "channelId": "YOUR_CHANNEL_ID"
  }
}
```

4. **Server Query**: Configure GameDig for server stats
```json
{
  "gamedig": {
    "enabled": true,
    "host": "your-server-ip",
    "port": 17777
  }
}
```

For complete configuration options including remote log fetching (SFTP/FTP), crash monitoring, and advanced settings, see [CONFIG_GUIDE.md](CONFIG_GUIDE.md).

## Installation

1. Make sure you have Node.js installed
2. Install dependencies:
   ```
   npm install
   ```

## Usage

1. Start the application:
   ```
   npm start
   ```

2. Access the API endpoint:
   ```
   GET http://localhost:3000/api/fps
   ```

## API Documentation

### Endpoint: `/api/fps`
- **Method**: GET
- **Description**: Retrieves FPS data, including the latest FPS, average FPS, and historical data.
- **Query Parameters**:
  - `timeframe` (optional): Specifies the timeframe for historical data. Possible values: `raw`, `hourly`, `daily`, `weekly`, `monthly`. Default: `raw`.
  - `limit` (optional): Limits the number of data points returned. Default: 10.
- **Response**:

```json
{
  "latestFPS": 88.2,
  "averageFPS": "92.45",
  "timestamp": "2025-04-27 11:50:22",
  "values": [95.1, 94.2, 92.8, 89.5, 90.1, 92.8, 95.3, 96.0, 91.5, 88.2],
  "labels": ["11:40:22", "11:41:22", "11:42:22", "11:43:22", "11:44:22", "11:45:22", "11:46:22", "11:47:22", "11:48:22", "11:49:22"],
  "timeframe": "raw"
}
```

### Endpoint: `/api/players`
- **Method**: GET
- **Description**: Retrieves player count data, including the latest player count, average player count, and historical data.
- **Query Parameters**:
  - `timeframe` (optional): Specifies the timeframe for historical data. Possible values: `raw`, `hourly`, `daily`, `weekly`, `monthly`. Default: `raw`.
  - `limit` (optional): Limits the number of data points returned. Default: 10.
- **Response**:

```json
{
  "latestPlayerCount": 5,
  "averagePlayerCount": "6",
  "timestamp": "2025-04-27 11:50:22",
  "values": [6, 7, 5, 4, 6, 7, 8, 5, 6, 5],
  "labels": ["11:40:22", "11:41:22", "11:42:22", "11:43:22", "11:44:22", "11:45:22", "11:46:22", "11:47:22", "11:48:22", "11:49:22"],
  "timeframe": "raw"
}
```

### Endpoint: `/api/uptime`
- **Method**: GET
- **Description**: Provides server uptime information.
- **Response**:

```json
{
  "status": "online",
  "message": "Server has been online for 2 days, 3 hours, 15 minutes, 30 seconds",
  "uptime": {
    "seconds": 30,
    "minutes": 15,
    "hours": 3,
    "days": 2,
    "totalSeconds": 183330,
    "totalMinutes": 3055,
    "totalHours": 50
  },
  "uptimeString": "2 days, 3 hours, 15 minutes, 30 seconds",
  "startTime": "2025-04-25T08:35:22.000Z",
  "currentTime": "2025-04-27T11:50:22.000Z"
}
```

## Frontend Monitoring Dashboard

The application includes a simple monitoring dashboard accessible at the root URL (`http://localhost:3000/`). This dashboard visualizes FPS data in real-time, providing insights into server performance.

## Logging

Logs are stored in the `logs` directory specified in the `config.json` file. Ensure the directory exists and is writable by the application.

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository
2. Create a new branch for your feature or bugfix
3. Commit your changes and push the branch
4. Submit a pull request

## Testing

To run tests (if available):
```bash
npm test
```

## Known Issues or Limitations

- The application currently supports only one log file format (`console.log`).
- Ensure the log directory structure matches the expected format.

## License

This project is licensed under the terms of the LICENSE.txt

## Screenshots

Include screenshots of the monitoring dashboard or API usage examples here (if applicable).
