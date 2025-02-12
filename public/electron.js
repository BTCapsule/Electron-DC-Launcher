const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const isDev = require("electron-is-dev");
const ConfigManager = require("./modules/configManager");
const ChainManager = require("./modules/chainManager");
const WalletManager = require("./modules/walletManager");
const FastWithdrawalManager = require("./modules/fastWithdrawalManager");
const DownloadManager = require("./modules/downloadManager");
const ApiManager = require("./modules/apiManager");
const DirectoryManager = require("./modules/directoryManager");
const UpdateManager = require("./modules/updateManager");


const configPath = path.join(__dirname, "chain_config.json");
let config;
let mainWindow = null;
let chainManager;
let downloadManager;
let directoryManager;
let apiManager;
let updateManager;
let walletManager;
let fastWithdrawalManager;

async function loadConfig() {
  try {
    const configData = await fs.readFile(configPath, "utf8");
    config = JSON.parse(configData);
  } catch (error) {
    console.error("Failed to load config:", error);
    app.quit();
  }
}

function createWindow() {
  if (mainWindow === null) {
    mainWindow = new BrowserWindow({
      width: 1024,
      height: 768 + 30,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js"),
      },
    });
    mainWindow.loadURL(
      isDev
        ? "http://localhost:3000"
        : `file://${path.join(__dirname, "../build/index.html")}`
    );

    mainWindow.on('close', (event) => {
      if (!isShuttingDown) {
        event.preventDefault();
        performGracefulShutdown();
      }
    });

    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }
}

