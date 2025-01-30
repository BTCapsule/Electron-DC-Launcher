import React, { useState, useEffect, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import Card from './Card';

import DownloadModal from './DownloadModal';
import WalletMessageModal from './WalletMessageModal';
import { updateDownloads, updateIBDStatus } from '../store/downloadSlice';
import { showDownloadModal } from '../store/downloadModalSlice';

function Nodes() {
  const L1_CHAINS = ['bitcoin', 'enforcer', 'bitwindow'];
  const [chains, setChains] = useState([]);
  const [walletMessage, setWalletMessage] = useState(null);
  const [bitcoinSync, setBitcoinSync] = useState(null);
  const [runningNodes, setRunningNodes] = useState([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [buttonText, setButtonText] = useState('Download All');
  const [isSequentialDownloading, setIsSequentialDownloading] = useState(false);
  const dispatch = useDispatch();
  
 const checkL1ChainsStatus = useCallback(() => {
  
  const allPresent = L1_CHAINS.every(chainId => {
    const chain = chains.find(c => c.id === chainId);
    return chain && chain.status !== 'not_downloaded';
  });

  setButtonText(allPresent ? 'Boot Layer 1' : 'Download All');
}, [chains]);

const fetchChains = useCallback(async () => {
  try {
    const config = await window.electronAPI.getConfig();
    const dependencyData = await import('../CardData.json');
    
    const chainsWithStatus = await Promise.all(
      config.chains
        .filter(chain => chain.enabled)
        .map(async chain => {
          const dependencyInfo = dependencyData.default.find(d => d.id === chain.id);
          return {
            ...chain,
            dependencies: dependencyInfo?.dependencies || [],
            status: await window.electronAPI.getChainStatus(chain.id),
            progress: 0,
          };
        })
    );
    
    setChains(chainsWithStatus);
    checkL1ChainsStatus(); // Check status after setting chains
  } catch (error) {
    console.error('Failed to fetch chain config:', error);
  }
}, [checkL1ChainsStatus]);

const downloadsUpdateHandler = useCallback(
    downloads => {
      if (!Array.isArray(downloads)) {
        console.warn('Received invalid downloads data:', downloads);
        return;
      }
      
      // Ensure we only pass serializable data
      const sanitizedDownloads = downloads.map(download => ({
        chainId: download.chainId,
        status: download.status,
        progress: download.progress
      }));

      console.log('Received downloads update:', sanitizedDownloads);
      dispatch(updateDownloads(sanitizedDownloads));
      setChains(prevChains =>
        prevChains.map(chain => {
          const download = sanitizedDownloads.find(d => d.chainId === chain.id);
          return download
            ? { ...chain, status: download.status, progress: download.progress }
            : chain;
        })
      );
    },
    [dispatch]
  );

const chainStatusUpdateHandler = useCallback(({ chainId, status }) => {
  console.log(`Chain status update - ${chainId}: ${status}`);
  
  setChains(prevChains => {
    const newChains = prevChains.map(chain =>
      chain.id === chainId ? { ...chain, status } : chain
    );
    console.log('Updated chains:', newChains);
    return newChains;
  });
  
  // Update running nodes list with proper state management
  if (status === 'running' || status === 'ready') {
    setRunningNodes(prev => {
      const newRunningNodes = Array.from(new Set([...prev, chainId]));
      console.log('Added to running nodes:', chainId, newRunningNodes);
      return newRunningNodes;
    });
  } else {
    setRunningNodes(prev => {
      const newRunningNodes = prev.filter(id => id !== chainId);
      console.log('Removed from running nodes:', chainId, newRunningNodes);
      return newRunningNodes;
    });
  }
}, []);

  const downloadCompleteHandler = useCallback(({ chainId }) => {
    setChains(prevChains =>
      prevChains.map(chain =>
        chain.id === chainId
          ? { ...chain, status: 'downloaded', progress: 100 }
          : chain
      )
    );
  }, []);

useEffect(() => {
  const updateButtonText = () => {
    // Check if any L1 chain is not downloaded
    const anyNotDownloaded = L1_CHAINS.some(chainId => {
      const chain = chains.find(c => c.id === chainId);
      return chain && chain.status === 'not_downloaded';
    });

    // Check if all L1 chains are running
    const allRunning = L1_CHAINS.every(chainId => runningNodes.includes(chainId));

    // Determine new button text
    let newText;
    if (isSequentialDownloading) {
      newText = 'Processing...';
    } else if (anyNotDownloaded) {
      newText = 'Download All';
    } else if (allRunning) {
      newText = 'Stop Layer 1';
    } else {
      newText = 'Boot Layer 1';
    }

    // Only update if text actually changed
    if (buttonText !== newText) {
      setButtonText(newText);
    }
  };

  // Update immediately
  updateButtonText();

}, [chains, runningNodes, isSequentialDownloading, buttonText]);


useEffect(() => {
  fetchChains(); // Initial fetch to check binary presence
  
  const unsubscribeStatus = window.electronAPI.onChainStatusUpdate(
    chainStatusUpdateHandler
  );

  return () => {
    if (typeof unsubscribeStatus === 'function') unsubscribeStatus();
  };
}, [fetchChains, chainStatusUpdateHandler]);

  const handleOpenWalletDir = useCallback(async chainId => {
    try {
      const result = await window.electronAPI.openWalletDir(chainId);
      if (!result.success) {
        setWalletMessage({
          error: result.error,
          path: result.path,
          chainName: result.chainName,
        });
      }
    } catch (error) {
      console.error(
        `Failed to open wallet directory for chain ${chainId}:`,
        error
      );
      setWalletMessage({
        error: error.message,
        path: '',
        chainName: '',
      });
    }
  }, []);

  const handleUpdateChain = useCallback((chainId, updates) => {
    setChains(prevChains =>
      prevChains.map(chain =>
        chain.id === chainId ? { ...chain, ...updates } : chain
      )
    );
  }, []);

  const handleDownloadChain = useCallback(
    async chainId => {
      try {
        console.log(`Attempting to download chain ${chainId}`);
        await window.electronAPI.downloadChain(chainId);
        console.log(`Download initiated for chain ${chainId}`);
        dispatch(showDownloadModal());
      } catch (error) {
        console.error(`Failed to start download for chain ${chainId}:`, error);
      }
    },
    [dispatch]
  );

const handleStartChain = useCallback(async chainId => {
  try {
    // Find the chain
    const chain = chains.find(c => c.id === chainId);
    if (!chain) {
      console.error(`Chain ${chainId} not found`);
      return;
    }

    console.log(`Attempting to start ${chainId}`);
    
    // Skip dependency checks for enforcer and bitwindow
    if (chainId !== 'enforcer' && chainId !== 'bitwindow') {
      // Check dependencies only for other chains
      if (chain.dependencies && chain.dependencies.length > 0) {
        const missingDeps = chain.dependencies.filter(dep => !runningNodes.includes(dep));
        if (missingDeps.length > 0) {
          console.error(`Cannot start ${chainId}: missing dependencies: ${missingDeps.join(', ')}`);
          return;
        }
      }
    }

    console.log(`Starting ${chainId} via electronAPI...`);
    await window.electronAPI.startChain(chainId);
    console.log(`${chainId} started successfully`);

    setChains(prevChains =>
      prevChains.map(chain =>
        chain.id === chainId ? { ...chain, status: 'running' } : chain
      )
    );
  } catch (error) {
    console.error(`Failed to start chain ${chainId}:`, error);
    console.error('Full error:', error);
  }
}, [chains]);

  const handleStopChain = useCallback(async chainId => {
    try {
      await window.electronAPI.stopChain(chainId);
      setChains(prevChains =>
        prevChains.map(chain =>
          chain.id === chainId ? { ...chain, status: 'stopped' } : chain
        )
      );
    } catch (error) {
      console.error(`Failed to stop chain ${chainId}:`, error);
    }
  }, []);

  const handleResetChain = useCallback(
    async chainId => {
      const chain = chains.find(c => c.id === chainId);
      if (chain.status === 'running') {
        try {
          await handleStopChain(chainId);
        } catch (error) {
          console.error(`Failed to stop chain ${chainId} before reset:`, error);
          return;
        }
      }

      try {
        await window.electronAPI.resetChain(chainId);
      } catch (error) {
        console.error(`Failed to reset chain ${chainId}:`, error);
      }
    },
    [chains, handleStopChain]
  );

const waitForChainRunning = useCallback((chainId) => {
  return new Promise((resolve) => {
    const checkRunning = async () => {
      if (runningNodes.includes(chainId)) {
        // Add additional delay for Bitcoin to ensure it's fully ready
        if (chainId === 'bitcoin') {
          await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
        }
        resolve();
      } else {
        setTimeout(checkRunning, 500); // Check every 500ms
      }
    };
    checkRunning();
  });
}, [runningNodes]);

  const isBitcoinStopped = useCallback(() => {
    const bitcoinChain = chains.find(c => c.id === 'bitcoin');
    return bitcoinChain?.status === 'stopped';
  }, [chains]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isStoppingSequence, setIsStoppingSequence] = useState(false);

  const areAllChainsRunning = useCallback(() => {
    return L1_CHAINS.every(chain =>
      runningNodes.includes(chain)
    );
  }, [runningNodes]);

  const isAnyL1ChainDownloading = useCallback(() => {
    return L1_CHAINS.some(chainId => {
      const chain = chains.find(c => c.id === chainId);
      return chain && (chain.status === 'downloading' || chain.status === 'extracting');
    });
  }, [chains]);

  const areAllL1ChainsDownloaded = useCallback(() => {
    return L1_CHAINS.every(chainId => {
      const chain = chains.find(c => c.id === chainId);
      return chain && chain.status !== 'not_downloaded';
    });
  }, [chains]);

  const downloadMissingL1Chains = useCallback(async () => {
    try {
      for (const chainId of L1_CHAINS) {
        const chain = chains.find(c => c.id === chainId);
        if (chain && chain.status === 'not_downloaded') {
          await handleDownloadChain(chainId);
        }
      }
    } catch (error) {
      console.error('Failed to download L1 chains:', error);
    }
  }, [chains, handleDownloadChain]);

  const handleStartSequence = useCallback(async () => {
    try {
      setIsProcessing(true);
      setIsStoppingSequence(false);
      
      // Only start chains that aren't already running
      if (!runningNodes.includes('bitcoin')) {
        await window.electronAPI.startChain('bitcoin');
        await window.electronAPI.waitForChain('bitcoin');
      }
      
      if (!runningNodes.includes('enforcer')) {
        await window.electronAPI.startChain('enforcer');
        await window.electronAPI.waitForChain('enforcer');
      }
      
      if (!runningNodes.includes('bitwindow')) {
        await window.electronAPI.startChain('bitwindow');
        await window.electronAPI.waitForChain('bitwindow');
      }
    } catch (error) {
      console.error('Start sequence failed:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [runningNodes]);

  // Reset processing state when bitcoin status changes to stopped
  useEffect(() => {
    const bitcoinChain = chains.find(c => c.id === 'bitcoin');
    if (bitcoinChain?.status === 'stopped' && isStoppingSequence) {
      setIsProcessing(false);
      setIsStoppingSequence(false);
    }
  }, [chains]);

  const handleStopSequence = useCallback(async () => {
    try {
      setIsProcessing(true);
      setIsStoppingSequence(true);
      
      // Stop in reverse order
      if (runningNodes.includes('bitwindow')) {
        await window.electronAPI.stopChain('bitwindow');
      }
      if (runningNodes.includes('enforcer')) {
        await window.electronAPI.stopChain('enforcer');
      }
      if (runningNodes.includes('bitcoin')) {
        await window.electronAPI.stopChain('bitcoin');
      }
    } catch (error) {
      console.error('Stop sequence failed:', error);
      setIsProcessing(false);
      setIsStoppingSequence(false);
    }
  }, [runningNodes]);


 
 

// Function to handle downloading L1 chains
const handleL1Download = useCallback(async () => {
  if (isSequentialDownloading) return;
  setIsSequentialDownloading(true);

  try {
    // Download each chain sequentially
    for (const chainId of L1_CHAINS) {
      const chain = chains.find(c => c.id === chainId);
      if (chain && chain.status === 'not_downloaded') {
        await handleDownloadChain(chainId);
        // Wait for download to complete
        await new Promise(resolve => {
          const checkStatus = async () => {
            const status = await window.electronAPI.getChainStatus(chainId);
            if (status === 'downloaded' || status === 'stopped') {
              resolve();
            } else {
              setTimeout(checkStatus, 1000);
            }
          };
          checkStatus();
        });
      }
    }

    // After all downloads complete, refresh chain states
    await fetchChains();
    
    // Update local state for each chain
    setChains(prevChains =>
      prevChains.map(chain => {
        if (L1_CHAINS.includes(chain.id)) {
          return { ...chain, status: 'downloaded' };
        }
        return chain;
      })
    );

    setButtonText('Boot Layer 1');
  } catch (error) {
    console.error('Download operation failed:', error);
  } finally {
    setIsSequentialDownloading(false);
  }
}, [chains, handleDownloadChain, fetchChains, L1_CHAINS, isSequentialDownloading]);

// Function to handle starting L1 chains
const handleL1Boot = useCallback(async () => {
  if (isSequentialDownloading) return;
  setIsSequentialDownloading(true);

  try {
    console.log('Starting boot sequence...');
    
    // Start bitcoin first
    console.log('Starting Bitcoin...');
    await handleStartChain('bitcoin');
    
    // Wait 2 seconds before starting enforcer and bitwindow
    console.log('Waiting 2 seconds before starting Enforcer and BitWindow...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Start enforcer
    console.log('Starting Enforcer...');
    await handleStartChain('enforcer');
    
    // Start bitwindow
    console.log('Starting BitWindow...');
    await handleStartChain('bitwindow');

    setButtonText('Stop Layer 1');
  } catch (error) {
    console.error('Boot sequence failed:', error);
    setButtonText('Boot Layer 1');
  } finally {
    setIsSequentialDownloading(false);
  }
}, [handleStartChain, isSequentialDownloading]);
    


// Main handler that delegates to the appropriate function
const handleSequentialDownload = useCallback(async () => {
  if (isSequentialDownloading) return;
  setIsSequentialDownloading(true);

  try {
    if (buttonText === 'Download All') {
      await handleL1Download();
    } 
    else if (buttonText === 'Boot Layer 1') {
      // Start chains in sequence
      console.log('Starting boot sequence...');
      
      // Start Bitcoin first
      if (!runningNodes.includes('bitcoin')) {
        console.log('Starting Bitcoin...');
        await handleStartChain('bitcoin');
        // Wait for Bitcoin to be fully running
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      // Start Enforcer after Bitcoin
      if (!runningNodes.includes('enforcer')) {
        console.log('Starting Enforcer...');
        await handleStartChain('enforcer');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Start BitWindow last
      if (!runningNodes.includes('bitwindow')) {
        console.log('Starting BitWindow...');
        await handleStartChain('bitwindow');
      }
    } 
    else if (buttonText === 'Stop Layer 1') {
      console.log('Starting stop sequence...');
      
      // Stop chains in reverse order
      const chainsToStop = ['bitwindow', 'enforcer', 'bitcoin'];
      
      for (const chainId of chainsToStop) {
        if (runningNodes.includes(chainId)) {
          console.log(`Stopping ${chainId}...`);
          
          try {
            // Send stop command
            await window.electronAPI.stopChain(chainId);
            
            // Wait for the chain to actually stop
            let attempts = 0;
            while (attempts < 30 && runningNodes.includes(chainId)) {
              await new Promise(resolve => setTimeout(resolve, 1000));
              attempts++;
              
              // Check chain status
              const status = await window.electronAPI.getChainStatus(chainId);
              if (status === 'stopped') {
                console.log(`${chainId} stopped successfully`);
                break;
              }
            }
            
            // Force update the chain status in local state
            setChains(prevChains =>
              prevChains.map(chain =>
                chain.id === chainId ? { ...chain, status: 'stopped' } : chain
              )
            );
            
            // Force update running nodes
            setRunningNodes(prev => prev.filter(id => id !== chainId));
            
            // Additional delay between stopping chains
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (error) {
            console.error(`Error stopping ${chainId}:`, error);
          }
        }
      }
      
      // Final state check
      await fetchChains();
    }
  } catch (error) {
    console.error('Sequential operation failed:', error);
  } finally {
    setIsSequentialDownloading(false);
  }
}, [
  buttonText,
  isSequentialDownloading,
  handleL1Download,
  handleStartChain,
  runningNodes,
  fetchChains
]);

useEffect(() => {
  const initializeAndSubscribe = async () => {
    try {
      // Initial fetch of chains
      const config = await window.electronAPI.getConfig();
      const dependencyData = await import('../CardData.json');
      
      const chainsWithStatus = await Promise.all(
        config.chains
          .filter(chain => chain.enabled)
          .map(async chain => {
            const dependencyInfo = dependencyData.default.find(d => d.id === chain.id);
            return {
              ...chain,
              dependencies: dependencyInfo?.dependencies || [],
              status: await window.electronAPI.getChainStatus(chain.id),
              progress: 0,
            };
          })
      );
      
      setChains(chainsWithStatus);
      
      // Set initial running nodes
      const initialRunning = chainsWithStatus
        .filter(chain => chain.status === 'running' || chain.status === 'ready')
        .map(chain => chain.id);
      setRunningNodes(initialRunning);
      setIsInitialized(true);

      // Set up event listeners with error handling
      const unsubscribeDownloadsUpdate = window.electronAPI.onDownloadsUpdate(
        (downloads) => {
          try {
            downloadsUpdateHandler(downloads);
          } catch (error) {
            console.error('Error handling downloads update:', error);
          }
        }
      );
      
      // Get initial downloads state with error handling
      try {
        const initialDownloads = await window.electronAPI.getDownloads();
        downloadsUpdateHandler(initialDownloads);
      } catch (error) {
        console.error('Error getting initial downloads:', error);
      }

      // Return cleanup function
      return () => {
        if (typeof unsubscribeDownloadsUpdate === 'function') {
          unsubscribeDownloadsUpdate();
        }
      };
    } catch (error) {
      console.error('Failed to initialize:', error);
      setIsInitialized(true);
    }
  };

  // Execute initialization
  const cleanup = initializeAndSubscribe();
  return () => {
    cleanup.then(cleanupFn => {
      if (cleanupFn) cleanupFn();
    });
  };
}, [downloadsUpdateHandler]);

  const handleQuickStartStop = useCallback(async () => {
    try {
      if (!areAllL1ChainsDownloaded()) {
        await downloadMissingL1Chains();
      } else if (!areAllChainsRunning()) {
        await handleStartSequence();
      } else {
        await handleStopSequence();
      }
    } catch (error) {
      console.error('Quick start/stop failed:', error);
    }
  }, [areAllL1ChainsDownloaded, areAllChainsRunning, downloadMissingL1Chains, handleStartSequence, handleStopSequence]);

  return (
    <div className="Nodes">
      <h1>Drivechain Launcher</h1>
      {/* Temporarily commented out QuickStartStop button
      {isInitialized && (
        <button
          onClick={handleQuickStartStop}
          disabled={isProcessing || isAnyL1ChainDownloading()}
        style={{
          margin: '10px',
          padding: '8px 16px',
          backgroundColor: isProcessing || isAnyL1ChainDownloading()
            ? '#FFA726'  // Orange for processing/downloading
            : !areAllL1ChainsDownloaded()
              ? '#2196F3'  // Blue for download
              : areAllChainsRunning()
                ? '#f44336'  // Red for stop
                : '#4CAF50', // Green for start
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: (isProcessing || isAnyL1ChainDownloading()) ? 'wait' : 'pointer',
          opacity: (isProcessing || isAnyL1ChainDownloading()) ? 0.8 : 1
        }}
      >
        {isProcessing
          ? (isStoppingSequence ? 'Stopping...' : 'Starting...')
          : isAnyL1ChainDownloading()
            ? 'Downloading...'
            : !areAllL1ChainsDownloaded() 
              ? 'Download L1' 
              : !areAllChainsRunning() 
                ? 'Quick Start' 
                : 'Safe Stop'}
        </button>
      )} */}
      <div className={"chainSectionsContainer"}>
      <div className="chain-list">
        <div className="chain-section">
        <div className="chain-heading-row">
          <h2 className="chain-heading">Layer 1</h2>
<button 
  onClick={handleSequentialDownload}
  disabled={isSequentialDownloading}
  className="layer1-action-button"
  style={{
    padding: '8px 16px',
    backgroundColor: isSequentialDownloading 
      ? '#FFA726'  // Orange for processing
      : buttonText === 'Download All'
        ? '#2196F3'  // Blue for download
        : buttonText === 'Stop Layer 1'
          ? '#f44336'  // Red for stop
          : '#4CAF50', // Green for start/boot
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: isSequentialDownloading ? 'wait' : 'pointer',
    opacity: isSequentialDownloading ? 0.8 : 1,
    transition: 'all 0.3s ease',
    margin: '10px 0',
    fontWeight: 'bold'
  }}
>
  {isSequentialDownloading ? 'Processing...' : buttonText}
</button>
  </div>
          <div className="l1-chains">
            {chains
              .filter(chain => chain.chain_type === 0)
              .map(chain => (
                <Card
                  key={chain.id}
                  chain={chain}
                  onUpdateChain={handleUpdateChain}
                  onDownload={handleDownloadChain}
                  onStart={handleStartChain}
                  onStop={handleStopChain}
                  onReset={handleResetChain}
                  onOpenWalletDir={handleOpenWalletDir}
                  runningNodes={runningNodes}
                />
              ))}
          </div>
        </div>
        <div className="chain-section">
          <h2 className="chain-heading">Layer 2</h2>
          <div className="l2-chains">
            {chains
              .filter(chain => chain.chain_type === 2)
              .map(chain => (
                <Card
                  key={chain.id}
                  chain={chain}
                  onUpdateChain={handleUpdateChain}
                  onDownload={handleDownloadChain}
                  onStart={handleStartChain}
                  onStop={handleStopChain}
                  onReset={handleResetChain}
                  onOpenWalletDir={handleOpenWalletDir}
                  runningNodes={runningNodes}
                />
              ))}
          </div>
        </div>
      </div>
      </div>
      
      <DownloadModal />
      {walletMessage && (
        <WalletMessageModal
          error={walletMessage.error}
          path={walletMessage.path}
          onClose={() => setWalletMessage(null)}
        />
      )}
    </div>
  );
}

export default Nodes;
