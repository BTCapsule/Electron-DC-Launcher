const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const bip39 = require('bip39');
const bitcoin = require('bitcoinjs-lib');
const HDKey = require('hdkey');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const lmdb = require('lmdb');
class WalletService extends EventEmitter {
  static DEFAULT_BIP32_PATH = "m/44'/0'/0'";

  constructor() {
    super();
    this.walletDir = path.join(app.getPath('userData'), 'wallet_starters');
    this.mnemonicsDir = path.join(this.walletDir, 'mnemonics');
    fs.ensureDirSync(this.walletDir);
    fs.ensureDirSync(this.mnemonicsDir);
  }

  getMnemonicPath(chainId) {
    return path.join(this.mnemonicsDir, `sidechain_${chainId}.txt`);
  }

  async generateWallet(options = {}) {
    try {
      let mnemonic;
      
      if (options.customMnemonic) {
        if (!bip39.validateMnemonic(options.customMnemonic)) {
          throw new Error('Invalid mnemonic');
        }
        mnemonic = options.customMnemonic;
      } else {
        // Generate new mnemonic (128 bits = 12 words)
        mnemonic = bip39.generateMnemonic(128);
      }

      // Generate seed with optional passphrase
      const seed = await bip39.mnemonicToSeed(mnemonic, options.passphrase);
      const seedHex = seed.toString('hex');
      
      // Create HD wallet
      const hdkey = HDKey.fromMasterSeed(seed);
      const masterKey = hdkey.privateExtendedKey;
      
      // Get entropy and calculate checksum
      const entropy = bip39.mnemonicToEntropy(mnemonic);
      const checksumBits = this.calculateChecksumBits(Buffer.from(entropy, 'hex'));

      return {
        mnemonic,
        seed_hex: seedHex,
        xprv: masterKey,
        bip39_bin: this.bytesToBinary(Buffer.from(entropy, 'hex')),
        bip39_csum: checksumBits,
        bip39_csum_hex: Buffer.from([parseInt(checksumBits, 2)]).toString('hex')
      };
    } catch (error) {
      console.error('Error generating wallet:', error);
      throw error;
    }
  }

  async deriveL1Starter() {
    try {
      const masterWallet = await this.loadWallet();
      if (!masterWallet?.xprv) {
        throw new Error('Master starter not found or invalid');
      }

      // Derive L1 key
      const hdkey = HDKey.fromExtendedKey(masterWallet.xprv);
      const l1Path = "m/44'/0'/256'";
      const l1Key = hdkey.derive(l1Path);
      
      // Generate entropy from private key
      const privateKeyBytes = l1Key.privateKey;
      const hashedKey = crypto.createHash('sha256').update(privateKeyBytes).digest();
      const entropy = hashedKey.slice(0, 16);

      // Generate new mnemonic from entropy
      const mnemonic = bip39.entropyToMnemonic(entropy);
      const seed = await bip39.mnemonicToSeed(mnemonic);
      
      // Create new HD wallet for L1
      const l1HDKey = HDKey.fromMasterSeed(seed);
      
      const l1Starter = {
        mnemonic,
        seed_hex: seed.toString('hex'),
        xprv: l1HDKey.privateExtendedKey,
        parent_xprv: masterWallet.xprv,
        derivation_path: l1Path,
        name: 'Bitcoin Core (Patched)',
        chain_layer: 1
      };

      await this.saveL1Starter(l1Starter);
      return l1Starter;
    } catch (error) {
      console.error('Error deriving L1 starter:', error);
      throw error;
    }
  }



// Add this to the existing WalletService class
async initializeLMDBEnvironment(chainId) {
  const chain = config.chains.find(c => c.id === chainId);
  if (!chain) throw new Error('Chain not found');

  const dbPath = path.join(
    app.getPath('home'),
    chain.directories.base[process.platform],
    'data/thunder'
  );

  // Ensure directory exists
  await fs.ensureDir(dbPath);

  // Initialize LMDB environment
  const env = lmdb.open({
    path: dbPath,
    maxDbs: 1,
    mapSize: 10 * 1024 * 1024 // 10MB
  });

  return env;
}

// Replace the existing deriveSidechainStarter with this complete version
async deriveSidechainStarter(sidechainSlot) {
  try {
    const masterWallet = await this.loadWallet();
    if (!masterWallet?.xprv) {
      throw new Error('Master starter not found or invalid');
    }

    // Derive sidechain key
    const hdkey = HDKey.fromExtendedKey(masterWallet.xprv);
    const sidechainPath = `m/44'/0'/${sidechainSlot}'`;
    const sidechainKey = hdkey.derive(sidechainPath);
    
    // Generate entropy from private key
    const privateKeyBytes = sidechainKey.privateKey;
    const hashedKey = crypto.createHash('sha256').update(privateKeyBytes).digest();
    const entropy = hashedKey.slice(0, 16);

    // Generate new mnemonic from entropy
    const mnemonic = bip39.entropyToMnemonic(entropy);
    const seed = await bip39.mnemonicToSeed(mnemonic);
    
    // Create new HD wallet for sidechain
    const sidechainHDKey = HDKey.fromMasterSeed(seed);
    
    const sidechainStarter = {
      mnemonic,
      seed_hex: seed.toString('hex'),
      xprv: sidechainHDKey.privateExtendedKey,
      parent_xprv: masterWallet.xprv,
      derivation_path: sidechainPath
    };

    // Initialize LMDB for Thunder (slot 9)
    if (sidechainSlot === 9) {
      await this.initializeLMDBEnvironment('thunder');
    }

    await this.saveSidechainStarter(sidechainSlot, sidechainStarter);
    return sidechainStarter;
  } catch (error) {
    console.error('Error deriving sidechain starter:', error);
    throw error;
  }
}

