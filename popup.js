// DexCheckX Popup Script
class PopupManager {
  constructor() {
    this.defaultSettings = {
      extensionEnabled: true,
      showIndicator: true,
      showTwitterInfo: true,
      monitorInterval: 5,
      indexingInterval: 10
    };
    
    this.saveTimeout = null; // For debouncing settings saves
    
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupEventListeners();
    this.updateStatus();
    
    // Update status periodically
    setInterval(() => this.updateStatus(), 2000);
  }

  async loadSettings() {
    try {
      console.log('Loading settings...');
      
      // Check if chrome.storage is available
      if (!chrome || !chrome.storage || !chrome.storage.sync) {
        console.error('Chrome storage API not available');
        return;
      }
      
      const result = await chrome.storage.sync.get(this.defaultSettings);
      console.log('Raw storage result:', result);
      
      // Update UI elements with validation
      const extensionEnabledEl = document.getElementById('extension-enabled');
      const showIndicatorEl = document.getElementById('show-indicator');
      const showTwitterInfoEl = document.getElementById('show-twitter-info');
      const monitorIntervalEl = document.getElementById('monitor-interval');
      const indexingIntervalEl = document.getElementById('indexing-interval');
      
      if (extensionEnabledEl) {
        extensionEnabledEl.checked = result.extensionEnabled !== false; // default true
        console.log('Set extension-enabled to:', extensionEnabledEl.checked);
      }
      
      if (showIndicatorEl) {
        showIndicatorEl.checked = result.showIndicator !== false; // default true
        console.log('Set show-indicator to:', showIndicatorEl.checked);
      }
      
      if (showTwitterInfoEl) {
        showTwitterInfoEl.checked = result.showTwitterInfo !== false; // default true
        console.log('Set show-twitter-info to:', showTwitterInfoEl.checked);
      }
      
      if (monitorIntervalEl) {
        monitorIntervalEl.value = result.monitorInterval || 5;
        console.log('Set monitor-interval to:', monitorIntervalEl.value);
      }
      
      if (indexingIntervalEl) {
        indexingIntervalEl.value = result.indexingInterval || 10;
        console.log('Set indexing-interval to:', indexingIntervalEl.value);
      }
      
      console.log('Successfully loaded settings:', result);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async saveSettings() {
    try {
      console.log('Saving settings...');
      
      // Check if chrome.storage is available
      if (!chrome || !chrome.storage || !chrome.storage.sync) {
        console.error('Chrome storage API not available for saving');
        return;
      }
      
      const settings = {
        extensionEnabled: document.getElementById('extension-enabled')?.checked ?? true,
        showIndicator: document.getElementById('show-indicator')?.checked ?? true,
        showTwitterInfo: document.getElementById('show-twitter-info')?.checked ?? true,
        monitorInterval: parseInt(document.getElementById('monitor-interval')?.value || '5'),
        indexingInterval: parseInt(document.getElementById('indexing-interval')?.value || '10')
      };
      
      console.log('Settings to save:', settings);

      await chrome.storage.sync.set(settings);
      console.log('Settings saved to chrome.storage');
      
      // Notify content script of settings change
      await this.notifyContentScript('settingsChanged', settings);
      console.log('Notified content script of settings change');
      
    } catch (error) {
      console.error('Failed to save settings:', error);
      console.error('Error details:', error.message, error.stack);
    }
  }

  setupEventListeners() {
    console.log('Setting up event listeners...');
    
    // Settings change handlers
    const settingElements = [
      'extension-enabled',
      'show-indicator',
      'show-twitter-info',
      'monitor-interval',
      'indexing-interval'
    ];

    settingElements.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        const eventType = element.type === 'checkbox' ? 'change' : 'input';
        console.log(`Adding ${eventType} listener to ${id}`);
        
        element.addEventListener(eventType, (e) => {
          console.log(`Settings change detected: ${id} = ${element.type === 'checkbox' ? element.checked : element.value}`);
          
          // Validate number inputs
          if (element.type === 'number') {
            const min = parseInt(element.min);
            const max = parseInt(element.max);
            const value = parseInt(element.value);
            
            if (value < min) {
              element.value = min;
              console.log(`Clamped ${id} to minimum: ${min}`);
            }
            if (value > max) {
              element.value = max;
              console.log(`Clamped ${id} to maximum: ${max}`);
            }
          }
          
          // Add small delay to debounce rapid changes
          clearTimeout(this.saveTimeout);
          this.saveTimeout = setTimeout(() => {
            this.saveSettings();
          }, 300);
        });
      } else {
        console.warn(`Element with id '${id}' not found`);
      }
    });

