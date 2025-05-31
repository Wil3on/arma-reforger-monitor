# Remote Log Fetching Configuration

The Arma Monitor now supports fetching log files from remote servers via SFTP/FTP. This is useful when your Arma Reforger server is running on a different machine than the monitoring application.

## Configuration

To enable remote log fetching, update your `config.json` file's `logSource` section:

### SFTP Configuration

```json
{
  "logSource": {
    "type": "remote",
    "localPath": "C:\\path\\to\\local\\logs",
    "remote": {
      "enabled": true,
      "protocol": "sftp",
      "host": "your-server-ip.com",
      "port": 22,
      "username": "your-username",
      "password": "your-password",
      "privateKeyPath": "C:\\path\\to\\private\\key.pem",
      "remotePath": "/var/log/arma-reforger/console.log",
      "localCachePath": "./temp_logs",
      "downloadInterval": 10000,
      "keepLocalFiles": true
    }
  }
}
```

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `type` | string | Yes | Set to `"remote"` to enable remote log fetching |
| `localPath` | string | No | Fallback path for local logs (used when remote is disabled) |
| `enabled` | boolean | Yes | Whether remote log fetching is enabled |
| `protocol` | string | Yes | Protocol to use: `"sftp"` or `"ftp"` |
| `host` | string | Yes | Remote server hostname or IP address |
| `port` | number | No | Remote server port (default: 22 for SFTP, 21 for FTP) |
| `username` | string | Yes | Username for authentication |
| `password` | string | No* | Password for authentication |
| `privateKeyPath` | string | No* | Path to private key file for key-based authentication |
| `remotePath` | string | Yes | Full path to the log file on the remote server |
| `localCachePath` | string | No | Local directory to cache downloaded logs (default: `"./temp_logs"`) |
| `downloadInterval` | number | No | How often to download logs in milliseconds (default: 10000) |
| `keepLocalFiles` | boolean | No | Whether to keep cached files after download (default: true) |

*Either `password` or `privateKeyPath` must be provided for authentication.

## Authentication Methods

### Password Authentication
```json
{
  "username": "myuser",
  "password": "mypassword"
}
```

### Private Key Authentication (Recommended)
```json
{
  "username": "myuser",
  "privateKeyPath": "C:\\Users\\myuser\\.ssh\\id_rsa"
}
```

## Example Configurations

### Linux Server with Password
```json
{
  "logSource": {
    "type": "remote",
    "remote": {
      "enabled": true,
      "protocol": "sftp",
      "host": "192.168.1.100",
      "port": 22,
      "username": "gameserver",
      "password": "mypassword",
      "remotePath": "/home/gameserver/arma-reforger/profile/logs/console.log"
    }
  }
}
```

### Windows Server with Private Key
```json
{
  "logSource": {
    "type": "remote",
    "remote": {
      "enabled": true,
      "protocol": "sftp",
      "host": "gameserver.example.com",
      "port": 2222,
      "username": "administrator",
      "privateKeyPath": "C:\\keys\\gameserver_key.pem",
      "remotePath": "C:/GameServers/ArmaReforger/profile/logs/console.log"
    }
  }
}
```

## Local Mode (Default)

To use local log files (default behavior), set the type to `"local"`:

```json
{
  "logSource": {
    "type": "local",
    "localPath": "C:\\path\\to\\local\\logs"
  }
}
```

## Features

- **Automatic Connection Management**: Connections are established and maintained automatically
- **Error Handling**: Robust error handling with fallback to local logs if remote fails
- **Caching**: Downloaded logs are cached locally for improved performance
- **Real-time Monitoring**: Supports the same real-time monitoring features as local logs
- **Multiple Protocols**: Support for both SFTP and FTP protocols

## Troubleshooting

### Connection Issues
- Verify host, port, username, and credentials are correct
- Check firewall settings on both client and server
- Ensure SSH/FTP service is running on the remote server

### Authentication Issues
- For private key authentication, ensure the key file exists and has correct permissions
- Verify the private key format is compatible (OpenSSH format recommended)
- Check that the public key is added to the server's authorized_keys file

### Log File Access
- Ensure the remote path points to the correct log file
- Verify the user has read permissions for the log file
- Check that the log file exists on the remote server

## Log Output

When remote log fetching is enabled, you'll see log messages like:
```
[LOG SOURCE] Remote log fetching configured (SFTP)
[SFTP] Connecting with private key: /path/to/key.pem
[SFTP] Connected to gameserver.example.com:22
[REMOTE LOG] Fetching log from remote source...
[CACHE] Cache directory ensured: ./temp_logs
```
