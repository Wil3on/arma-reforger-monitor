const fs = require('fs-extra');
const path = require('path');
const SftpClient = require('ssh2-sftp-client');

class RemoteLogFetcher {
    constructor(config) {
        this.validateConfig(config);
        this.config = config;
        this.sftp = new SftpClient();
        this.isConnected = false;
        this.lastFetchTime = 0;
        this.localCachePath = path.resolve(config.localCachePath || './temp_logs');
        
        // Ensure local cache directory exists
        fs.ensureDirSync(this.localCachePath);
    }

    validateConfig(config) {
        if (!config) {
            throw new Error('Remote log fetcher configuration is required');
        }
        
        const validProtocols = ['sftp', 'ftp'];
        if (!config.protocol || !validProtocols.includes(config.protocol.toLowerCase())) {
            throw new Error(`Invalid protocol. Must be one of: ${validProtocols.join(', ')}`);
        }
        
        if (!config.host || config.host.trim() === '') {
            throw new Error('Host is required');
        }
        
        if (config.port && (typeof config.port !== 'number' || config.port <= 0 || config.port > 65535)) {
            throw new Error('Port must be a valid number between 1 and 65535');
        }
        
        if (!config.username || config.username.trim() === '') {
            throw new Error('Username is required');
        }
        
        if (!config.remotePath || config.remotePath.trim() === '') {
            throw new Error('Remote path is required');
        }
    }

    async ensureCacheDirectory() {
        try {
            await fs.ensureDir(this.localCachePath);
            console.log(`[CACHE] Cache directory ensured: ${this.localCachePath}`);
            return true;
        } catch (error) {
            console.error(`[CACHE] Failed to create cache directory: ${error.message}`);
            throw error;
        }
    }

    async connect() {
        try {
            if (this.isConnected) {
                return true;
            }

            const connectionConfig = {
                host: this.config.host,
                port: this.config.port || 22,
                username: this.config.username
            };

            // Use either password or private key authentication
            if (this.config.privateKeyPath && fs.existsSync(this.config.privateKeyPath)) {
                connectionConfig.privateKey = fs.readFileSync(this.config.privateKeyPath);
                console.log(`[SFTP] Connecting with private key: ${this.config.privateKeyPath}`);
            } else if (this.config.password) {
                connectionConfig.password = this.config.password;
                console.log(`[SFTP] Connecting with password authentication`);
            } else {
                throw new Error('No authentication method provided (password or private key)');
            }

            await this.sftp.connect(connectionConfig);
            this.isConnected = true;
            console.log(`[SFTP] Connected to ${this.config.host}:${this.config.port}`);
            return true;

        } catch (error) {
            console.error(`[SFTP] Connection failed: ${error.message}`);
            this.isConnected = false;
            return false;
        }
    }

    async disconnect() {
        try {
            if (this.isConnected) {
                await this.sftp.end();
                this.isConnected = false;
                console.log('[SFTP] Disconnected');
            }
        } catch (error) {
            console.error(`[SFTP] Disconnect error: ${error.message}`);
        }
    }

    async fetchLogFile(remoteFilePath, localFileName = null) {
        try {
            if (!this.isConnected) {
                const connected = await this.connect();
                if (!connected) {
                    return null;
                }
            }

            // Use provided local filename or extract from remote path
            const fileName = localFileName || path.basename(remoteFilePath);
            const localFilePath = path.join(this.localCachePath, fileName);

            // Check if remote file exists
            const remoteExists = await this.sftp.exists(remoteFilePath);
            if (!remoteExists) {
                console.log(`[SFTP] Remote file does not exist: ${remoteFilePath}`);
                return null;
            }

            // Get remote file stats
            const remoteStat = await this.sftp.stat(remoteFilePath);
            
            // Check if we need to download (file doesn't exist locally or remote is newer)
            let shouldDownload = true;
            if (fs.existsSync(localFilePath)) {
                const localStat = fs.statSync(localFilePath);
                const remoteModTime = new Date(remoteStat.modifyTime);
                const localModTime = new Date(localStat.mtime);
                
                if (remoteModTime <= localModTime) {
                    shouldDownload = false;
                    console.log(`[SFTP] Local file is up to date: ${fileName}`);
                }
            }

            if (shouldDownload) {
                console.log(`[SFTP] Downloading: ${remoteFilePath} -> ${localFilePath}`);
                await this.sftp.fastGet(remoteFilePath, localFilePath);
                console.log(`[SFTP] Download completed: ${fileName} (${remoteStat.size} bytes)`);
            }

            return localFilePath;

        } catch (error) {
            console.error(`[SFTP] Error fetching log file: ${error.message}`);
            
            // Try to reconnect on connection errors
            if (error.message.includes('connect') || error.message.includes('connection')) {
                this.isConnected = false;
            }
            
            return null;
        }
    }

    async fetchLogs() {
        try {
            const currentTime = Date.now();
            
            // Check if enough time has passed since last fetch
            if (currentTime - this.lastFetchTime < this.config.downloadInterval) {
                return this.getLocalLogPath();
            }

            console.log(`[SFTP] Fetching logs from ${this.config.remotePath}`);
            
            // Construct remote log file path
            const remoteLogPath = path.posix.join(this.config.remotePath, 'console.log');
            
            // Fetch the main log file
            const localLogPath = await this.fetchLogFile(remoteLogPath, 'console.log');
            
            if (localLogPath) {
                this.lastFetchTime = currentTime;
                console.log(`[SFTP] Logs updated successfully`);
                return localLogPath;
            } else {
                console.log(`[SFTP] Failed to fetch logs, using existing local copy if available`);
                return this.getLocalLogPath();
            }

        } catch (error) {
            console.error(`[SFTP] Error in fetchLogs: ${error.message}`);
            return this.getLocalLogPath();
        }
    }

    getLocalLogPath() {
        const localLogPath = path.join(this.localCachePath, 'console.log');
        return fs.existsSync(localLogPath) ? localLogPath : null;
    }

    async cleanup() {
        try {
            await this.disconnect();
            
            if (!this.config.keepLocalFiles) {
                console.log('[SFTP] Cleaning up local cache files');
                fs.removeSync(this.localCachePath);
            }
        } catch (error) {
            console.error(`[SFTP] Cleanup error: ${error.message}`);
        }
    }

    // Health check method
    async testConnection() {
        try {
            console.log('[SFTP] Testing connection...');
            const connected = await this.connect();
            
            if (connected) {
                // Try to list the remote directory
                const dirExists = await this.sftp.exists(this.config.remotePath);
                if (dirExists) {
                    console.log(`[SFTP] ✅ Connection test successful - remote directory accessible`);
                    await this.disconnect();
                    return true;
                } else {
                    console.log(`[SFTP] ❌ Remote directory not found: ${this.config.remotePath}`);
                    await this.disconnect();
                    return false;
                }
            } else {
                console.log(`[SFTP] ❌ Connection test failed`);
                return false;
            }
        } catch (error) {
            console.error(`[SFTP] Connection test error: ${error.message}`);
            return false;
        }
    }
}

module.exports = RemoteLogFetcher;