    // Action button handlers
    document.getElementById('refresh-status').addEventListener('click', () => {
      this.refreshStatus();
    });

    document.getElementById('reset-position').addEventListener('click', () => {
      this.resetIndicatorPosition();
    });

    // Link handlers
    document.getElementById('help-link').addEventListener('click', (e) => {
      e.preventDefault();
      this.showHelp();
    });

    document.getElementById('about-link').addEventListener('click', (e) => {
      e.preventDefault();
      this.showAbout();
    });
  }

  async updateStatus() {
    try {
      // Get current tab to check if extension is active
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) return;
      
      const isActiveTab = this.isActiveTab(tab.url);
      const statusElement = document.getElementById('current-status');
      const tokenElement = document.getElementById('current-token');
      
      if (!isActiveTab) {
        statusElement.textContent = 'Inactive';
        statusElement.className = 'status-value inactive';
        tokenElement.textContent = 'Not on supported site';
        tokenElement.className = 'status-value none';
        return;
      }

      // Get settings to check if extension is enabled
      const settings = await chrome.storage.sync.get(this.defaultSettings);
      
      if (!settings.extensionEnabled) {
        statusElement.textContent = 'Disabled';
        statusElement.className = 'status-value inactive';
        tokenElement.textContent = 'Extension disabled';
        tokenElement.className = 'status-value none';
        return;
      }

      // Try to get status from content script
      try {
        const response = await this.sendToContentScript('getStatus');
        
        if (response && response.status) {
          statusElement.textContent = this.formatStatus(response.status);
          statusElement.className = `status-value ${this.getStatusClass(response.status)}`;
          
          if (response.tokenAddress) {
            const shortAddress = this.truncateAddress(response.tokenAddress);
            tokenElement.textContent = shortAddress;
            tokenElement.className = 'status-value';
          } else {
            tokenElement.textContent = 'None detected';
            tokenElement.className = 'status-value none';
          }
        } else {
          statusElement.textContent = 'Active';
          statusElement.className = 'status-value active';
          tokenElement.textContent = 'Monitoring...';
          tokenElement.className = 'status-value';
        }
      } catch (error) {
        statusElement.textContent = 'Active';
        statusElement.className = 'status-value active';
        tokenElement.textContent = 'Monitoring...';
        tokenElement.className = 'status-value';
      }
      
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  }

  isActiveTab(url) {
    const supportedSites = [
      'axiom.trade',
      'dexscreener.com',
      'pump.fun',
      'jupiter.ag'
    ];
    
    return supportedSites.some(site => url.includes(site));
  }

  formatStatus(status) {
    const statusMap = {
      'paid': 'Paid',
      'unpaid': 'Unpaid', 
      'processing': 'Processing',
      'ready': 'Ready',
      'indexing': 'Indexing',
      'updating': 'Updating'
    };
    
    return statusMap[status] || status;
  }

  getStatusClass(status) {
    const classMap = {
      'paid': 'active',
      'unpaid': 'inactive',
      'processing': 'active', 
      'ready': 'active',
      'indexing': 'active',
      'updating': 'active'
    };
    
    return classMap[status] || 'none';
  }

  truncateAddress(address) {
    if (!address || address.length < 8) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }

  async refreshStatus() {
    const button = document.getElementById('refresh-status');
    const originalText = button.innerHTML;
    
    // Show loading state
    button.innerHTML = '<span class="button-icon">⟳</span>Refreshing...';
    button.disabled = true;
    
    try {
      // Trigger manual update in content script
      await this.notifyContentScript('refreshStatus');
      
      // Update local status
      await this.updateStatus();
      
      // Brief delay to show feedback
      setTimeout(() => {
        button.innerHTML = originalText;
        button.disabled = false;
      }, 1000);
      
    } catch (error) {
      console.error('Failed to refresh status:', error);
      button.innerHTML = originalText;
      button.disabled = false;
    }
  }

  async resetIndicatorPosition() {
    const button = document.getElementById('reset-position');
    const originalText = button.innerHTML;
    
    button.innerHTML = '<span class="button-icon">⌖</span>Resetting...';
    button.disabled = true;
    
    try {
      // Clear stored position
      localStorage.removeItem('dexIndicatorPosition');
      
      // Notify content script to reset position
      await this.notifyContentScript('resetPosition');
      
      setTimeout(() => {
        button.innerHTML = originalText;
        button.disabled = false;
      }, 500);
      
    } catch (error) {
      console.error('Failed to reset position:', error);
      button.innerHTML = originalText;
      button.disabled = false;
    }
  }

  async sendToContentScript(action, data = {}) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return null;
      
      return await chrome.tabs.sendMessage(tab.id, { action, ...data });
    } catch (error) {
      console.error('Failed to communicate with content script:', error);
      return null;
    }
  }

  async notifyContentScript(action, data = {}) {
    try {
      console.log(`Notifying content script: ${action}`, data);
      const response = await this.sendToContentScript(action, data);
      console.log('Content script response:', response);
      return response;
    } catch (error) {
      // Log but don't fail - content script might not be loaded
      console.log('Content script not available for notification:', action, error.message);
      return null;
    }
  }

  showHelp() {
    alert(`DexCheckX Help

This extension monitors crypto tokens on supported sites and shows if they have paid for DexScreener advertising.

Status Indicators:
• PAID (Green) - Token has active advertising
• UNPAID (Red) - No advertising detected
• PROCESSING (Yellow) - Advertising being processed
• READY (Purple) - Extension ready, no token detected
• INDEXING (Blue) - Waiting for new pair to be indexed

Settings:
• Extension Enabled - Turn monitoring on/off
• Show Indicator - Hide/show floating indicator
• Show Twitter Info - Display Twitter usernames on axiom.trade
• Monitor Interval - How often to check API (1-60 seconds)
• Indexing Interval - Check frequency for new pairs (5-120 seconds)

The floating indicator can be dragged to any position on the page.`);
  }

  showAbout() {
    alert(`DexCheckX v1.0

A browser extension that monitors DexScreener advertising payments for crypto tokens.

Supported Sites:
• Axiom.trade
• DexScreener.com  
• Pump.fun
• Jupiter.ag

Created to help traders identify tokens with paid promotion on DexScreener.

© 2024 DexCheckX`);
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM Content Loaded, initializing PopupManager...');
  try {
    new PopupManager();
  } catch (error) {
    console.error('Failed to initialize PopupManager:', error);
  }
});

// Also try immediate initialization in case DOM is already loaded
if (document.readyState === 'loading') {
  console.log('Document still loading, waiting for DOMContentLoaded...');
} else {
  console.log('Document already loaded, initializing PopupManager immediately...');
  try {
    new PopupManager();
  } catch (error) {
    console.error('Failed to initialize PopupManager immediately:', error);
  }
}

// Handle chrome extension context
if (typeof chrome !== 'undefined' && chrome.runtime) {
  // Extension context - normal initialization
} else {
  // Fallback for development/testing
  console.warn('Chrome extension APIs not available');
}
