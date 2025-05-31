const fs = require('fs-extra');
const path = require('path');
const express = require('express');
const moment = require('moment');
const cors = require('cors');
const { spawn, exec } = require('child_process');
const process = require('process');

// Discord bot integration
const DiscordBot = require('./discord-bot');

// Remote log fetcher for SFTP/FTP support
const RemoteLogFetcher = require('./remote-log-fetcher');

// Load configuration
const config = require('./config.json');

// Initialize remote log fetcher if configured
let remoteLogFetcher = null;
if (config.logSource && config.logSource.type === 'remote' && config.logSource.remote.enabled) {
  remoteLogFetcher = new RemoteLogFetcher(config.logSource.remote);
  console.log(`[LOG SOURCE] Remote log fetching configured (${config.logSource.remote.protocol.toUpperCase()})`);
} else {
  console.log(`[LOG SOURCE] Using local log files`);
}

// Data file paths
const dataDir = path.join(__dirname, 'data');
const fpsDataFile = path.join(dataDir, 'fps_data.json');
const playersDataFile = path.join(dataDir, 'players_data.json');
const victoriesDataFile = path.join(dataDir, 'victories_data.json');
const uptimeDataFile = path.join(dataDir, 'uptime_data.json');

// Initialize variables
let latestFPS = null;
let latestPlayerCount = null;

// Initialize global variables
global.latestFPS = null;
global.latestPlayerCount = null;

// Data storage for historical analysis
const dataStore = {
  fps: {
    raw: [], // Raw entries with timestamps
    hourly: {}, // Hourly averages
    daily: {}, // Daily averages
    weekly: {}, // Weekly averages
    monthly: {} // Monthly averages
  },
  players: {
    raw: [], // Raw entries with timestamps
    hourly: {}, // Hourly averages
    daily: {}, // Daily averages
    weekly: {}, // Weekly averages
    monthly: {} // Monthly averages
  },
  victories: {
    nato: 0,
    russia: 0,
    total: 0,
    lastVictory: null, // { faction: 'NATO'|'RUSSIA', timestamp: '' }
    history: [], // Array of victory entries with timestamps
    firstVictory: null // Timestamp of first recorded victory
  },
  uptime: {
    serverStartTime: null, // When the latest folder was created (server start time)
    lastChecked: null     // Last time uptime was checked
  }
};

// Crash Monitor State (only if enabled)
let crashMonitorState = null;
if (config.crashMonitor && config.crashMonitor.enabled) {
  crashMonitorState = {
    serverProcess: null,
    lastFpsValue: "N/A",
    lastPlayerCount: "N/A",
    lastMatchDuration: "N/A",
    lastBaseCaptured: "N/A", 
    lastTotalPlayersKilled: "N/A",
    lastRoundWinner: "N/A",
    memUsageMB: "N/A",
    formattedUptime: "N/A",
    lastStatsLogTime: new Date(0),
    currentServerDataLogPath: null,
    nextServerDataLogCreationTime: new Date(0),
    restartAttempts: 0,
    lastRestartTime: new Date(0),
    originalTitle: process.title,
    incidentLogPath: null,
    pidFilePath: null
  };
}

// Crash Monitor Utility Functions
function formatTimestamp(date = new Date()) {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function formatUptimeFromSeconds(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (seconds < 60) {
    return `${secs}s`;
  } else if (seconds < 3600) {
    return `${minutes}m:${secs.toString().padStart(2, '0')}s`;
  } else {
    return `${days}d ${hours.toString().padStart(2, '0')}h:${minutes.toString().padStart(2, '0')}m:${secs.toString().padStart(2, '0')}s`;
  }
}

function log(message, color = 'white') {
  const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    reset: '\x1b[0m'
  };
  
  console.log(`${colors[color] || colors.white}${message}${colors.reset}`);
}

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists
fs.ensureDirSync(dataDir);

// Store data with enhanced metadata
async function storeData(type, value, timestamp = new Date()) {
  // Store raw data
  const entry = {
    value: parseFloat(value),
    timestamp: timestamp.toISOString(),
    time: moment(timestamp)
  };
  
  dataStore[type].raw.push(entry);
  
  // Keep only last 1000 raw entries to prevent memory bloat
  if (dataStore[type].raw.length > 1000) {
    dataStore[type].raw = dataStore[type].raw.slice(-1000);
  }
  
  // Aggregate data for different time periods
  updateAggregatedData(type, entry.value, entry.time);
}

// Function to update aggregated data
function updateAggregatedData(type, value, time) {
  // Update hourly data
  const hourKey = time.format('YYYY-MM-DD HH');
  if (!dataStore[type].hourly[hourKey]) {
    dataStore[type].hourly[hourKey] = {
      sum: 0,
      count: 0,
      timestamp: time.toISOString(),
      min: value,
      max: value
    };
  }
  dataStore[type].hourly[hourKey].sum += value;
  dataStore[type].hourly[hourKey].count++;
  dataStore[type].hourly[hourKey].min = Math.min(dataStore[type].hourly[hourKey].min, value);
  dataStore[type].hourly[hourKey].max = Math.max(dataStore[type].hourly[hourKey].max, value);
  dataStore[type].hourly[hourKey].average = dataStore[type].hourly[hourKey].sum / dataStore[type].hourly[hourKey].count;

  // Update daily data
  const dayKey = time.format('YYYY-MM-DD');
  if (!dataStore[type].daily[dayKey]) {
    dataStore[type].daily[dayKey] = {
      sum: 0,
      count: 0,
      timestamp: time.toISOString(),
      min: value,
      max: value
    };
  }
  dataStore[type].daily[dayKey].sum += value;
  dataStore[type].daily[dayKey].count++;
  dataStore[type].daily[dayKey].min = Math.min(dataStore[type].daily[dayKey].min, value);
  dataStore[type].daily[dayKey].max = Math.max(dataStore[type].daily[dayKey].max, value);
  dataStore[type].daily[dayKey].average = dataStore[type].daily[dayKey].sum / dataStore[type].daily[dayKey].count;

  // Update weekly data (ISO week)
  const weekKey = time.format('YYYY-[W]WW');
  if (!dataStore[type].weekly[weekKey]) {
    dataStore[type].weekly[weekKey] = {
      sum: 0,
      count: 0,
      timestamp: time.toISOString(),
      min: value,
      max: value
    };
  }
  dataStore[type].weekly[weekKey].sum += value;
  dataStore[type].weekly[weekKey].count++;
  dataStore[type].weekly[weekKey].min = Math.min(dataStore[type].weekly[weekKey].min, value);
  dataStore[type].weekly[weekKey].max = Math.max(dataStore[type].weekly[weekKey].max, value);
  dataStore[type].weekly[weekKey].average = dataStore[type].weekly[weekKey].sum / dataStore[type].weekly[weekKey].count;

  // Update monthly data
  const monthKey = time.format('YYYY-MM');
  if (!dataStore[type].monthly[monthKey]) {
    dataStore[type].monthly[monthKey] = {
      sum: 0,
      count: 0,
      timestamp: time.toISOString(),
      min: value,
      max: value
    };
  }
  dataStore[type].monthly[monthKey].sum += value;
  dataStore[type].monthly[monthKey].count++;
  dataStore[type].monthly[monthKey].min = Math.min(dataStore[type].monthly[monthKey].min, value);
  dataStore[type].monthly[monthKey].max = Math.max(dataStore[type].monthly[monthKey].max, value);
  dataStore[type].monthly[monthKey].average = dataStore[type].monthly[monthKey].sum / dataStore[type].monthly[monthKey].count;
}

