class AdminDashboard {
    constructor() {
        console.log('🔧 AdminDashboard constructor called');
        this.stats = {};
        this.messages = [];
        this.channels = [];
        this.selectedChannel = 'all';
        this.autoRefreshInterval = null;
        
        this.init();
    }
    
    async init() {
        console.log('🛡️ Initializing Admin Dashboard...');
        
        // Verify admin session
        const token = this.getAdminToken();
        console.log('Admin token found:', !!token);
        
        if (!this.verifySession()) {
            console.log('No valid session, redirecting to login');
            window.location.href = '/proadmin/login';
            return;
        }
        
        // Load initial data
        console.log('📊 Loading initial data...');
        try {
            await this.loadStats();
            await this.loadSystemInfo();
            await this.updateChannels();
            await this.updateMessages();
            
            console.log('✅ Initial data loaded successfully');
        } catch (error) {
            console.error('❌ Failed to load initial data:', error);
        }
        
        // Set up auto-refresh every 30 seconds
        this.autoRefreshInterval = setInterval(() => {
            console.log('🔄 Auto-refreshing data...');
            this.loadStats();
            this.loadSystemInfo();
            this.updateChannels();
            this.updateMessages();
        }, 30000);
        
        // Update timestamp
        this.updateTimestamp();
        setInterval(() => this.updateTimestamp(), 1000);
        
        console.log('🛡️ Admin Dashboard initialized successfully');
    }
    
    verifySession() {
        const token = this.getAdminToken();
        return token && token.length > 0;
    }
    