  async saveWallet(walletData) {
    try {
      const walletPath = path.join(this.walletDir, 'master_starter.json');
      
      // Validate required fields
      const requiredFields = ['mnemonic', 'seed_hex', 'xprv'];
      for (const field of requiredFields) {
        if (!walletData[field]) {
          throw new Error(`Missing required wallet field: ${field}`);
        }
      }

      // Add name field
      walletData.name = 'Master';

      // Save wallet data
      await fs.writeJson(walletPath, walletData, { spaces: 2 });
      
      this.emit('wallet-updated');
      return true;
    } catch (error) {
      console.error('Error saving wallet:', error);
      return false;
    }
  }

  async saveL1Starter(walletData) {
    const l1Path = path.join(this.walletDir, 'l1_starter.json');
    await fs.writeJson(l1Path, walletData, { spaces: 2 });
    this.emit('wallet-updated');
  }

  async saveSidechainStarter(slot, walletData) {
    // Save full wallet data
    const sidechainPath = path.join(this.walletDir, `sidechain_${slot}_starter.json`);
    await fs.writeJson(sidechainPath, walletData, { spaces: 2 });
    
    // Save mnemonic only for chain apps if it doesn't exist
    const mnemonicPath = path.join(this.mnemonicsDir, `sidechain_${slot}.txt`);
    if (!(await fs.pathExists(mnemonicPath))) {
      console.log(`Creating new mnemonic file for slot ${slot}`);
      await fs.writeFile(mnemonicPath, walletData.mnemonic);
    } else {
      console.log(`Mnemonic file already exists for slot ${slot}, skipping creation`);
    }
    
    this.emit('wallet-updated');
  }

  async loadWallet() {
    try {
      const walletPath = path.join(this.walletDir, 'master_starter.json');
      
      if (await fs.pathExists(walletPath)) {
        const walletData = await fs.readJson(walletPath);
        if (!walletData.mnemonic || !walletData.xprv) {
          throw new Error('Invalid wallet data format');
        }
        return walletData;
      }
      return null;
    } catch (error) {
      console.error('Error loading wallet:', error);
      return null;
    }
  }

  async deleteWallet() {
    try {
      const walletPath = path.join(this.walletDir, 'master_starter.json');
      await fs.remove(walletPath);
      this.emit('wallet-updated');
      return true;
    } catch (error) {
      console.error('Error deleting wallet:', error);
      return false;
    }
  }