// Store victory data
async function storeVictoryData(factionName, timestamp = new Date()) {
  // Check for duplicates based on configuration
  const checkMinutes = config.victoryDuplicateCheckMinutes || 3;
  const checkTime = new Date(timestamp.getTime() - (checkMinutes * 60 * 1000));
  
  // Look for recent victories of the same faction
  const recentDuplicate = dataStore.victories.history.find(victory => {
    const victoryTime = new Date(victory.timestamp);
    return victory.faction === factionName && victoryTime > checkTime;
  });
  
  if (recentDuplicate) {
    console.log(`Duplicate victory detected for ${factionName} within ${checkMinutes} minutes. Skipping...`);
    return false;
  }

  // Store the victory
  const victoryEntry = {
    faction: factionName,
    timestamp: timestamp.toISOString(),
    id: Date.now() // Simple ID based on timestamp
  };
  
  dataStore.victories.history.push(victoryEntry);
  dataStore.victories.lastVictory = victoryEntry;
  
  // Set first victory if not set
  if (!dataStore.victories.firstVictory) {
    dataStore.victories.firstVictory = timestamp.toISOString();
  }
  
  // Update counters
  if (factionName === 'NATO') {
    dataStore.victories.nato++;
  } else if (factionName === 'RUSSIA') {
    dataStore.victories.russia++;
  }
  dataStore.victories.total++;
  
  console.log(`Victory recorded: ${factionName} at ${timestamp.toISOString()}`);
  console.log(`Total victories: NATO: ${dataStore.victories.nato}, RUSSIA: ${dataStore.victories.russia}, Total: ${dataStore.victories.total}`);
  
  return true;
}

// Function to find the latest directory (for log monitoring)
async function findLatestDirectory(logDir) {
  try {
    if (!fs.existsSync(logDir)) {
      console.log(`Log directory does not exist: ${logDir}`);
      return null;
    }
    
    const dirs = await fs.readdir(logDir);
    const dirStats = await Promise.all(
      dirs.map(async (dir) => {
        const dirPath = path.join(logDir, dir);
        const stats = await fs.stat(dirPath);
        if (stats.isDirectory()) {
          return { name: dir, path: dirPath, birthtime: stats.birthtime };
        }
        return null;
      })
    );
    
    const validDirs = dirStats.filter(Boolean);
    if (validDirs.length === 0) {
      console.log('No valid directories found in log directory');
      return null;
    }
    
    // Sort by creation time, newest first
    validDirs.sort((a, b) => b.birthtime - a.birthtime);
    
    // Set server start time from the latest directory creation time
    if (!dataStore.uptime.serverStartTime || validDirs[0].birthtime > dataStore.uptime.serverStartTime) {
      dataStore.uptime.serverStartTime = validDirs[0].birthtime;
      console.log(`Server start time set to: ${dataStore.uptime.serverStartTime.toISOString()} (from directory: ${validDirs[0].name})`);
    }
    
    return validDirs[0];
  } catch (error) {
    console.error('Error finding latest directory:', error);
    return null;
  }
}

// Function to get latest values from log file
async function getLatestValues(logFilePath, remoteLogFetcher = null) {
  try {
    const content = await getLogFileContent(logFilePath, remoteLogFetcher);
    if (!content) {
      return { fps: null, playerCount: null };
    }
    const lines = content.split('\n').reverse(); // Read from bottom
    
    let latestFps = null;
    let latestPlayerCount = null;
    const now = new Date();
    
    // Look for FPS and Player data
    for (const line of lines) {
      // FPS pattern: e.g., "15:20:22 DEFAULT   : FPS: 58.123456 | Player: 15"
      const fpsMatch = line.match(/DEFAULT\s+:\s+FPS:\s+([\d.]+).*?Player:\s+(\d+)/);
      if (fpsMatch && latestFps === null && latestPlayerCount === null) {
        latestFps = parseFloat(fpsMatch[1]);
        latestPlayerCount = parseInt(fpsMatch[2]);
        
        // Store both values
        await storeData('fps', latestFps, now);
        await storeData('players', latestPlayerCount, now);
        
        // Update global variables
        global.latestFPS = latestFps;
        global.latestPlayerCount = latestPlayerCount;
        
        break;
      }
    }
    
    // Look for victory messages
    for (const line of lines) {
      // Victory patterns
      const natoVictoryMatch = line.match(/NATO won the conflict!/i);
      const russiaVictoryMatch = line.match(/USSR won the conflict!/i);
      
      if (natoVictoryMatch) {
        await storeVictoryData('NATO', now);
        break;
      } else if (russiaVictoryMatch) {
        await storeVictoryData('RUSSIA', now);
        break;
      }
    }
    
    return { fps: latestFps, playerCount: latestPlayerCount };
  } catch (error) {
    console.error('Error reading log file:', error);
    return { fps: null, playerCount: null };
  }
}

// Save data to JSON files
async function saveDataToFiles() {
  try {
    const fpsData = {
      latestFPS: global.latestFPS,
      raw: dataStore.fps.raw,
      hourly: dataStore.fps.hourly,
      daily: dataStore.fps.daily,
      weekly: dataStore.fps.weekly,
      monthly: dataStore.fps.monthly,
      lastUpdated: new Date().toISOString()
    };
    
    const playersData = {
      latestPlayerCount: global.latestPlayerCount,
      raw: dataStore.players.raw,
      hourly: dataStore.players.hourly,
      daily: dataStore.players.daily,
      weekly: dataStore.players.weekly,
      monthly: dataStore.players.monthly,
      lastUpdated: new Date().toISOString()
    };
    
    const victoriesData = {
      nato: dataStore.victories.nato,
      russia: dataStore.victories.russia,
      total: dataStore.victories.total,
      lastVictory: dataStore.victories.lastVictory,
      firstVictory: dataStore.victories.firstVictory,
      history: dataStore.victories.history,
      lastUpdated: new Date().toISOString()
    };
    
    await fs.writeFile(fpsDataFile, JSON.stringify(fpsData, null, 2));
    await fs.writeFile(playersDataFile, JSON.stringify(playersData, null, 2));
    await fs.writeFile(victoriesDataFile, JSON.stringify(victoriesData, null, 2));
    
    console.log('Data saved to JSON files successfully');
  } catch (error) {
    console.error('Error saving data to files:', error);
  }
}