function setupIPCHandlers() {
  // API handlers
  ipcMain.handle("list-claims", async () => {
    try {
      const claims = await apiManager.listClaims();
      return { success: true, data: claims };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("submit-claim", async (event, { destination, amount }) => {
    try {
      const result = await apiManager.submitClaim(destination, amount);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Wallet handlers
  ipcMain.handle("get-wallet-dir", async (event, chainId) => {
    try {
      return directoryManager.getWalletDir(chainId);
    } catch (error) {
      console.error("Failed to get wallet directory:", error);
      return null;
    }
  });

  ipcMain.handle("open-wallet-dir", async (event, chainId) => {
    try {
      return await directoryManager.openWalletLocation(chainId);
    } catch (error) {
      console.error("Failed to open wallet directory:", error);
      return { success: false, error: error.message };
    }
  });

  // Directory handlers
  ipcMain.handle("get-full-data-dir", async (event, chainId) => {
    try {
      return directoryManager.getFullDataDir(chainId);
    } catch (error) {
      console.error("Failed to get full data directory:", error);
      throw error;
    }
  });

  ipcMain.handle("open-data-dir", async (event, chainId) => {
    try {
      return await directoryManager.openDataDir(chainId);
    } catch (error) {
      console.error("Failed to open data directory:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("get-binary-dir", async (event, chainId) => {
    try {
      return chainManager.getBinaryDir(chainId);
    } catch (error) {
      console.error("Failed to get binary directory:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("open-binary-dir", async (event, chainId) => {
    try {
      return await chainManager.openBinaryDir(chainId);
    } catch (error) {
      console.error("Failed to open binary directory:", error);
      return { success: false, error: error.message };
    }
  });

  // Chain handlers
  ipcMain.handle("get-mnemonic-path", async (event, chainId) => {
    try {
      return walletManager.walletService.getMnemonicPath(chainId);
    } catch (error) {
      console.error("Failed to get mnemonic path:", error);
      return { success: false, error: error.message };
    }
  });

ipcMain.handle("start-chain", async (event, chainId) => {
  try {
    const chain = config.chains.find(c => c.id === chainId);
    let args = [];
    
    if (chain && chain.chain_layer === 2 && chain.slot === 9) { // Thunder
      const walletPath = path.join(
        app.getPath("home"),
        chain.directories.base[process.platform],
        "wallet.mdb"
      );
      
      const walletExists = await fs.pathExists(walletPath);
      
      if (!walletExists) {
        // Initialize LMDB environment first
        await walletManager.walletService.initializeLMDBEnvironment(chainId);
        
        const mnemonicPath = walletManager.walletService.getMnemonicPath(chain.slot);
        args = ['--mnemonic-seed-phrase-path', mnemonicPath];
      }
    }
    
    return await chainManager.startChain(chainId, args);
  } catch (error) {
    console.error("Failed to start chain:", error);
    return { success: false, error: error.message };
  }
});
  
  
  

  ipcMain.handle("stop-chain", async (event, chainId) => {
    try {
      return await chainManager.stopChain(chainId);
    } catch (error) {
      console.error("Failed to stop chain:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("get-chain-status", async (event, chainId) => {
    try {
      return await chainManager.getChainStatus(chainId);
    } catch (error) {
      console.error("Failed to get chain status:", error);
      return "error";
    }
  });

  ipcMain.handle("reset-chain", async (event, chainId) => {
    try {
      return await chainManager.resetChain(chainId);
    } catch (error) {
      console.error("Failed to reset chain:", error);
      return { success: false, error: error.message };
    }
  });

  // Download handlers
  ipcMain.handle("download-chain", async (event, chainId) => {
    const chain = config.chains.find((c) => c.id === chainId);
    if (!chain) throw new Error("Chain not found");

    const platform = process.platform;
    const url = chain.download.urls[platform];
    if (!url) throw new Error(`No download URL found for platform ${platform}`);

    const extractDir = chain.extract_dir?.[platform];
    if (!extractDir) throw new Error(`No extract directory configured for platform ${platform}`);

    const downloadsDir = app.getPath("downloads");
    const extractPath = path.join(downloadsDir, extractDir);

    await fs.ensureDir(extractPath);
    downloadManager.startDownload(chainId, url, extractPath);
    return { success: true };
  });

  ipcMain.handle("pause-download", async (event, chainId) => {
    return { success: await downloadManager.pauseDownload(chainId) };
  });

  ipcMain.handle("resume-download", async (event, chainId) => {
    return { success: await downloadManager.resumeDownload(chainId) };
  });

  ipcMain.handle("get-downloads", () => {
    return downloadManager.getDownloads();
  });

  // Wallet management handlers
  ipcMain.handle("create-master-wallet", async (event, options) => {
    try {
      const wallet = await walletManager.createMasterWallet(options);
      return { success: true, data: wallet };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("import-master-wallet", async (event, { mnemonic, passphrase }) => {
    try {
      const wallet = await walletManager.importMasterWallet(mnemonic, passphrase);
      return { success: true, data: wallet };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("get-master-wallet", async () => {
    try {
      const wallet = await walletManager.getMasterWallet();
      return { success: true, data: wallet };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("delete-master-wallet", async () => {
    try {
      const success = await walletManager.deleteMasterWallet();
      return { success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("derive-chain-wallet", async (event, chainId) => {
    try {
      const wallet = await walletManager.deriveChainWallet(chainId);
      return { success: true, data: wallet };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("get-chain-wallet", async (event, chainId) => {
    try {
      const wallet = await walletManager.getChainWallet(chainId);
      return { success: true, data: wallet };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Advanced wallet handlers
  ipcMain.handle("preview-wallet", async (event, options) => {
    try {
      return await walletManager.walletService.previewWallet(options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("create-advanced-wallet", async (event, options) => {
    try {
      return await walletManager.walletService.createAdvancedWallet(options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("generate-random-entropy", async () => {
    try {
      return walletManager.walletService.generateRandomEntropy();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Other handlers
  ipcMain.handle("get-config", async () => {
    return config;
  });

  ipcMain.handle("request-faucet", async (event, amount, address) => {
    try {
      const result = await apiManager.requestFaucet(amount, address);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("check-for-updates", async () => {
    return await updateManager.checkForUpdates();
  });

  ipcMain.handle("get-balance-btc", async (event, options) => {
    try {
      return await fastWithdrawalManager.getBalanceBTC();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("request-withdrawal", async (event, destination, amount, layer2Chain) => {
    try {
      return await fastWithdrawalManager.requestWithdrawal(destination, amount, layer2Chain);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("notify-payment-complete", async (event, hash, txid) => {
    try {
      return await fastWithdrawalManager.notifyPaymentComplete(hash, txid);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Master wallet directory handler
  ipcMain.handle("open-wallet-starters-dir", async () => {
    try {
      const walletDir = path.join(app.getPath('userData'), 'wallet_starters');
      await fs.ensureDir(walletDir); // Create if doesn't exist
      await shell.openPath(walletDir);
      return { success: true };
    } catch (error) {
      console.error('Failed to open wallet starters directory:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('force-kill', () => {
    forceKillAllProcesses();
  });
}

app.whenReady().then(async () => {
  await loadConfig();
  
  // Initialize managers
  directoryManager = new DirectoryManager(config);
  await directoryManager.setupChainDirectories();
  
  const configManager = new ConfigManager(configPath);
  await configManager.loadConfig();
  await configManager.setupExtractDirectories();
  
  createWindow();
  
  chainManager = new ChainManager(mainWindow, config);
  walletManager = new WalletManager(config);
  fastWithdrawalManager = new FastWithdrawalManager();
  apiManager = new ApiManager();
  updateManager = new UpdateManager(config, chainManager);
  downloadManager = new DownloadManager(mainWindow, config);
  
  setupIPCHandlers();
});

let isShuttingDown = false;
let forceKillTimeout;
const SHUTDOWN_TIMEOUT = 30000;

async function performGracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (mainWindow) {
    mainWindow.webContents.send("shutdown-started");
  }

  forceKillTimeout = setTimeout(() => {
    console.log("Shutdown timeout reached, forcing quit...");
    forceKillAllProcesses();
  }, SHUTDOWN_TIMEOUT);

  try {
    if (chainManager) {
      const runningChains = Object.keys(chainManager.runningProcesses);
      await Promise.all(runningChains.map(chainId => 
        chainManager.stopChain(chainId).catch(err => 
          console.error(`Error stopping ${chainId}:`, err)
        )
      ));
    }

    clearTimeout(forceKillTimeout);
    app.quit();
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    forceKillAllProcesses();
  }
}

function forceKillAllProcesses() {
  if (chainManager) {
    Object.entries(chainManager.runningProcesses).forEach(([chainId, process]) => {
      try {
        if (process.kill) {
          process.kill('SIGKILL');
        }
      } catch (error) {
        console.error(`Error force killing ${chainId}:`, error);
      }
    });
  }
  
  if (forceKillTimeout) {
    clearTimeout(forceKillTimeout);
  }
  app.quit();
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    performGracefulShutdown();
  }
});

app.on('before-quit', (event) => {
  if (!isShuttingDown) {
    event.preventDefault();
    performGracefulShutdown();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
