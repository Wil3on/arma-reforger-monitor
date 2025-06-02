const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { GameDig } = require('gamedig');
const fs = require('fs');
const path = require('path');

class DiscordBot {
    constructor(config, serverStats) {
        this.config = config;
        this.serverStats = serverStats;
        this.client = null;        // Only use messageId if it's not empty/null
        this.messageId = (config.discord.messageId && config.discord.messageId.trim() !== '') ? config.discord.messageId : null;
        this.isConnected = false;
        this.configPath = path.join(__dirname, 'config.json');        
        if (this.messageId) {
            console.log('Discord bot initialized with existing message ID from config:', this.messageId);
        } else {
            console.log('Discord bot initialized - will create new message on first run');
        }
        
        if (config.discord.enabled) {
            this.initializeBot();
        }    }    saveMessageIdToConfig() {
        try {
            // Read current config
            const configData = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            
            // Update message ID in config
            configData.discord.messageId = this.messageId;
            
            // Write back to config file
            fs.writeFileSync(this.configPath, JSON.stringify(configData, null, 2));
            console.log('Saved message ID to config:', this.messageId);
        } catch (error) {
            console.error('Error saving message ID to config:', error);
        }
    }

    async initializeBot() {
        try {
            this.client = new Client({ 
                intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] 
            });

            this.client.once('ready', () => {
                console.log(`Discord bot logged in as ${this.client.user.tag}`);
                this.isConnected = true;
                
                // Start updating Discord status
                this.startStatusUpdates();
            });

            this.client.on('error', (error) => {
                console.error('Discord client error:', error);
                this.isConnected = false;
            });

            await this.client.login(this.config.discord.botToken);
        } catch (error) {
            console.error('Failed to initialize Discord bot:', error);
        }
    }    async queryServerWithGameDig() {
        try {
            console.log('Querying server with GameDig...');
            const state = await GameDig.query({
                type: this.config.gamedig.type,
                host: this.config.gamedig.host,
                port: this.config.gamedig.port,
                timeout: this.config.gamedig.timeout
            });            // Check for different player count properties - prioritize numplayers
            let playerCount = 0;
            if (typeof state.numplayers === 'number') {
                playerCount = state.numplayers;
            } else if (state.players && Array.isArray(state.players) && state.players.length > 0) {
                playerCount = state.players.length;
            } else if (typeof state.players === 'number') {
                playerCount = state.players;
            }
              console.log(`GameDig query successful: ${state.name || 'Unknown'} - ${playerCount}/${state.maxplayers} players`);

            // Determine server location based on IP address
            const serverLocation = this.getServerLocation(this.config.gamedig.host);return {
                online: true,
                players: playerCount,
                maxPlayers: state.maxplayers || 128,
                map: state.map || 'Unknown',
                ping: state.ping || 0,
                name: state.name || this.config.discord.serverName,
                game: state.raw?.game || 'Arma Reforger',
                version: state.version || 'Unknown',
                location: serverLocation
            };        } catch (error) {
            console.error('GameDig query failed:', error);

            // Still determine location even when offline
            const serverLocation = this.getServerLocation(this.config.gamedig.host);

            return {
                online: false,
                players: 0,
                maxPlayers: 128,
                map: 'Unknown',
                ping: 0,
                name: this.config.discord.serverName,
                game: 'Arma Reforger',
                version: 'Unknown',
                location: serverLocation
            };
        }
    }

    formatUptime(uptimeMs) {
        if (!uptimeMs) return '0h 0m 0s';
        
        const totalSeconds = Math.floor(uptimeMs / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        } else {
            return `${minutes}m ${seconds}s`;
        }
    }    async createServerEmbed() {
        try {
            // Query server with GameDig
            const gameDigData = await this.queryServerWithGameDig();
            
            // Get local stats
            const currentStats = this.serverStats.getCurrentStats();
            const victories = this.serverStats.getVictories();

            // Set embed color based on server online status
            const embedColor = gameDigData.online ? '#00ff00' : '#ff0000'; // Green if online, red if offline

            const embed = new EmbedBuilder()
                .setColor(embedColor)
                .setTimestamp()                .setFooter({ 
                    text: `Updated: ${new Date().toLocaleString('en-US', { 
                        timeZone: 'Europe/Paris',
                        hour12: false 
                    })} CEST (Update Interval 30 sec)` 
                });// Server Status
            embed.addFields([                {
                    name: '',                    value: `**${gameDigData.name}**\n\n` +
                           `**Game:** ${gameDigData.game || 'Arma Reforger'}\n` +
                           `**Version:** ${gameDigData.version || 'Unknown'}\n` +
                           `**Status:** ${gameDigData.online ? 'Online' : 'Offline'}\n` +                           `**Players:** ${gameDigData.players}/${gameDigData.maxPlayers}\n` +
                           `**Map:** ${gameDigData.map}\n` +                           `**Server IP:** ${this.config.gamedig.host}:${this.config.gamedig.gamePort}\n` +                           `**Server Location:** ${gameDigData.location}\n` +
                           `**Ping:** ${gameDigData.ping}ms\n` +
                           `**Crossplay:** ${this.config.gamedig.supportedPlatforms.length > 1 ? 'True' : 'False'} (${this.config.gamedig.supportedPlatforms.join(', ')})\n` +
                           `**Uptime:** ${this.formatUptime(currentStats.uptime)}\n` +
                           `**FPS:** ${currentStats.fps || 'N/A'}`,
                    inline: false
                }
            ]);            // Victory Stats with Last Round Winner
            if (victories.nato !== undefined && victories.russia !== undefined) {
                const total = victories.nato + victories.russia;
                const natoPercentage = total > 0 ? Math.round((victories.nato / total) * 100) : 0;
                const russiaPercentage = total > 0 ? Math.round((victories.russia / total) * 100) : 0;
                
                let natoStatus = '';
                let russiaStatus = '';
                
                if (victories.nato > victories.russia) {
                    natoStatus = 'Leading ↑';
                    russiaStatus = 'Behind ↓';
                } else if (victories.russia > victories.nato) {
                    russiaStatus = 'Leading ↑';
                    natoStatus = 'Behind ↓';
                } else {
                    natoStatus = 'Tied';
                    russiaStatus = 'Tied';
                }                embed.addFields([
                    {
                        name: '',
                        value: `**Last Round Winner:** ${currentStats.lastRoundWinner || 'N/A'}\n` +
                               `**NATO:** ${victories.nato} wins ${natoPercentage}% ${natoStatus}\n` +
                               `**RUSSIA:** ${victories.russia} wins ${russiaPercentage}% ${russiaStatus}`,
                        inline: false
                    }
                ]);
            }

            return embed;
        } catch (error) {
            console.error('Error creating Discord embed:', error);
            
            // Return a basic embed in case of error
            return new EmbedBuilder()
                .setTitle(this.config.discord.serverName)
                .setDescription(this.config.discord.serverDescription)
                .setColor('#ff0000')
                .addFields([
                    {
                        name: '❌ Error',
                        value: 'Failed to retrieve server stats',
                        inline: false
                    }
                ])
                .setTimestamp();
        }
    }    async updateDiscordStatus() {
        if (!this.isConnected || !this.client) {
            console.log('Discord bot not connected, skipping update');
            return;
        }

        try {
            console.log('Updating Discord status...');
            const channel = await this.client.channels.fetch(this.config.discord.channelId);
            if (!channel) {
                console.error('Discord channel not found');
                return;
            }

            const embed = await this.createServerEmbed();
            console.log('Created server embed, sending to Discord...');            if (this.messageId) {
                try {
                    const message = await channel.messages.fetch(this.messageId);
                    await message.edit({ embeds: [embed] });
                    console.log('Updated existing Discord message');                } catch (error) {
                    console.log('Message not found or error updating, creating new one...');
                    console.log('Error details:', error.message);
                    const newMessage = await channel.send({ embeds: [embed] });
                    this.messageId = newMessage.id;
                    this.saveMessageIdToConfig();
                    console.log('Created new Discord message with ID:', this.messageId);
                }            } else {
                console.log('No existing message ID - creating first message...');
                const message = await channel.send({ embeds: [embed] });
                this.messageId = message.id;
                this.saveMessageIdToConfig();
                console.log('Created first Discord message with ID:', this.messageId);
            }

        } catch (error) {
            console.error('Error updating Discord status:', error);
        }
    }

    startStatusUpdates() {
        if (!this.config.discord.enabled) {
            return;
        }

        // Initial update
        setTimeout(() => {
            this.updateDiscordStatus();
        }, 5000);

        // Regular updates
        setInterval(() => {
            this.updateDiscordStatus();
        }, this.config.discord.updateInterval);    }    clearMessageId() {
        try {
            // Read current config
            const configData = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            
            // Remove message ID from config
            delete configData.discord.messageId;
            
            // Write back to config file
            fs.writeFileSync(this.configPath, JSON.stringify(configData, null, 2));
            console.log('Cleared message ID from config');
            
            this.messageId = null;
        } catch (error) {
            console.error('Error clearing message ID from config:', error);
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.destroy();
            this.isConnected = false;
        }
    }

    getServerLocation(ipAddress) {
        // Simple IP-to-country mapping for common server IPs
        // You can expand this or use a proper IP geolocation service
        const ipToCountry = {
            '35.242.210.141': 'DE', // Google Cloud Europe (Germany)
            // Add more IP mappings as needed
        };

        // Check if we have a mapping for this IP
        if (ipToCountry[ipAddress]) {
            return ipToCountry[ipAddress];
        }

        // Fallback: try to determine by IP range (basic detection)
        if (ipAddress.startsWith('35.242.')) {
            return 'DE'; // Google Cloud Europe West
        }
        if (ipAddress.startsWith('34.76.') || ipAddress.startsWith('34.77.')) {
            return 'DE'; // Google Cloud Europe West
        }
        if (ipAddress.startsWith('52.') || ipAddress.startsWith('18.')) {
            return 'US'; // AWS US regions
        }
        if (ipAddress.startsWith('13.') || ipAddress.startsWith('20.')) {
            return 'US'; // Azure US regions
        }

        // Default fallback
        return 'EU'; // Unknown European location
    }
}

module.exports = DiscordBot;