// Load data from JSON files on startup
async function loadDataFromFiles() {
  try {    // Load FPS data
    if (fs.existsSync(fpsDataFile)) {
      const fpsData = JSON.parse(await fs.readFile(fpsDataFile, 'utf8'));
      global.latestFPS = fpsData.latestFPS;
      dataStore.fps.raw = fpsData.raw || [];
      dataStore.fps.hourly = fpsData.hourly || {};
      dataStore.fps.daily = fpsData.daily || {};
      dataStore.fps.weekly = fpsData.weekly || {};
      dataStore.fps.monthly = fpsData.monthly || {};
      
      // If no latest FPS but we have raw data, use the most recent
      if (!global.latestFPS && dataStore.fps.raw.length > 0) {
        global.latestFPS = dataStore.fps.raw[dataStore.fps.raw.length - 1].value;
      }
      
      console.log(`Loaded ${dataStore.fps.raw.length} FPS entries from file`);
    }
      // Load Players data
    if (fs.existsSync(playersDataFile)) {
      const playersData = JSON.parse(await fs.readFile(playersDataFile, 'utf8'));
      global.latestPlayerCount = playersData.latestPlayerCount;
      dataStore.players.raw = playersData.raw || [];
      dataStore.players.hourly = playersData.hourly || {};
      dataStore.players.daily = playersData.daily || {};
      dataStore.players.weekly = playersData.weekly || {};
      dataStore.players.monthly = playersData.monthly || {};
      
      // If no latest player count but we have raw data, use the most recent
      if (!global.latestPlayerCount && dataStore.players.raw.length > 0) {
        global.latestPlayerCount = dataStore.players.raw[dataStore.players.raw.length - 1].value;
      }
      
      console.log(`Loaded ${dataStore.players.raw.length} player count entries from file`);
    }
    
    // Load Victories data
    if (fs.existsSync(victoriesDataFile)) {
      const victoriesData = JSON.parse(await fs.readFile(victoriesDataFile, 'utf8'));
      dataStore.victories.nato = victoriesData.nato || 0;
      dataStore.victories.russia = victoriesData.russia || 0;
      dataStore.victories.total = victoriesData.total || 0;
      dataStore.victories.lastVictory = victoriesData.lastVictory || null;
      dataStore.victories.firstVictory = victoriesData.firstVictory || null;
      dataStore.victories.history = victoriesData.history || [];
      console.log(`Loaded victories: NATO: ${dataStore.victories.nato}, RUSSIA: ${dataStore.victories.russia}, Total: ${dataStore.victories.total}`);
    }
    
    console.log('Data loaded from JSON files successfully');
  } catch (error) {
    console.error('Error loading data from files:', error);
  }
}

// Save uptime data
async function saveUptimeData() {
  try {
    const uptimeData = {
      serverStartTime: dataStore.uptime.serverStartTime ? dataStore.uptime.serverStartTime.toISOString() : null,
      lastChecked: dataStore.uptime.lastChecked ? dataStore.uptime.lastChecked.toISOString() : null,
      lastUpdated: new Date().toISOString()
    };
    
    await fs.writeFile(uptimeDataFile, JSON.stringify(uptimeData, null, 2));
    console.log('Uptime data saved successfully');
  } catch (error) {
    console.error('Error saving uptime data:', error);
  }
}

// Load uptime data
async function loadUptimeData() {
  try {
    if (fs.existsSync(uptimeDataFile)) {
      const uptimeData = JSON.parse(await fs.readFile(uptimeDataFile, 'utf8'));
      dataStore.uptime.serverStartTime = uptimeData.serverStartTime ? new Date(uptimeData.serverStartTime) : null;
      dataStore.uptime.lastChecked = uptimeData.lastChecked ? new Date(uptimeData.lastChecked) : null;
      console.log('Uptime data loaded successfully');
      if (dataStore.uptime.serverStartTime) {
        console.log(`Server start time: ${dataStore.uptime.serverStartTime.toISOString()}`);
      }
    }
  } catch (error) {
    console.error('Error loading uptime data:', error);
  }
}

// Generate sample victory data for testing (optional)
async function generateSampleVictoryData() {
  if (!config.generateSampleVictoryData) return;
  
  console.log('Generating sample victory data...');
  
  // Generate some sample victories over the past week
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  
  for (let i = 0; i < 20; i++) {
    const randomTime = new Date(oneWeekAgo.getTime() + Math.random() * (now.getTime() - oneWeekAgo.getTime()));
    const faction = Math.random() > 0.5 ? 'NATO' : 'RUSSIA';
    await storeVictoryData(faction, randomTime);
  }
  
  console.log('Sample victory data generated');
}

// Start monitoring function
async function startMonitoring() {
  let logFilePath;
  
  if (config.logSource && config.logSource.type === 'remote') {
    // For remote logs, use the remote path directly
    logFilePath = config.logSource.remote.remotePath;
    console.log(`Monitoring remote log: ${logFilePath}`);
  } else {
    // For local logs, find the latest directory
    const logDir = config.logSource?.localPath || config.logDir;
    const latestDir = await findLatestDirectory(logDir);
    
    if (!latestDir) {
      console.log('No log directory found. Will check again in the next interval.');
      return;
    }
    
    console.log(`Monitoring the latest directory: ${latestDir.name}`);
    logFilePath = path.join(latestDir.path, config.logFileName);
    
    // Log the server start time for debugging
    if (dataStore.uptime.serverStartTime) {
      const now = new Date();
      const uptimeMs = now.getTime() - dataStore.uptime.serverStartTime.getTime();
      const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
      const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
      console.log(`Current server uptime: ${uptimeHours}h ${uptimeMinutes}m (since ${dataStore.uptime.serverStartTime.toISOString()})`);
    }
  }
  
  // Run crash monitoring if enabled
  if (config.crashMonitor && config.crashMonitor.enabled && crashMonitorState) {
    await monitorForCrashes(logFilePath);
  }
  
  const values = await getLatestValues(logFilePath, remoteLogFetcher);
  
  if (values.fps !== null) {
    console.log(`Latest FPS: ${values.fps}`);
  }
  
  if (values.playerCount !== null) {
    console.log(`Latest Player Count: ${values.playerCount}`);
  }
  
  // Save data immediately after each update
  await saveDataToFiles();
}

// Get log file content from local or remote source
async function getLogFileContent(logFilePath, remoteLogFetcher) {
  try {
    if (config.logSource && config.logSource.type === 'remote' && remoteLogFetcher) {
      // Use remote log fetcher
      console.log(`[REMOTE LOG] Fetching log from remote source...`);
      const content = await remoteLogFetcher.getLogContent(config.logSource.remote.remotePath);
      return content;
    } else {
      // Use local file system
      if (!fs.existsSync(logFilePath)) {
        console.log(`Log file does not exist: ${logFilePath}`);
        return null;
      }
      return await fs.readFile(logFilePath, 'utf8');
    }
  } catch (error) {
    console.error('Error getting log file content:', error);
    return null;
  }
}