  // Preview wallet from entropy input
  async previewWallet({ input, isHexMode }) {
    try {
      let entropy;
      if (isHexMode) {
        // Direct hex input
        if (!/^[0-9a-fA-F]*$/.test(input) || input.length > 64 || input.length % 8 !== 0) {
          throw new Error('Invalid hex format');
        }
        entropy = Buffer.from(input, 'hex');
      } else {
        // Hash text input to get entropy
        const hash = crypto.createHash('sha256').update(input).digest();
        entropy = hash.slice(0, 16); // Take first 16 bytes
      }

      // Generate mnemonic from entropy
      const mnemonic = bip39.entropyToMnemonic(entropy);
      const words = mnemonic.split(' ');

      // Get binary representation for each word
      const binaryStrings = [];
      const entropyBits = this.bytesToBinary(entropy);
      const checksumBits = this.calculateChecksumBits(entropy);
      
      // Split into 11-bit chunks
      for (let i = 0; i < words.length - 1; i++) {
        const chunk = entropyBits.slice(i * 11, (i + 1) * 11);
        binaryStrings.push(chunk);
      }

      // Handle last word (entropy + checksum)
      const lastEntropyBits = entropyBits.slice(-7);
      const lastWordBinary = lastEntropyBits + checksumBits.slice(0, 4);
      binaryStrings.push(lastWordBinary);

      // Generate seed and master key
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const hdkey = HDKey.fromMasterSeed(seed);
      
      return {
        success: true,
        data: {
          words,
          binaryStrings,
          lastWordBinary,
          bip39Bin: entropyBits + checksumBits,
          checksumBits,
          masterKey: hdkey.privateKey.toString('hex')
        }
      };
    } catch (error) {
      console.error('Error previewing wallet:', error);
      return { success: false, error: error.message };
    }
  }

  // Create wallet from entropy input
  async createAdvancedWallet({ input, isHexMode }) {
    try {
      const preview = await this.previewWallet({ input, isHexMode });
      if (!preview.success) {
        throw new Error(preview.error);
      }

      // Create wallet from preview data
      const mnemonic = preview.data.words.join(' ');
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const hdkey = HDKey.fromMasterSeed(seed);

      const wallet = {
        mnemonic,
        seed_hex: seed.toString('hex'),
        xprv: hdkey.privateExtendedKey,
        bip39_bin: preview.data.bip39Bin,
        bip39_csum: preview.data.checksumBits,
        bip39_csum_hex: Buffer.from([parseInt(preview.data.checksumBits, 2)]).toString('hex')
      };

      // Save wallet and generate starters
      await this.saveWallet(wallet);
      await this.generateAllStarters();

      return { success: true };
    } catch (error) {
      console.error('Error creating advanced wallet:', error);
      return { success: false, error: error.message };
    }
  }

  // Generate random entropy
  generateRandomEntropy() {
    try {
      const entropy = crypto.randomBytes(16); // 128 bits = 16 bytes
      return { success: true, data: entropy.toString('hex') };
    } catch (error) {
      console.error('Error generating random entropy:', error);
      return { success: false, error: error.message };
    }
  }

  bytesToBinary(bytes) {
    return Array.from(bytes)
      .map(byte => byte.toString(2).padStart(8, '0'))
      .join('');
  }

  calculateChecksumBits(entropy) {
    const ENT = entropy.length * 8;
    const CS = ENT / 32;
    
    const hash = crypto.createHash('sha256').update(entropy).digest();
    const hashBits = this.bytesToBinary(hash);
    return hashBits.slice(0, CS);
  }

  async generateAllStarters() {
    try {
      // Check if master wallet exists
      const masterWallet = await this.loadWallet();
      if (!masterWallet) {
        console.log('No master wallet found, skipping starter generation');
        return;
      }

      // Check and generate L1 starter if needed
      const l1Path = path.join(this.walletDir, 'l1_starter.json');
      if (!(await fs.pathExists(l1Path))) {
        try {
          await this.deriveL1Starter();
          console.log('Generated new L1 starter');
        } catch (error) {
          console.error('Error generating L1 starter:', error);
        }
      }

      // Check and generate sidechain starters if needed
      const sidechainSlots = [9, 2]; // Thunder and Bitnames respectively
      for (const slot of sidechainSlots) {
        const sidechainPath = path.join(this.walletDir, `sidechain_${slot}_starter.json`);
        if (!(await fs.pathExists(sidechainPath))) {
          try {
            await this.deriveSidechainStarter(slot);
            console.log(`Generated new sidechain starter for slot ${slot}`);
          } catch (error) {
            console.error(`Error generating sidechain starter for slot ${slot}:`, error);
          }
        }
      }

      this.emit('wallet-updated');
    } catch (error) {
      console.error('Error checking/generating starters:', error);
      throw error;
    }
  }
}

module.exports = WalletService;
