// DexScreener Ad Checker
class AdChecker {
  constructor() {
    this.ordersApiUrl = 'https://api.dexscreener.com/orders/v1/solana';
    this.pairApiUrl = 'https://api.dexscreener.com/latest/dex/pairs/solana';
    this.indicator = null;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.currentTokenAddress = null;
    this.checkInterval = null;
    this.indexingInterval = null; // For waiting for new pairs to be indexed
    this.currentStatus = 'ready';
    this.currentPairBeingIndexed = null; // Track pair being indexed
    
    // Settings with defaults
    this.settings = {
      extensionEnabled: true,
      showIndicator: true,
      monitorInterval: 5,
      indexingInterval: 10
    };
    
    this.init();
  }

  async init() {
    // Load settings first
    await this.loadSettings();
    
    // Setup message listener for popup communication
    this.setupMessageListener();
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this.startExtension();
      });
    } else {
      this.startExtension();
    }
  }

  async loadSettings() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.sync.get(this.settings);
        this.settings = { ...this.settings, ...result };
        console.log('Loaded settings:', this.settings);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  setupMessageListener() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        this.handleMessage(request, sender, sendResponse);
        return true; // Keep the message channel open for async responses
      });
    }
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      console.log('Content script received message:', request);
      
      switch (request.action) {
        case 'settingsChanged':
          console.log('Updating settings from:', this.settings, 'to:', request);
          this.settings = { ...this.settings, ...request };
          delete this.settings.action; // Remove action property
          console.log('New settings:', this.settings);
          await this.onSettingsChanged();
          sendResponse({ success: true });
          break;
          
        case 'getStatus':
          sendResponse({
            status: this.currentStatus,
            tokenAddress: this.currentTokenAddress,
            settings: this.settings
          });
          break;
          
        case 'refreshStatus':
          await this.performManualUpdate();
          sendResponse({ success: true });
          break;
          
        case 'resetPosition':
          this.resetIndicatorPosition();
          sendResponse({ success: true });
          break;
          
        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ error: error.message });
    }
  }

  async onSettingsChanged() {
    console.log('Settings changed:', this.settings);
    
    // Handle extension enabled/disabled
    if (!this.settings.extensionEnabled) {
      console.log('Extension disabled, stopping all monitoring');
      this.stopMonitoring();
      this.stopIndexingCheck();
      if (this.indicator) {
        this.hideIndicator();
      }
      return;
    }
    
    console.log('Extension enabled, checking indicator visibility');
    
    // Handle indicator visibility - but always update current status
    if (!this.settings.showIndicator && this.indicator) {
      console.log('Hiding indicator but keeping status tracking');
      this.hideIndicator();
    } else if (this.settings.showIndicator && !this.indicator && this.currentStatus) {
      console.log('Showing indicator with current status:', this.currentStatus);
      // Re-show indicator with current status
      this.showIndicator(this.formatStatusForDisplay(this.currentStatus), this.currentStatus);
    }
    
    // Restart monitoring with new intervals if currently monitoring
    if (this.checkInterval) {
      console.log('Restarting monitoring with new interval:', this.settings.monitorInterval);
      this.stopMonitoring();
      this.startMonitoring();
    }
    
    // Restart indexing check with new interval if currently checking
    if (this.indexingInterval) {
      console.log('Restarting indexing check with new interval:', this.settings.indexingInterval);
      const currentPairAddress = this.currentPairBeingIndexed; // We'll need to track this
      this.stopIndexingCheck();
      if (currentPairAddress) {
        this.waitForPairIndexing(currentPairAddress);
      }
    }
  }
  
  formatStatusForDisplay(status) {
    const statusMap = {
      'paid': 'PAID',
      'unpaid': 'UNPAID',
      'processing': 'PROCESSING', 
      'ready': 'READY',
      'indexing': 'INDEXING',
      'updating': 'UPDATING'
    };
    
    return statusMap[status] || status.toUpperCase();
  }

  startExtension() {
    if (!this.settings.extensionEnabled) {
      console.log('Extension is disabled');
      return;
    }
    
    this.checkPage();
    this.observeNavigation();
  }

  hideIndicator() {
    if (this.indicator) {
      this.indicator.remove();
      this.indicator = null;
    }
  }

  resetIndicatorPosition() {
    try {
      localStorage.removeItem('dexIndicatorPosition');
      if (this.indicator) {
        // Reset to default position
        this.restorePosition();
      }
      console.log('Indicator position reset');
    } catch (error) {
      console.error('Failed to reset indicator position:', error);
    }
  }

  observeNavigation() {
    let currentUrl = window.location.href;
    
    // Watch for URL changes (SPA navigation)
    const checkForUrlChange = () => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        console.log('URL changed, checking page:', currentUrl);
        setTimeout(() => this.checkPage(), 100); // Small delay for page to load
      }
    };

    // Multiple ways to detect navigation changes
    setInterval(checkForUrlChange, 500); // Polling fallback
    
    // Listen for history changes
    window.addEventListener('popstate', () => {
      setTimeout(() => this.checkPage(), 100);
    });
    
    // Listen for pushstate/replacestate (SPA navigation)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      setTimeout(() => window.dispatchEvent(new Event('urlchange')), 0);
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(history, args);
      setTimeout(() => window.dispatchEvent(new Event('urlchange')), 0);
    };
    
    window.addEventListener('urlchange', () => {
      setTimeout(() => this.checkPage(), 100);
    });
  }

  async checkPage() {
    try {
      // Clear any existing monitoring
      this.stopMonitoring();
      this.stopIndexingCheck();
      
      const addresses = this.extractAddresses();
      console.log('Found addresses:', addresses);
      
      // Always show indicator, even when no tokens found
      if (addresses.length === 0) {
        this.currentTokenAddress = null;
        this.showIndicator('READY', 'ready');
        return;
      }

      // Get token address once (from first valid address)
      for (const address of addresses) {
        try {
          console.log(`Processing address: ${address}`);
          
          // Get token address from pair (if it's a pair)
          const tokenResult = await this.getTokenAddressWithRetry(address);
          console.log(`Token result for ${address}:`, tokenResult);
          
          if (tokenResult.tokenAddress) {
            this.currentTokenAddress = tokenResult.tokenAddress;
            console.log(`Starting continuous monitoring for token: ${tokenResult.tokenAddress}`);
            
            // Do initial check
            const result = await this.checkTokenAdvertising(tokenResult.tokenAddress);
            console.log(`Initial check result for ${tokenResult.tokenAddress}:`, result);
            
            if (result.hasAds) {
              if (result.status === 'approved') {
                this.showIndicator('PAID', 'paid');
                console.log('Already approved - no monitoring needed');
              } else if (result.status === 'processing') {
                this.showIndicator('PROCESSING', 'processing');
                console.log('Already processing - no monitoring needed');
              } else {
                this.showIndicator('PAID', 'paid');
                console.log('Has advertising - no monitoring needed');
              }
              // No need to start monitoring if already paid/processing
            } else {
              this.showIndicator('UNPAID', 'unpaid');
              // Start continuous monitoring for unpaid tokens
              this.startMonitoring();
            }
            return; // Found a valid token
          } else if (tokenResult.needsIndexing) {
            // This is a brand new pair that needs indexing
            console.log(`Pair ${address} needs indexing - waiting for DexScreener...`);
            this.waitForPairIndexing(address);
            return; // Started indexing check
          }
        } catch (error) {
          console.error('Error processing address:', address, error);
        }
      }
      
      // If we get here, no valid tokens were found
      this.showIndicator('READY', 'ready');
      
    } catch (error) {
      console.error('Error in checkPage:', error);
      // Show indicator anyway to let user know extension is working
      this.showIndicator('READY', 'ready');
    }
  }

  startMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    const intervalMs = (this.settings.monitorInterval || 5) * 1000;
    
    this.checkInterval = setInterval(() => {
      if (this.currentTokenAddress) {
        console.log(`Checking token advertising status: ${this.currentTokenAddress}`);
        this.checkAndUpdateStatus();
      }
    }, intervalMs);
    
    console.log(`Started monitoring - checking every ${this.settings.monitorInterval} seconds (will stop once paid/processing)`);
  }

  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('Stopped monitoring');
    }
  }

  stopIndexingCheck() {
    if (this.indexingInterval) {
      clearInterval(this.indexingInterval);
      this.indexingInterval = null;
      this.currentPairBeingIndexed = null;
      console.log('Stopped indexing check');
    }
  }

  async checkAndUpdateStatus() {
    if (!this.currentTokenAddress) return;
    
    try {
      const result = await this.checkTokenAdvertising(this.currentTokenAddress);
      console.log(`Token ${this.currentTokenAddress} advertising result:`, result);
      
      if (result.hasAds) {
        if (result.status === 'approved') {
          this.showIndicator('PAID', 'paid');
          console.log('Found approved advertising - stopping monitoring');
          this.stopMonitoring();
        } else if (result.status === 'processing') {
          this.showIndicator('PROCESSING', 'processing');
          console.log('Found processing advertising - stopping monitoring');
          this.stopMonitoring();
        } else {
          this.showIndicator('PAID', 'paid');
          console.log('Found advertising (unknown status) - stopping monitoring');
          this.stopMonitoring();
        }
      } else {
        this.showIndicator('UNPAID', 'unpaid');
        // Continue monitoring in case advertising gets purchased
      }
    } catch (error) {
      console.error('Error checking token advertising:', error);
      // Don't change the indicator on errors - keep showing last known state
    }
  }

  extractAddresses() {
    const addresses = new Set();
    const url = window.location.href;
    console.log('Current URL:', url);

    // Extract from URL patterns - these could be pair or token addresses
    const patterns = [
      /axiom\.trade\/meme\/([A-Za-z0-9]{32,44})/,
      /dexscreener\.com\/solana\/([A-Za-z0-9]{32,44})/,
      /pump\.fun\/([A-Za-z0-9]{32,44})/,
      /jupiter\.ag.*[?&]inputMint=([A-Za-z0-9]{32,44})/,
      /jupiter\.ag.*[?&]outputMint=([A-Za-z0-9]{32,44})/
    ];

    patterns.forEach(pattern => {
      const match = url.match(pattern);
      if (match) {
        console.log('Matched pattern:', pattern, 'Address:', match[1]);
        addresses.add(match[1]);
      }
    });

    // Also scan page content for addresses (but limit to avoid too many)
    const pageText = document.body.innerText;
    const addressPattern = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
    const matches = pageText.match(addressPattern) || [];
    
    // Only take first few matches to avoid scanning too many addresses
    matches.slice(0, 5).forEach(match => {
      if (match.length >= 32 && match.length <= 44) {
        addresses.add(match);
      }
    });

    return Array.from(addresses);
  }

  async getTokenAddress(address) {
    // First try to get pair data to extract token address
    try {
      const pairUrl = `${this.pairApiUrl}/${address}`;
      console.log('Trying pair API:', pairUrl);
      
      const response = await fetch(pairUrl);
      if (response.ok) {
        const data = await response.json();
        console.log('Pair API response:', data);
        
        // Check if we got pair data with baseToken
        if (data.pair && data.pair.baseToken && data.pair.baseToken.address) {
          const tokenAddress = data.pair.baseToken.address;
          console.log(`Extracted token address ${tokenAddress} from pair ${address}`);
          return tokenAddress;
        }
        
        if (data.pairs && data.pairs.length > 0 && data.pairs[0].baseToken) {
          const tokenAddress = data.pairs[0].baseToken.address;
          console.log(`Extracted token address ${tokenAddress} from pairs array`);
          return tokenAddress;
        }
      }
    } catch (error) {
      console.log('Failed to get pair data, assuming address is token:', error.message);
    }
    
    // If pair API fails, assume the address is already a token address
    console.log(`Using address ${address} as token address`);
    return address;
  }

  async getTokenAddressWithRetry(address) {
    // First try to get pair data to extract token address
    try {
      const pairUrl = `${this.pairApiUrl}/${address}`;
      console.log('Trying pair API:', pairUrl);
      
      const response = await fetch(pairUrl);
      if (response.ok) {
        const data = await response.json();
        console.log('Pair API response:', data);
        
        // Check if we got pair data with baseToken
        if (data.pair && data.pair.baseToken && data.pair.baseToken.address) {
          const tokenAddress = data.pair.baseToken.address;
          console.log(`Extracted token address ${tokenAddress} from pair ${address}`);
          return { tokenAddress, needsIndexing: false };
        }
        
        if (data.pairs && data.pairs.length > 0 && data.pairs[0].baseToken) {
          const tokenAddress = data.pairs[0].baseToken.address;
          console.log(`Extracted token address ${tokenAddress} from pairs array`);
          return { tokenAddress, needsIndexing: false };
        }
        
        // If we get a response but no pair data, it might be a brand new pair
        console.log('No pair data in response - might be brand new pair needing indexing');
        return { tokenAddress: null, needsIndexing: true };
      }
    } catch (error) {
      console.log('Failed to get pair data:', error.message);
    }
    
    // If pair API fails completely, assume the address is already a token address
    console.log(`Using address ${address} as token address`);
    return { tokenAddress: address, needsIndexing: false };
  }

  waitForPairIndexing(pairAddress) {
    console.log(`Starting indexing check for pair: ${pairAddress}`);
    this.currentPairBeingIndexed = pairAddress; // Track current pair
    this.showIndicator('INDEXING', 'indexing');
    
    // Use settings interval, default to 10 seconds
    const intervalSec = this.settings.indexingInterval || 10;
    const intervalMs = intervalSec * 1000;
    const maxAttempts = Math.ceil(300 / intervalSec); // 5 minutes worth of attempts
    
    let attempts = 0;
    
    this.indexingInterval = setInterval(async () => {
      attempts++;
      console.log(`Indexing check attempt ${attempts}/${maxAttempts} for ${pairAddress}`);
      
      try {
        const tokenResult = await this.getTokenAddressWithRetry(pairAddress);
        
        if (tokenResult.tokenAddress && !tokenResult.needsIndexing) {
          console.log(`Pair ${pairAddress} is now indexed! Token: ${tokenResult.tokenAddress}`);
          this.currentPairBeingIndexed = null;
          this.stopIndexingCheck();
          
          // Now check the token for advertising
          this.currentTokenAddress = tokenResult.tokenAddress;
          const result = await this.checkTokenAdvertising(tokenResult.tokenAddress);
          
          if (result.hasAds) {
            if (result.status === 'approved') {
              this.showIndicator('PAID', 'paid');
            } else if (result.status === 'processing') {
              this.showIndicator('PROCESSING', 'processing');
            } else {
              this.showIndicator('PAID', 'paid');
            }
          } else {
            this.showIndicator('UNPAID', 'unpaid');
            this.startMonitoring(); // Start monitoring for future advertising
          }
          return;
        }
        
        if (attempts >= maxAttempts) {
          console.log(`Gave up waiting for pair ${pairAddress} to be indexed after ${maxAttempts} attempts`);
          this.currentPairBeingIndexed = null;
          this.stopIndexingCheck();
          this.showIndicator('READY', 'ready');
        }
        
      } catch (error) {
        console.error('Error during indexing check:', error);
      }
    }, intervalMs); // Check based on settings
  }

  async checkTokenAdvertising(tokenAddress) {
    const url = `${this.ordersApiUrl}/${tokenAddress}`;
    console.log('Orders API call:', url);
    
    const response = await fetch(url);
    console.log('Orders API response status:', response.status);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const orders = await response.json();
    console.log('Orders API response for', tokenAddress, ':', orders);
    
    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return { hasAds: false, status: 'none' };
    }
    
    // Check if any orders are approved or processing
    const hasApproved = orders.some(order => order.status === 'approved');
    const hasProcessing = orders.some(order => order.status === 'processing');
    
    if (hasApproved) {
      return { hasAds: true, status: 'approved' };
    } else if (hasProcessing) {
      return { hasAds: true, status: 'processing' };
    }
    
    return { hasAds: true, status: 'other' }; // Has orders but unknown status
  }

  showIndicator(text, status) {
    // Update current status for popup communication
    this.currentStatus = status;
    
    // Don't show indicator if disabled or extension is disabled
    if (!this.settings.showIndicator || !this.settings.extensionEnabled) {
      if (this.indicator) {
        this.hideIndicator();
      }
      return;
    }

    if (this.indicator) {
      this.indicator.textContent = text;
      this.indicator.className = `dex-indicator ${status}`;
      return;
    }

    this.indicator = document.createElement('div');
    this.indicator.className = `dex-indicator ${status}`;
    this.indicator.textContent = text;
    
    // Restore saved position or use default
    this.restorePosition();
    
    this.setupDragging(this.indicator);
    this.setupClickHandler(this.indicator);
    document.body.appendChild(this.indicator);
  }

  restorePosition() {
    try {
      const savedPosition = localStorage.getItem('dexIndicatorPosition');
      if (savedPosition) {
        const position = JSON.parse(savedPosition);
        // Make sure saved position is valid (not negative or off-screen)
        const maxX = window.innerWidth - 100; // Account for indicator width
        const maxY = window.innerHeight - 50; // Account for indicator height
        
        const left = Math.max(0, Math.min(maxX, position.left));
        const top = Math.max(0, Math.min(maxY, position.top));
        
        this.indicator.style.setProperty('left', left + 'px', 'important');
        this.indicator.style.setProperty('top', top + 'px', 'important');
        this.indicator.style.setProperty('right', 'auto', 'important');
        this.indicator.style.setProperty('bottom', 'auto', 'important');
        console.log('Restored position:', {left, top});
      } else {
        // Default position (top-right) - calculate from viewport
        const defaultRight = 20;
        const defaultTop = 20;
        const defaultLeft = window.innerWidth - 90 - defaultRight; // 90px estimated width
        
        this.indicator.style.setProperty('left', defaultLeft + 'px', 'important');
        this.indicator.style.setProperty('top', defaultTop + 'px', 'important');
        this.indicator.style.setProperty('right', 'auto', 'important');
        this.indicator.style.setProperty('bottom', 'auto', 'important');
        console.log('Set default position:', {left: defaultLeft, top: defaultTop});
      }
    } catch (error) {
      console.error('Failed to restore position:', error);
      // Fallback to calculated top-right
      const fallbackLeft = window.innerWidth - 110;
      this.indicator.style.setProperty('left', fallbackLeft + 'px', 'important');
      this.indicator.style.setProperty('top', '20px', 'important');
      this.indicator.style.setProperty('right', 'auto', 'important');
      this.indicator.style.setProperty('bottom', 'auto', 'important');
    }
  }

  savePosition() {
    try {
      const rect = this.indicator.getBoundingClientRect();
      const position = {
        left: rect.left,
        top: rect.top
      };
      localStorage.setItem('dexIndicatorPosition', JSON.stringify(position));
      console.log('Saved position:', position);
    } catch (error) {
      console.error('Failed to save position:', error);
    }
  }

  setupDragging(element) {
    let dragTimeout;
    
    element.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      const rect = element.getBoundingClientRect();
      this.dragOffset.x = e.clientX - rect.left;
      this.dragOffset.y = e.clientY - rect.top;
      element.style.setProperty('cursor', 'grabbing', 'important');
      element.style.setProperty('transition', 'none', 'important'); // Disable transitions during drag
      e.preventDefault();
    });

    // Throttled mousemove for better performance
    const throttledMouseMove = (e) => {
      if (!this.isDragging) return;
      
      if (dragTimeout) return;
      dragTimeout = requestAnimationFrame(() => {
        const newX = e.clientX - this.dragOffset.x;
        const newY = e.clientY - this.dragOffset.y;
        
        // Constrain to viewport
        const maxX = window.innerWidth - element.offsetWidth;
        const maxY = window.innerHeight - element.offsetHeight;
        
        element.style.setProperty('left', Math.max(0, Math.min(maxX, newX)) + 'px', 'important');
        element.style.setProperty('top', Math.max(0, Math.min(maxY, newY)) + 'px', 'important');
        element.style.setProperty('right', 'auto', 'important');
        
        dragTimeout = null;
      });
    };

    document.addEventListener('mousemove', throttledMouseMove);

    document.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        element.style.setProperty('cursor', 'grab', 'important');
        element.style.setProperty('transition', 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', 'important'); // Re-enable transitions
        
        // Save the new position
        this.savePosition();
      }
    });
  }

  setupClickHandler(element) {
    let mouseDownTime = 0;
    let mouseDownPos = { x: 0, y: 0 };

    element.addEventListener('mousedown', (e) => {
      mouseDownTime = Date.now();
      mouseDownPos = { x: e.clientX, y: e.clientY };
    });

    element.addEventListener('click', (e) => {
      // Only trigger click if it wasn't a drag operation
      const timeDiff = Date.now() - mouseDownTime;
      const posDiff = Math.sqrt(
        Math.pow(e.clientX - mouseDownPos.x, 2) + 
        Math.pow(e.clientY - mouseDownPos.y, 2)
      );
      
      // If mouse moved less than 5px and was clicked quickly (not dragged)
      if (posDiff < 5 && timeDiff < 300 && !this.isDragging) {
        console.log('Manual update check triggered by click');
        this.performManualUpdate();
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  async performManualUpdate() {
    try {
      // Show updating indicator
      const originalText = this.indicator?.textContent || '';
      const originalStatus = this.indicator?.className || '';
      
      if (this.indicator) {
        this.indicator.textContent = 'UPDATING';
        this.indicator.className = 'dex-indicator updating';
      }

      // Stop any current monitoring
      this.stopMonitoring();
      this.stopIndexingCheck();

      console.log('Performing manual update check...');

      // Re-run the page check logic
      await this.checkPage();
      
      console.log('Manual update check completed');

    } catch (error) {
      console.error('Error during manual update:', error);
      
      // Restore original state on error
      if (this.indicator) {
        this.indicator.textContent = originalText;
        this.indicator.className = originalStatus;
      }
    }
  }
}

// Initialize with error handling
try {
  new AdChecker();
} catch (error) {
  console.error('Failed to initialize DexScreener Ad Checker:', error);
  
  // Show a basic indicator even if initialization fails
  const fallbackIndicator = document.createElement('div');
  fallbackIndicator.innerHTML = 'ERROR';
  fallbackIndicator.style.setProperty('position', 'fixed', 'important');
  fallbackIndicator.style.setProperty('top', '20px', 'important');
  fallbackIndicator.style.setProperty('right', '20px', 'important');
  fallbackIndicator.style.setProperty('left', 'auto', 'important');
  fallbackIndicator.style.setProperty('bottom', 'auto', 'important');
  fallbackIndicator.style.setProperty('padding', '8px 12px', 'important');
  fallbackIndicator.style.setProperty('background', '#ef4444', 'important');
  fallbackIndicator.style.setProperty('color', 'white', 'important');
  fallbackIndicator.style.setProperty('border-radius', '8px', 'important');
  fallbackIndicator.style.setProperty('font-family', 'Arial, sans-serif', 'important');
  fallbackIndicator.style.setProperty('font-size', '12px', 'important');
  fallbackIndicator.style.setProperty('font-weight', 'bold', 'important');
  fallbackIndicator.style.setProperty('z-index', '9999999', 'important');
  fallbackIndicator.style.setProperty('cursor', 'pointer', 'important');
  document.body.appendChild(fallbackIndicator);
}