    getAdminToken() {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'adminSession') {
                return value;
            }
        }
        return null;
    }
    
    async apiCall(endpoint, options = {}) {
        const token = this.getAdminToken();
        
        if (!token) {
            console.error('No admin token found');
            this.logout();
            return null;
        }
        
        const config = {
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Token': token
            },
            credentials: 'include',
            ...options
        };
        
        try {
            const response = await fetch(`/api/admin${endpoint}`, config);
            
            if (response.status === 401) {
                console.error('Session expired or unauthorized');
                this.logout();
                return null;
            }
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`API call failed: ${endpoint}`, error);
            return null;
        }
    }
    
    async loadStats() {
        const stats = await this.apiCall('/stats');
        
        if (!stats) return;
        
        this.stats = stats;
        
        // Update stat cards
        const elements = {
            totalPosts: document.getElementById('totalPosts'),
            postsLastHour: document.getElementById('postsLastHour'), 
            postsLastDay: document.getElementById('postsLastDay'),
            uniqueChannels: document.getElementById('uniqueChannels'),
            uniqueSessions: document.getElementById('uniqueSessions'),
            postsWithImages: document.getElementById('postsWithImages')
        };
        
        for (const [key, element] of Object.entries(elements)) {
            if (element) {
                element.textContent = stats[key] || '0';
            }
        }
    }
    
    async loadSystemInfo() {
        const systemInfo = await this.apiCall('/system');
        
        if (!systemInfo) return;
        
        // Update system stats
        const uptimeEl = document.getElementById('serverUptime');
        const connectionsEl = document.getElementById('activeConnections');
        const memoryEl = document.getElementById('memoryUsage');
        const nodeEl = document.getElementById('nodeVersion');
        
        if (uptimeEl) {
            uptimeEl.textContent = this.formatUptime(systemInfo.server?.uptime || 0);
        }
        
        if (connectionsEl) {
            connectionsEl.textContent = systemInfo.application?.activeUsers || 0;
        }
        
        if (memoryEl) {
            const memMB = Math.round((systemInfo.server?.memory?.heapUsed || 0) / 1024 / 1024);
            memoryEl.textContent = memMB;
        }
        
        if (nodeEl) {
            nodeEl.textContent = systemInfo.server?.nodeVersion || '--';
        }
    }
    
    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    }
    
    async updateChannels() {
        const timeFilter = document.getElementById('messageTimeFilter')?.value || 'day';
        const posts = await this.apiCall(`/posts?filter=${timeFilter}&limit=1000`);
        
        if (!posts) return;
        
        // Count messages per channel
        const channelCounts = {};
        const channelImages = {};
        
        posts.forEach(post => {
            const channel = post.channel || 'Public';
            channelCounts[channel] = (channelCounts[channel] || 0) + 1;
            if (post.image) {
                channelImages[channel] = (channelImages[channel] || 0) + 1;
            }
        });
        
        // Sort by message count
        this.channels = Object.entries(channelCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({
                name,
                messageCount: count,
                imageCount: channelImages[name] || 0
            }));
        
        // Render channel list
        const container = document.getElementById('channelList');
        
        if (this.channels.length === 0) {
            container.innerHTML = '<div class="no-data">No channels found</div>';
            return;
        }
        
        container.innerHTML = this.channels.map(channel => `
            <div class="channel-item ${this.selectedChannel === channel.name ? 'active' : ''}" 
                 onclick="dashboard.selectChannel('${this.escapeHtml(channel.name)}')">
                <div class="channel-name">
                    <span class="icon">📻</span>
                    <span>${this.escapeHtml(channel.name)}</span>
                </div>
                <div class="channel-stats">
                    <span class="channel-stat">💬 ${channel.messageCount}</span>
                    ${channel.imageCount > 0 ? `<span class="channel-stat">📷 ${channel.imageCount}</span>` : ''}
                </div>
            </div>
        `).join('');
        
        // Update filter tabs
        this.updateFilterTabs();
    }
    
    updateFilterTabs() {
        const container = document.getElementById('channelFilterTabs');
        
        let tabs = `<span class="filter-tab ${this.selectedChannel === 'all' ? 'active' : ''}" 
                         onclick="dashboard.filterByChannel('all')">All</span>`;
        
        // Add top 5 channels as tabs
        this.channels.slice(0, 5).forEach(channel => {
            const isActive = this.selectedChannel === channel.name ? 'active' : '';
            tabs += `<span class="filter-tab ${isActive}" 
                          onclick="dashboard.filterByChannel('${this.escapeHtml(channel.name)}')">${this.escapeHtml(channel.name)}</span>`;
        });
        
        container.innerHTML = tabs;
    }
    
    selectChannel(channelName) {
        this.selectedChannel = channelName;
        this.updateChannels();
        this.updateMessages();
    }
    
    filterByChannel(channelName) {
        this.selectedChannel = channelName;
        this.updateFilterTabs();
        this.updateChannels();
        this.updateMessages();
    }
    
    async updateMessages() {
        const timeFilter = document.getElementById('messageTimeFilter')?.value || 'day';
        const posts = await this.apiCall(`/posts?filter=${timeFilter}&limit=100`);
        
        if (!posts) {
            document.getElementById('messagesList').innerHTML = 
                '<div class="no-data">Failed to load messages</div>';
            return;
        }
        
        // Filter by selected channel
        let filteredPosts = posts;
        if (this.selectedChannel !== 'all') {
            filteredPosts = posts.filter(post => {
                const postChannel = post.channel || 'Public';
                return postChannel === this.selectedChannel;
            });
        }
        
        this.messages = filteredPosts;
        
        const container = document.getElementById('messagesList');
        
        if (filteredPosts.length === 0) {
            container.innerHTML = '<div class="no-data">No messages found</div>';
            return;
        }
        
        container.innerHTML = filteredPosts.map(post => `
            <div class="message-item" data-id="${post.id}">
                <div class="message-header">
                    <div class="message-info">
                        <span class="message-author">${this.escapeHtml(post.displayName)}</span>
                        <span class="channel-tag">${this.escapeHtml(post.channel || 'Public')}</span>
                    </div>
                    <button class="delete-btn" onclick="dashboard.deleteMessage('${post.id}')">
                        🗑️ Delete
                    </button>
                </div>
                <div class="message-content">
                    ${this.escapeHtml(post.message)}
                </div>
                ${post.image ? `
                    <div class="image-attachment">
                        <img 
                            src="${post.image}" 
                            alt="Message attachment"
                            class="message-thumbnail"
                            style="max-width: 200px; max-height: 150px; cursor: pointer; object-fit: cover;"
                            onclick="dashboard.showImageModal('${post.image}', '${this.escapeHtml(post.displayName)}', '${this.escapeHtml(post.message)}')"
                            loading="lazy"
                        />
                        <div style="font-size: 11px; color: #888; margin-top: 4px;">📷 Click to view</div>
                    </div>
                ` : ''}
                <div class="message-meta">
                    <span>${new Date(post.createdAt).toLocaleString()}</span>
                    <span class="vote-stats">
                        👍 ${post.upvotes || 0} &nbsp; 👎 ${post.downvotes || 0}
                    </span>
                </div>
            </div>
        `).join('');
    }
    
    async deleteMessage(messageId) {
        if (!confirm('Are you sure you want to delete this message?')) {
            return;
        }
        
        const result = await this.apiCall(`/messages/${messageId}`, {
            method: 'DELETE'
        });
        
        if (result && result.deleted) {
            const messageElement = document.querySelector(`[data-id="${messageId}"]`);
            if (messageElement) {
                messageElement.style.opacity = '0';
                messageElement.style.transform = 'translateX(-20px)';
                setTimeout(() => messageElement.remove(), 300);
            }
            
            await this.loadStats();
            await this.updateChannels();
            
            this.showNotification('Message deleted', 'success');
        } else {
            this.showNotification('Failed to delete message', 'error');
        }
    }
    
    showImageModal(imageSrc, displayName, message) {
        const modal = document.createElement('div');
        modal.className = 'image-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            cursor: pointer;
        `;
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            max-width: 90vw;
            max-height: 90vh;
            background: #3a3d45;
            border-radius: 12px;
            padding: 20px;
            cursor: default;
        `;
        
        modalContent.innerHTML = `
            <div style="margin-bottom: 15px; border-bottom: 1px solid #5a5d65; padding-bottom: 10px;">
                <div style="font-weight: bold; color: #fff; margin-bottom: 5px;">
                    📷 Image from ${this.escapeHtml(displayName)}
                </div>
                <div style="font-size: 14px; color: #B0B3B8; word-wrap: break-word;">
                    "${this.escapeHtml(message)}"
                </div>
            </div>
            
            <img 
                src="${imageSrc}" 
                alt="Full size image"
                style="max-width: 100%; max-height: 70vh; border-radius: 8px; display: block; margin: 0 auto;"
            />
            
            <div style="text-align: center; margin-top: 15px;">
                <button onclick="this.closest('.image-modal').remove()"
                    style="background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; margin-right: 10px;">
                    ✕ Close
                </button>
                <button onclick="dashboard.downloadImage('${imageSrc}', '${this.escapeHtml(displayName)}')"
                    style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">
                    💾 Download
                </button>
            </div>
        `;
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        document.addEventListener('keydown', function handler(e) {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', handler);
            }
        });
        
        modalContent.addEventListener('click', e => e.stopPropagation());
    }
    
    downloadImage(imageSrc, displayName) {
        try {
            const link = document.createElement('a');
            link.href = imageSrc;
            link.download = `groupdeedo-${displayName}-${Date.now()}.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            this.showNotification('Download started', 'success');
        } catch (error) {
            this.showNotification('Download failed', 'error');
        }
    }
    
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 10001;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transform: translateX(100%);
            transition: transform 0.3s ease;
            background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8'};
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => notification.style.transform = 'translateX(0)', 10);
        
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    updateTimestamp() {
        const el = document.getElementById('lastUpdate');
        if (el) {
            el.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
        }
    }
    
    logout() {
        document.cookie = 'adminSession=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
        }
        
        window.location.href = '/proadmin/login';
    }
    
    destroy() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
        }
    }
}

// Global functions for HTML event handlers
window.updateChannels = () => dashboard.updateChannels();
window.updateMessages = () => dashboard.updateMessages();
window.logout = () => dashboard.logout();

// Initialize dashboard
let dashboard;
console.log('🔧 Dashboard script loading');
dashboard = new AdminDashboard();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (dashboard) {
        dashboard.destroy();
    }
});