// Crash Monitor Functions
async function logIncident(incidentType, keyword = null, processUptime = null, additionalInfo = null) {
  if (!crashMonitorState) return;
  
  const timestamp = new Date();
  const formattedTimestamp = formatTimestamp(timestamp);

  const incidentTypeString = {
    'Startup': 'Server startup initiated',
    'Crash': 'Server crash detected, keyword has been found in recent logs',
    'Shutdown': 'Server shutdown detected',
    'Restart': 'Server restart attempted'
  }[incidentType] || 'Unknown incident';

  let incidentData = [];

  // Read existing log data
  if (fs.existsSync(crashMonitorState.incidentLogPath)) {
    try {
      const fileContent = fs.readFileSync(crashMonitorState.incidentLogPath, 'utf8');
      if (fileContent.trim()) {
        const parsedData = JSON.parse(fileContent);
        incidentData = Array.isArray(parsedData) ? parsedData : [parsedData];
      }
    } catch (error) {
      log(`Warning: Error reading incident log: ${error.message}`, 'yellow');
    }
  }

  // Calculate next ID
  let nextId = 1;
  if (incidentData.length > 0) {
    const maxId = Math.max(...incidentData.map(item => parseInt(item['Incident ID']) || 0));
    nextId = maxId + 1;
  }

  // Create log entry
  const logEntry = {
    'Incident ID': nextId.toString(),
    'Incident Timestamp': formattedTimestamp,
    'Incident Type': incidentTypeString
  };

  if (keyword) logEntry.Keyword = keyword;
  if (processUptime) {
    const days = Math.floor(processUptime / 86400);
    const hours = Math.floor((processUptime % 86400) / 3600);
    const minutes = Math.floor((processUptime % 3600) / 60);
    const seconds = Math.floor(processUptime % 60);
    logEntry.Uptime = `${days}d ${hours.toString().padStart(2, '0')}h:${minutes.toString().padStart(2, '0')}m:${seconds.toString().padStart(2, '0')}s`;
  }
  if (additionalInfo) logEntry.AdditionalInfo = additionalInfo;

  incidentData.push(logEntry);

  try {
    fs.writeFileSync(crashMonitorState.incidentLogPath, JSON.stringify(incidentData, null, 2));
    log(`[${formattedTimestamp}] Logged incident: '${incidentTypeString}' (ID: ${nextId})`, 'gray');
    if (incidentType === 'Crash' && keyword) {
      log(`  -> Keyword: '${keyword}'`, 'gray');
    }
    if (incidentType === 'Restart' && additionalInfo) {
      log(`  -> Info: '${additionalInfo}'`, 'gray');
    }
  } catch (error) {
    log(`Error: Failed to write incident log: ${error.message}`, 'red');
  }
}

function findServerProcess() {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq ArmaReforgerServer.exe" /FO CSV', (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }

      const lines = stdout.split('\n');
      if (lines.length > 1) {
        const processLine = lines[1];
        const match = processLine.match(/"ArmaReforger\.exe","(\d+)"/);
        if (match) {
          resolve({
            pid: parseInt(match[1]),
            startTime: new Date() // Approximation - we can't get exact start time easily
          });
          return;
        }
      }
      resolve(null);
    });
  });
}

async function startServerProcess(reason = "Manual") {
  if (!crashMonitorState) return null;
  
  log(`[${formatTimestamp()}] Attempting to start server process... (Reason: ${reason})`, 'cyan');

  try {
    if (!fs.existsSync(config.crashMonitor.serverExePath)) {
      log(`Error: Server executable not found at: ${config.crashMonitor.serverExePath}`, 'red');
      return null;
    }

    const serverProcess = spawn(config.crashMonitor.serverExePath, [], {
      cwd: config.crashMonitor.serverWorkingDir,
      detached: true,
      stdio: 'ignore'
    });

    if (serverProcess.pid) {
      log(`Server process started successfully. PID: ${serverProcess.pid}`, 'green');

      // Write PID to file
      try {
        fs.writeFileSync(crashMonitorState.pidFilePath, serverProcess.pid.toString());
        log(`PID ${serverProcess.pid} written to ${crashMonitorState.pidFilePath}`, 'gray');
      } catch (error) {
        log(`Warning: Failed to write PID file: ${error.message}`, 'yellow');
      }

      // Log the startup
      await logIncident('Startup', null, null, `Started via script - ${reason}`);

      return {
        pid: serverProcess.pid,
        startTime: new Date(),
        process: serverProcess
      };
    } else {
      log('Error: Failed to start server process - no PID returned', 'red');
      return null;
    }
  } catch (error) {
    log(`Error: Failed to start server process: ${error.message}`, 'red');
    return null;
  }
}

async function restartServerAfterCrash(crashKeyword) {
  if (!crashMonitorState) return false;
  
  const currentTime = new Date();

  // Check if auto-restart is enabled
  if (!config.crashMonitor.enableAutoRestart) {
    log('Auto-restart is disabled. Server will not be restarted automatically.', 'yellow');
    return false;
  }

  // Check restart attempts limit
  if (config.crashMonitor.maxRestartAttempts > 0 && crashMonitorState.restartAttempts >= config.crashMonitor.maxRestartAttempts) {
    log(`Warning: Maximum restart attempts (${config.crashMonitor.maxRestartAttempts}) reached. Auto-restart disabled for this session.`, 'yellow');
    log('To restart the server, either restart this script or manually start the server.', 'yellow');
    return false;
  }

  // Check cooldown period
  const timeSinceLastRestart = (currentTime - crashMonitorState.lastRestartTime) / 1000 / 60; // minutes
  if (crashMonitorState.lastRestartTime.getTime() > 0 && timeSinceLastRestart < config.crashMonitor.restartCooldownMinutes) {
    const remainingCooldown = (config.crashMonitor.restartCooldownMinutes - timeSinceLastRestart).toFixed(1);
    log(`Warning: Restart cooldown active. ${remainingCooldown} minutes remaining before next restart attempt.`, 'yellow');
    return false;
  }

  // Increment restart attempts
  crashMonitorState.restartAttempts++;
  crashMonitorState.lastRestartTime = currentTime;

  log(`Crash detected with keyword: '${crashKeyword}'`, 'red');
  log(`Auto-restart is enabled. Waiting ${config.crashMonitor.restartDelaySeconds} seconds before restart attempt ${crashMonitorState.restartAttempts}...`, 'yellow');

  // Wait before restart
  await new Promise(resolve => setTimeout(resolve, config.crashMonitor.restartDelaySeconds * 1000));

  // Attempt to restart
  const newProcess = await startServerProcess(`Auto-restart after crash (Keyword: ${crashKeyword})`);

  if (newProcess) {
    log('Server restarted successfully after crash!', 'green');
    await logIncident('Restart', null, null, `Auto-restart successful after crash (Keyword: ${crashKeyword}, Attempt: ${crashMonitorState.restartAttempts})`);
    return newProcess;
  } else {
    log('Error: Failed to restart server after crash!', 'red');
    await logIncident('Restart', null, null, `Auto-restart FAILED after crash (Keyword: ${crashKeyword}, Attempt: ${crashMonitorState.restartAttempts})`);
    return false;
  }
}

function getCurrentServerDataLogPath(logDirectoryPath) {
  const today = new Date();
  const todayDateStr = today.toLocaleDateString('en-GB').replace(/\//g, '.');
  const baseFileName = `server_data-${todayDateStr}`;

  let maxId = 0;
  if (fs.existsSync(logDirectoryPath)) {
    const files = fs.readdirSync(logDirectoryPath);
    const pattern = new RegExp(`${baseFileName}_ID-(\\d+)\\.txt$`);
    
    files.forEach(file => {
      const match = file.match(pattern);
      if (match) {
        const currentId = parseInt(match[1]);
        if (currentId > maxId) {
          maxId = currentId;
        }
      }
    });
  }

  const nextId = maxId + 1;
  const newFileName = `${baseFileName}_ID-${nextId}.txt`;
  return path.join(logDirectoryPath, newFileName);
}

function writeStatsLog(targetPath, fps, players) {
  const timestamp = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const logLine = `[${timestamp}] Server FPS: ${fps} | Players: ${players}\n`;

  try {
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    fs.appendFileSync(targetPath, logLine);
  } catch (error) {
    log(`Warning: Failed to write to server data log '${targetPath}': ${error.message}`, 'yellow');
  }
}

// Crash monitoring function
async function monitorForCrashes(logFilePath) {
  if (!crashMonitorState) return;
  
  const currentTime = new Date();

  // Determine/Update Current Server Data Log File
  if (!crashMonitorState.currentServerDataLogPath || currentTime >= crashMonitorState.nextServerDataLogCreationTime) {
    const previousLogPath = crashMonitorState.currentServerDataLogPath;
    const fullServerDataLogPath = path.join(config.crashMonitor.serverWorkingDir, config.crashMonitor.serverDataLogFolder);
    
    if (!fs.existsSync(fullServerDataLogPath)) {
      fs.mkdirSync(fullServerDataLogPath, { recursive: true });
    }
    
    crashMonitorState.currentServerDataLogPath = getCurrentServerDataLogPath(fullServerDataLogPath);

    if (crashMonitorState.currentServerDataLogPath !== previousLogPath) {
      log(`[${formatTimestamp(currentTime)}] Using new server data log file: '${path.basename(crashMonitorState.currentServerDataLogPath)}'`, 'cyan');
      crashMonitorState.nextServerDataLogCreationTime = new Date(currentTime.getTime() + (config.crashMonitor.serverDataLogIntervalHours * 60 * 60 * 1000));
      log(`  -> Next new log file scheduled around: ${formatTimestamp(crashMonitorState.nextServerDataLogCreationTime)}`, 'gray');
    }
  }

  // Check for Server Process if not already tracking one
  if (!crashMonitorState.serverProcess) {
    const foundProcess = await findServerProcess();
    if (foundProcess) {
      crashMonitorState.serverProcess = foundProcess;
      log(`Found ArmaReforgerServer process with ID: ${foundProcess.pid}`, 'green');

      // Write PID to file
      try {
        fs.writeFileSync(crashMonitorState.pidFilePath, foundProcess.pid.toString());
      } catch (error) {
        log(`Warning: Failed to write PID file: ${error.message}`, 'yellow');
      }
    }
  }

  // Check Server Process Status
  if (crashMonitorState.serverProcess) {
    try {
      // Check if process still exists
      process.kill(crashMonitorState.serverProcess.pid, 0); // This throws if process doesn't exist
      
      // Get memory usage (Windows specific)
      exec(`tasklist /FI "PID eq ${crashMonitorState.serverProcess.pid}" /FO CSV`, (error, stdout) => {
        if (!error) {
          const lines = stdout.split('\n');
          if (lines.length > 1) {
            const match = lines[1].match(/"[^"]*","[^"]*","[^"]*","[^"]*","([^"]*) K"/);
            if (match) {
              crashMonitorState.memUsageMB = Math.round(parseInt(match[1].replace(/,/g, '')) / 1024);
            }
          }
        }
      });

      // Calculate uptime
      const uptimeSeconds = (currentTime - crashMonitorState.serverProcess.startTime) / 1000;
      crashMonitorState.formattedUptime = formatUptimeFromSeconds(uptimeSeconds);
    } catch (error) {
      log(`Warning: Server process (Last Known PID: ${crashMonitorState.serverProcess.pid}) not found.`, 'yellow');
      crashMonitorState.serverProcess = null;
      crashMonitorState.memUsageMB = "N/A";
      crashMonitorState.formattedUptime = "N/A";

      // Clean up PID file
      if (fs.existsSync(crashMonitorState.pidFilePath)) {
        fs.unlinkSync(crashMonitorState.pidFilePath);
      }
    }
  }

  let currentFps = crashMonitorState.lastFpsValue;
  let currentPlayerCount = crashMonitorState.lastPlayerCount;
  let statusMessage = crashMonitorState.serverProcess ? "Running" : "No Server";
  // Process log files for crash detection and stats
  try {
    const logContent = await getLogFileContent(logFilePath, remoteLogFetcher);
    if (logContent) {
      const logLines = logContent.split('\n').slice(-100); // Last 100 lines      // Crash Detection
      let crashDetected = false;
      let detectedKeyword = null;

      for (const keyword of config.crashMonitor.crashKeywords) {
        if (logLines.some(line => line.includes(keyword))) {
          log(`CRASH DETECTED! Keyword found: '${keyword}' in recent logs.`, 'yellow');
          log(`Server has crashed, crash related words '${keyword}' have been found. Terminating server process.`, 'red');
          process.title = "Arma Reforger Server | Status: CRASHED!";

          // Calculate uptime before logging
          let crashUptime = null;
          if (crashMonitorState.serverProcess && crashMonitorState.serverProcess.startTime) {
            crashUptime = (currentTime - crashMonitorState.serverProcess.startTime) / 1000;
          }

          await logIncident('Crash', keyword, crashUptime);

          // Terminate the process
          if (crashMonitorState.serverProcess) {
            log(`Attempting to terminate crashed process (PID: ${crashMonitorState.serverProcess.pid})...`, 'yellow');
            try {
              process.kill(crashMonitorState.serverProcess.pid, 'SIGTERM');
            } catch (killError) {
              log(`Warning: Could not terminate process: ${killError.message}`, 'yellow');
            }
            crashMonitorState.serverProcess = null;
          }

          // Clean up PID file
          if (fs.existsSync(crashMonitorState.pidFilePath)) {
            fs.unlinkSync(crashMonitorState.pidFilePath);
          }

          // Rename the problematic log file
          try {
            const crashedLogName = `console_crashed_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
            const newPath = path.join(path.dirname(logFilePath), crashedLogName);
            fs.renameSync(logFilePath, newPath);
            log(`Renamed problematic log file to '${crashedLogName}'.`, 'cyan');
          } catch (renameError) {
            log(`Warning: Failed to rename crashed log file: ${renameError.message}`, 'yellow');
          }

          log('Server process terminated due to crash detection.', 'yellow');
          crashDetected = true;
          detectedKeyword = keyword;
          break;        }
      }
      
      // Handle restart if crash was detected
      if (crashDetected) {
        const restartResult = await restartServerAfterCrash(detectedKeyword);
        if (restartResult && restartResult !== false) {
          crashMonitorState.serverProcess = restartResult;
          log('Server restarted successfully. Continuing monitoring...', 'green');
        } else {
          log('Server not restarted. Script will continue monitoring for manual restart.', 'yellow');
        }
        return; // Skip the rest of this iteration
      }

      // Regular Log Parsing (FPS, Players, Victories) - always parse logs when available  
      const fpsPattern = /DEFAULT\s+:\s+FPS:\s+([\d.]+).*?Player:\s+(\d+)/;
      const matchDurationPattern = /Match Duration:\s*(.+?)(?:\s*\||$)/i;
      const baseCapturedPattern = /Base Captured:\s*(\d+)/i;
      const playersKilledPattern = /Total Players Killed.*?:\s*(\d+)/i;
      const lastWinnerPattern = /ServerAdminTools.*serveradmintools_game_ended.*winner:\s*(NATO|RUSSIA)/i;
      
      let lastMatch = null;

      // Parse FPS and player count
      for (const line of logLines.reverse()) {
        const match = line.match(fpsPattern);
        if (match) {
          lastMatch = match;
          break;
        }
      }

      // Parse additional stats from recent log entries
      const recentLines = logLines.slice(-100); // Check last 100 lines for stats
      for (const line of recentLines) {
        const matchDurationMatch = line.match(matchDurationPattern);
        const baseCapturedMatch = line.match(baseCapturedPattern);
        const playersKilledMatch = line.match(playersKilledPattern);
        const lastWinnerMatch = line.match(lastWinnerPattern);
        
        if (matchDurationMatch) {
          crashMonitorState.lastMatchDuration = matchDurationMatch[1].trim();
        }
        if (baseCapturedMatch) {
          crashMonitorState.lastBaseCaptured = baseCapturedMatch[1];
        }
        if (playersKilledMatch) {
          crashMonitorState.lastTotalPlayersKilled = playersKilledMatch[1];
        }
        if (lastWinnerMatch) {
          crashMonitorState.lastRoundWinner = lastWinnerMatch[1];
          console.log(`[VICTORY DETECTED] ${lastWinnerMatch[1]} won the round!`);
          
          // Store victory data
          await storeVictoryData(lastWinnerMatch[1].toUpperCase());
        }
      }      if (lastMatch) {
        currentFps = lastMatch[1];
        currentPlayerCount = lastMatch[2];
        const timestampStr = formatTimestamp(currentTime);
        console.log(`[CRASH MONITOR] Server FPS: ${currentFps} | Players: ${currentPlayerCount}`);
        crashMonitorState.lastFpsValue = currentFps;
        crashMonitorState.lastPlayerCount = currentPlayerCount;
        statusMessage = "OK";

        // Check if it's time to log stats
        if ((currentTime - crashMonitorState.lastStatsLogTime) / 1000 >= config.crashMonitor.statsLogIntervalSec) {
          if (crashMonitorState.currentServerDataLogPath) {
            writeStatsLog(crashMonitorState.currentServerDataLogPath, currentFps, currentPlayerCount);
            crashMonitorState.lastStatsLogTime = currentTime;
          }        }
      }
    }
  } catch (error) {
    statusMessage = `LogReadErr: ${error.message.split('\n')[0]}`;
    log(`Warning: Error during crash monitor log processing: ${statusMessage}`, 'yellow');
  }

  // Update window title if crash monitor is managing the process
  if (crashMonitorState.serverProcess) {
    const restartInfo = config.crashMonitor.enableAutoRestart ? " | AutoRestart: ON" : " | AutoRestart: OFF";
    process.title = `Arma Reforger Server | FPS: ${currentFps} | Players: ${currentPlayerCount} | Uptime: ${crashMonitorState.formattedUptime} | Mem: ${crashMonitorState.memUsageMB}MB | PID: ${crashMonitorState.serverProcess.pid}${restartInfo}`;
  } else {
    const restartInfo = config.crashMonitor.enableAutoRestart ? " | AutoRestart: ON" : " | AutoRestart: OFF";
    process.title = `Arma Reforger Server | Status: No Server Running | Last FPS: ${crashMonitorState.lastFpsValue} | Last Players: ${crashMonitorState.lastPlayerCount}${restartInfo}`;
  }
}

// Server Stats Provider for Discord Bot
class ServerStatsProvider {
  getCurrentStats() {
    return {
      fps: global.latestFPS,
      players: global.latestPlayerCount,
      uptime: this.getUptimeMs(),
      matchDuration: this.getLatestMatchDuration(),
      baseCaptured: this.getLatestBaseCaptured(),
      totalPlayersKilled: this.getLatestTotalPlayersKilled(),
      lastRoundWinner: this.getLatestLastRoundWinner()
    };
  }

  getVictories() {
    return {
      nato: dataStore.victories.nato,
      russia: dataStore.victories.russia,
      total: dataStore.victories.total
    };
  }

  getUptimeMs() {
    if (!dataStore.uptime.serverStartTime) {
      return 0;
    }
    return Date.now() - new Date(dataStore.uptime.serverStartTime).getTime();
  }

  getLatestMatchDuration() {
    if (crashMonitorState && crashMonitorState.lastMatchDuration) {
      return crashMonitorState.lastMatchDuration;
    }
    return 'N/A';
  }

  getLatestBaseCaptured() {
    if (crashMonitorState && crashMonitorState.lastBaseCaptured) {
      return crashMonitorState.lastBaseCaptured;
    }
    return 'N/A';
  }

  getLatestTotalPlayersKilled() {
    if (crashMonitorState && crashMonitorState.lastTotalPlayersKilled) {
      return crashMonitorState.lastTotalPlayersKilled;
    }
    return 'N/A';
  }  getLatestLastRoundWinner() {
    // First check if we have log-based data (and it's not "N/A")
    if (crashMonitorState && crashMonitorState.lastRoundWinner && crashMonitorState.lastRoundWinner !== 'N/A') {
      return crashMonitorState.lastRoundWinner;
    }
    
    // Fallback to victories data from JSON file
    if (dataStore.victories.lastVictory && dataStore.victories.lastVictory.faction) {
      return dataStore.victories.lastVictory.faction;
    }
    
    return 'N/A';
  }
}

const serverStats = new ServerStatsProvider();
let discordBot = null;

// API endpoint for getting the latest FPS data
app.get('/api/fps', (req, res) => {
  const timeframe = req.query.timeframe || 'raw'; // Default to raw data
  const limit = parseInt(req.query.limit, 10) || 10; // Default to 10 items
  
  let data = [];
  let labels = [];
  
  switch(timeframe) {    case 'hourly':
      data = Object.values(dataStore.fps.hourly)
        .sort((a, b) => moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf())
        .slice(-limit);
      labels = data.map(d => moment(d.timestamp).format('HH:mm'));
      break;
    case 'daily':
      data = Object.values(dataStore.fps.daily)
        .sort((a, b) => moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf())
        .slice(-limit);
      labels = data.map(d => moment(d.timestamp).format('MM-DD'));
      break;
    case 'weekly':
      data = Object.values(dataStore.fps.weekly)
        .sort((a, b) => moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf())
        .slice(-limit);
      labels = data.map(d => moment(d.timestamp).format('MM-DD'));
      break;
    case 'monthly':
      data = Object.values(dataStore.fps.monthly)
        .sort((a, b) => moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf())
        .slice(-limit);
      labels = data.map(d => moment(d.timestamp).format('YYYY-MM'));
      break;
    case 'raw':
    default:
      data = dataStore.fps.raw.slice(-limit);
      labels = data.map(d => moment(d.timestamp).format('HH:mm:ss'));
      break;
  }
  
  let values = [];
  let minValues = [];
  let maxValues = [];
  
  if (timeframe === 'raw') {
    values = data.map(d => d.value);
  } else {
    values = data.map(d => d.average);
    minValues = data.map(d => d.min);
    maxValues = data.map(d => d.max);
  }
  
  const response = {
    timeframe: timeframe,
    latest: global.latestFPS,
    data: values,
    labels: labels,
    count: data.length,
    lastUpdated: data.length > 0 ? data[data.length - 1].timestamp : null
  };
  
  // Add min/max values for aggregated data
  if (timeframe !== 'raw') {
    response.minValues = minValues;
    response.maxValues = maxValues;
  }
  
  res.json(response);
});

// API endpoint for getting the latest player data
app.get('/api/players', (req, res) => {
  const timeframe = req.query.timeframe || 'raw';
  const limit = parseInt(req.query.limit, 10) || 10;
  
  let data = [];
  let labels = [];
  
  switch(timeframe) {    case 'hourly':
      data = Object.values(dataStore.players.hourly)
        .sort((a, b) => moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf())
        .slice(-limit);
      labels = data.map(d => moment(d.timestamp).format('HH:mm'));
      break;
    case 'daily':
      data = Object.values(dataStore.players.daily)
        .sort((a, b) => moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf())
        .slice(-limit);
      labels = data.map(d => moment(d.timestamp).format('MM-DD'));
      break;
    case 'weekly':
      data = Object.values(dataStore.players.weekly)
        .sort((a, b) => moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf())
        .slice(-limit);
      labels = data.map(d => moment(d.timestamp).format('MM-DD'));
      break;
    case 'monthly':
      data = Object.values(dataStore.players.monthly)
        .sort((a, b) => moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf())
        .slice(-limit);
      labels = data.map(d => moment(d.timestamp).format('YYYY-MM'));
      break;
    case 'raw':
    default:
      data = dataStore.players.raw.slice(-limit);
      labels = data.map(d => moment(d.timestamp).format('HH:mm:ss'));
      break;
  }
  
  let values = [];
  let minValues = [];
  let maxValues = [];
  
  if (timeframe === 'raw') {
    values = data.map(d => d.value);
  } else {
    values = data.map(d => d.average);
    minValues = data.map(d => d.min);
    maxValues = data.map(d => d.max);
  }
    const response = {
    timeframe: timeframe,
    latest: global.latestPlayerCount,
    data: values,
    labels: labels,
    count: data.length,
    lastUpdated: data.length > 0 ? data[data.length - 1].timestamp : null
  };
  
  if (timeframe !== 'raw') {
    response.minValues = minValues;
    response.maxValues = maxValues;
  }
  
  res.json(response);
});

// API endpoint for getting victory data
app.get('/api/victories', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50; // Default to last 50 victories
  
  const response = {
    totals: {
      nato: dataStore.victories.nato,
      russia: dataStore.victories.russia,
      total: dataStore.victories.total
    },
    lastVictory: dataStore.victories.lastVictory,
    firstVictory: dataStore.victories.firstVictory,
    history: dataStore.victories.history
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit),
    historyCount: dataStore.victories.history.length
  };
  
  res.json(response);
});

// API endpoint for getting server uptime (FIXED)
app.get('/api/uptime', (req, res) => {
  const now = new Date();
  dataStore.uptime.lastChecked = now;
  
  // If we don't have a server start time yet, try to find it
  if (!dataStore.uptime.serverStartTime) {
    return res.json({
      status: 'detecting',
      message: 'Server start time is being detected from log directories...',
      uptime: {
        seconds: 0,
        minutes: 0,
        hours: 0,
        days: 0,
        totalSeconds: 0,
        totalMinutes: 0,
        totalHours: 0,
        totalDays: 0
      },
      startTime: null,
      currentTime: now.toISOString(),
      note: 'Uptime will be available once log directory is detected'
    });
  }
  
  // Calculate uptime in milliseconds from the log directory creation time
  const uptimeMs = now.getTime() - dataStore.uptime.serverStartTime.getTime();
  
  // Handle negative uptime (shouldn't happen, but just in case)
  if (uptimeMs < 0) {
    return res.json({
      status: 'error',
      message: 'Invalid server start time detected',
      uptime: {
        seconds: 0,
        minutes: 0,
        hours: 0,
        days: 0,
        totalSeconds: 0,
        totalMinutes: 0,
        totalHours: 0,
        totalDays: 0
      },
      startTime: dataStore.uptime.serverStartTime.toISOString(),
      currentTime: now.toISOString()
    });
  }
  
  // Convert to seconds
  const totalSeconds = Math.floor(uptimeMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);
  
  // Calculate remaining time components
  const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);
  
  const response = {
    status: 'active',
    uptime: {
      seconds: seconds,
      minutes: minutes,
      hours: hours,
      days: days,
      totalSeconds: totalSeconds,
      totalMinutes: totalMinutes,
      totalHours: totalHours,
      totalDays: totalDays,
      formatted: `${days}d ${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`
    },
    startTime: dataStore.uptime.serverStartTime.toISOString(),
    currentTime: now.toISOString(),
    lastChecked: now.toISOString()
  };
  
  res.json(response);
});

// API endpoint for crash monitor status
app.get('/api/crash-monitor/status', (req, res) => {
  if (!config.crashMonitor || !config.crashMonitor.enabled || !crashMonitorState) {
    return res.json({
      enabled: false,
      message: 'Crash monitor is disabled'
    });
  }

  const currentTime = new Date();
  let serverUptime = null;
  
  if (crashMonitorState.serverProcess && crashMonitorState.serverProcess.startTime) {
    const uptimeMs = currentTime.getTime() - crashMonitorState.serverProcess.startTime.getTime();
    serverUptime = Math.floor(uptimeMs / 1000);
  }

  res.json({
    enabled: true,
    serverProcess: crashMonitorState.serverProcess ? {
      pid: crashMonitorState.serverProcess.pid,
      startTime: crashMonitorState.serverProcess.startTime,
      uptime: serverUptime,
      formattedUptime: crashMonitorState.formattedUptime
    } : null,
    lastFps: crashMonitorState.lastFpsValue,
    lastPlayerCount: crashMonitorState.lastPlayerCount,
    memoryUsageMB: crashMonitorState.memUsageMB,
    autoRestart: config.crashMonitor.enableAutoRestart,
    restartAttempts: crashMonitorState.restartAttempts,
    lastRestartTime: crashMonitorState.lastRestartTime,
    restartCooldownMinutes: config.crashMonitor.restartCooldownMinutes,
    maxRestartAttempts: config.crashMonitor.maxRestartAttempts
  });
});

// API endpoint for incident log
app.get('/api/crash-monitor/incidents', (req, res) => {
  if (!config.crashMonitor || !config.crashMonitor.enabled || !crashMonitorState) {
    return res.json([]);
  }

  try {
    if (fs.existsSync(crashMonitorState.incidentLogPath)) {
      const fileContent = fs.readFileSync(crashMonitorState.incidentLogPath, 'utf8');
      if (fileContent.trim()) {
        const parsedData = JSON.parse(fileContent);
        const incidentData = Array.isArray(parsedData) ? parsedData : [parsedData];
        
        // Return incidents sorted by ID (most recent first)
        const sortedIncidents = incidentData.sort((a, b) => 
          parseInt(b['Incident ID']) - parseInt(a['Incident ID'])
        );
        
        const limit = parseInt(req.query.limit, 10) || 50;
        res.json(sortedIncidents.slice(0, limit));
      } else {
        res.json([]);
      }
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Error reading incident log:', error);
    res.status(500).json({ error: 'Failed to read incident log' });
  }
});

// API endpoint for crash data (formatted for frontend)
app.get('/api/crashes', (req, res) => {
  if (!config.crashMonitor || !config.crashMonitor.enabled || !crashMonitorState) {
    return res.json({
      totalCrashes: 0,
      lastCrash: null,
      averageUptime: null,
      crashHistory: []
    });
  }

  try {
    let incidents = [];
    if (fs.existsSync(crashMonitorState.incidentLogPath)) {
      const fileContent = fs.readFileSync(crashMonitorState.incidentLogPath, 'utf8');
      if (fileContent.trim()) {
        const parsedData = JSON.parse(fileContent);
        incidents = Array.isArray(parsedData) ? parsedData : [parsedData];
      }
    }

    // Sort incidents by ID (most recent first)
    const sortedIncidents = incidents.sort((a, b) => 
      parseInt(b['Incident ID']) - parseInt(a['Incident ID'])
    );

    // Calculate total crashes
    const totalCrashes = sortedIncidents.length;

    // Get last crash
    const lastCrash = sortedIncidents.length > 0 ? {
      timestamp: sortedIncidents[0]['Crash Time'],
      duration: sortedIncidents[0]['Server Uptime'],
      incidentId: sortedIncidents[0]['Incident ID']
    } : null;

    // Calculate average uptime (simplified calculation)
    let averageUptime = null;
    if (sortedIncidents.length > 0) {
      const uptimes = sortedIncidents
        .map(incident => {
          const uptimeStr = incident['Server Uptime'];
          if (uptimeStr && uptimeStr.includes(':')) {
            const parts = uptimeStr.split(':');
            if (parts.length === 3) {
              const hours = parseInt(parts[0]) || 0;
              const minutes = parseInt(parts[1]) || 0;
              const seconds = parseInt(parts[2]) || 0;
              return hours + (minutes / 60) + (seconds / 3600);
            }
          }
          return 0;
        })
        .filter(uptime => uptime > 0);
      
      if (uptimes.length > 0) {
        const avgHours = uptimes.reduce((sum, uptime) => sum + uptime, 0) / uptimes.length;
        averageUptime = avgHours.toFixed(1);
      }
    }    // Format crash history for frontend (using original incident.json field names)
    const crashHistory = sortedIncidents.slice(0, 20).map(incident => ({
      incidentId: incident['Incident ID'],
      incidentTimestamp: incident['Incident Timestamp'],
      incidentType: incident['Incident Type'],
      keyword: incident['Keyword'],
      uptime: incident['Uptime'],
      // Keep legacy fields for compatibility
      timestamp: incident['Crash Time'] || incident['Incident Timestamp'],
      duration: incident['Server Uptime'] || incident['Uptime'],
      fps: incident['Last FPS'],
      playerCount: incident['Last Player Count'],
      memoryUsage: incident['Memory Usage (MB)']
    }));

    res.json({
      totalCrashes,
      lastCrash,
      averageUptime,
      crashHistory
    });

  } catch (error) {
    console.error('Error processing crash data:', error);
    res.status(500).json({ 
      error: 'Failed to process crash data',
      totalCrashes: 0,
      lastCrash: null,
      averageUptime: null,
      crashHistory: []
    });
  }
});

// Start the server
app.listen(config.port, async () => {
  console.log(`FPS Monitor API server running on port ${config.port}`);
  console.log(`Configuration: ${JSON.stringify(config, null, 2)}`);
  
  // Initialize crash monitor if enabled
  if (config.crashMonitor && config.crashMonitor.enabled && crashMonitorState) {
    console.log('Initializing crash monitor...');
    
    // Set up paths
    crashMonitorState.incidentLogPath = path.join(config.crashMonitor.serverWorkingDir, 'incident.json');
    crashMonitorState.pidFilePath = path.join(config.crashMonitor.serverWorkingDir, 'server.pid');

    // Display crash monitor configuration
    log('=== Crash Monitor Configuration ===', 'cyan');
    log(`Auto-restart after crash: ${config.crashMonitor.enableAutoRestart}`, config.crashMonitor.enableAutoRestart ? 'green' : 'red');
    if (config.crashMonitor.enableAutoRestart) {
      log(`Restart delay: ${config.crashMonitor.restartDelaySeconds} seconds`, 'gray');
      log(`Max restart attempts: ${config.crashMonitor.maxRestartAttempts === 0 ? 'Unlimited' : config.crashMonitor.maxRestartAttempts}`, 'gray');
      log(`Restart cooldown: ${config.crashMonitor.restartCooldownMinutes} minutes`, 'gray');
    }
    log('=================================', 'cyan');

    // Create server data log directory
    const fullServerDataLogPath = path.join(config.crashMonitor.serverWorkingDir, config.crashMonitor.serverDataLogFolder);
    if (!fs.existsSync(fullServerDataLogPath)) {
      try {
        log(`Creating server data log directory: '${fullServerDataLogPath}'`, 'cyan');
        fs.mkdirSync(fullServerDataLogPath, { recursive: true });
      } catch (error) {
        log(`FATAL: Could not create server data log directory '${fullServerDataLogPath}'. Error: ${error.message}`, 'red');
      }
    } else {
      log(`Server data log directory found: '${fullServerDataLogPath}'`, 'gray');
    }

    // Check for existing server processes
    log('Checking for existing ArmaReforgerServer processes...', 'yellow');
    const existingServer = await findServerProcess();
    if (existingServer) {
      log(`Found existing ArmaReforgerServer process with ID: ${existingServer.pid}`, 'green');
      crashMonitorState.serverProcess = existingServer;

      // Write PID to file if it doesn't exist
      if (!fs.existsSync(crashMonitorState.pidFilePath)) {
        try {
          fs.writeFileSync(crashMonitorState.pidFilePath, existingServer.pid.toString());
        } catch (error) {
          log(`Warning: Failed to write PID file: ${error.message}`, 'yellow');
        }
      }
    } else {
      log('No existing ArmaReforgerServer processes found. Will monitor for new processes.', 'yellow');
    }

    // Set up cleanup handlers
    const cleanup = async () => {
      log('Script finishing. Restoring original window title.', 'gray');
      process.title = crashMonitorState.originalTitle;

      // Clean up PID file
      if (fs.existsSync(crashMonitorState.pidFilePath)) {
        fs.unlinkSync(crashMonitorState.pidFilePath);
      }

      // Log shutdown if we were monitoring a server
      if (crashMonitorState.serverProcess && crashMonitorState.serverProcess.pid) {
        try {
          process.kill(crashMonitorState.serverProcess.pid, 0); // Check if process still exists
          const shutdownUptime = (new Date() - crashMonitorState.serverProcess.startTime) / 1000;
          await logIncident('Shutdown', null, shutdownUptime);
          log('Logged server shutdown.', 'gray');
        } catch (error) {
          // Process already terminated
        }
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);
  }
  
  // Load uptime data first
  await loadUptimeData();
  
  // Load existing data from files
  await loadDataFromFiles();
  
  // Initial check (this will detect the server start time from log directory)
  await startMonitoring();
  
  // Set up periodic monitoring
  setInterval(startMonitoring, config.updateInterval);
  
  // Set up periodic saving of data (every 30 seconds)
  const saveInterval = 30 * 1000; // 30 seconds in milliseconds
  setInterval(async () => {
    await saveDataToFiles();
    await saveUptimeData(); // Also save uptime data periodically
  }, saveInterval);
  console.log(`Data will be saved to JSON files every 30 seconds`);
  
  // Initialize Discord bot if enabled
  if (config.discord && config.discord.enabled) {
    console.log('Initializing Discord bot...');
    try {
      discordBot = new DiscordBot(config, serverStats);
      console.log('Discord bot initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Discord bot:', error);    }
  }

});
