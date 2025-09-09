class AdminDashboard {
    constructor() {
        this.map = null;
        this.markers = [];
        this.stats = {};
        this.messages = [];
        this.autoRefreshInterval = null;
        
        this.init();
    }
    
    async init() {
        // Verify admin session
        if (!this.verifySession()) {
            window.location.href = '/proadmin/login';
            return;
        }
        
        // Initialize map
        this.initMap();
        
        // Load initial data
        await this.loadStats();
        await this.updateMap();
        await this.updateMessages();
        
        // Set up auto-refresh every 30 seconds
        this.autoRefreshInterval = setInterval(() => {
            this.loadStats();
            this.updateMap();
            this.updateMessages();
        }, 30000);
        
        // Update last updated timestamp
        this.updateTimestamp();
        setInterval(() => this.updateTimestamp(), 1000);
        
        console.log('🛡️ Admin Dashboard initialized');
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
        
        const config = {
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Token': token
            },
            ...options
        };
        
        try {
            const response = await fetch(`/api/admin${endpoint}`, config);
            
            if (response.status === 401) {
                // Session expired
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
    
    initMap() {
        // Initialize Leaflet map
        this.map = L.map('map').setView([39.8283, -98.5795], 4); // Center of USA
        
        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(this.map);
        
        console.log('🗺️ Map initialized');
    }
    
    async loadStats() {
        const stats = await this.apiCall('/stats');
        if (!stats) return;
        
        this.stats = stats;
        
        // Update stat cards
        document.getElementById('totalPosts').textContent = stats.totalPosts || '0';
        document.getElementById('postsLastHour').textContent = stats.postsLastHour || '0';
        document.getElementById('postsLastDay').textContent = stats.postsLastDay || '0';
        document.getElementById('uniqueChannels').textContent = stats.uniqueChannels || '0';
        document.getElementById('uniqueSessions').textContent = stats.uniqueSessions || '0';
        document.getElementById('postsWithImages').textContent = stats.postsWithImages || '0';
    }
    
    async updateMap() {
        const timeFilter = document.getElementById('mapTimeFilter').value;
        const posts = await this.apiCall(`/posts?filter=${timeFilter}&limit=1000`);
        
        if (!posts) return;
        
        // Clear existing markers
        this.markers.forEach(marker => this.map.removeLayer(marker));
        this.markers = [];
        
        // Add new markers
        posts.forEach(post => {
            if (post.latitude && post.longitude) {
                const marker = L.circleMarker([post.latitude, post.longitude], {
                    radius: 6,
                    fillColor: this.getChannelColor(post.channel),
                    color: 'white',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.8
                });
                
                // Create popup content
                const popupContent = `
                    <div style="min-width: 200px;">
                        <strong>${this.escapeHtml(post.displayName)}</strong>
                        ${post.channel ? `<span class="channel-tag">${this.escapeHtml(post.channel)}</span>` : ''}
                        <br><small>${new Date(post.createdAt).toLocaleString()}</small>
                        <hr style="margin: 5px 0;">
                        <div style="max-width: 250px; word-wrap: break-word;">
                            ${this.escapeHtml(post.message)}
                        </div>
                        ${post.image ? '<div style="margin-top: 5px;"><em>📷 Contains image</em></div>' : ''}
                    </div>
                `;
                
                marker.bindPopup(popupContent);
                marker.addTo(this.map);
                this.markers.push(marker);
            }
        });
        
        // Auto-fit bounds if there are markers
        if (this.markers.length > 0) {
            const group = new L.featureGroup(this.markers);
            this.map.fitBounds(group.getBounds().pad(0.1));
        }
        
        console.log(`🗺️ Map updated with ${this.markers.length} markers`);
    }
    
    getChannelColor(channel) {
        if (!channel || channel === '') {
            return '#667eea'; // Default blue for public messages
        }
        
        // Generate consistent color based on channel name
        let hash = 0;
        for (let i = 0; i < channel.length; i++) {
            hash = channel.charCodeAt(i) + ((hash << 5) - hash);
        }
        
        const hue = Math.abs(hash) % 360;
        return `hsl(${hue}, 60%, 50%)`;
    }
    
    async updateMessages() {
        const timeFilter = document.getElementById('messageTimeFilter').value;
        const posts = await this.apiCall(`/posts?filter=${timeFilter}&limit=100`);
        
        if (!posts) {
            document.getElementById('messagesList').innerHTML = 
                '<div class="no-data">Failed to load messages</div>';
            return;
        }
        
        this.messages = posts;
        
        const container = document.getElementById('messagesList');
        
        if (posts.length === 0) {
            container.innerHTML = '<div class="no-data">No messages found for selected time period</div>';
            return;
        }
        
        container.innerHTML = posts.map(post => `
            <div class="message-item" data-id="${post.id}">
                <div class="message-header">
                    <div class="message-info">
                        <strong>${this.escapeHtml(post.displayName)}</strong>
                        ${post.channel ? `<span class="channel-tag">${this.escapeHtml(post.channel)}</span>` : '<span class="channel-tag">Public</span>'}
                    </div>
                    <button class="delete-btn" onclick="dashboard.deleteMessage('${post.id}')">
                        🗑️ Delete
                    </button>
                </div>
                <div class="message-content">
                    ${this.escapeHtml(post.message)}
                    ${post.image ? '<div style="margin-top: 5px; font-style: italic; color: #666;">📷 Contains image attachment</div>' : ''}
                </div>
                <div class="message-meta">
                    <span>📍 ${post.latitude.toFixed(4)}, ${post.longitude.toFixed(4)}</span>
                    <span>${new Date(post.createdAt).toLocaleString()}</span>
                </div>
            </div>
        `).join('');
        
        console.log(`💬 Messages updated: ${posts.length} messages`);
    }
    
    async deleteMessage(messageId) {
        if (!confirm('Are you sure you want to delete this message? This action cannot be undone.')) {
            return;
        }
        
        const result = await this.apiCall(`/messages/${messageId}`, {
            method: 'DELETE'
        });
        
        if (result && result.deleted) {
            // Remove message from UI
            const messageElement = document.querySelector(`[data-id="${messageId}"]`);
            if (messageElement) {
                messageElement.remove();
            }
            
            // Update stats and map
            await this.loadStats();
            await this.updateMap();
            
            console.log(`🗑️ Message deleted: ${messageId}`);
        } else {
            alert('Failed to delete message. Please try again.');
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    updateTimestamp() {
        document.getElementById('lastUpdate').textContent = 
            `Last updated: ${new Date().toLocaleTimeString()}`;
    }
    
    logout() {
        // Clear admin session cookie
        document.cookie = 'adminSession=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        
        // Clear auto-refresh
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
        }
        
        // Redirect to login
        window.location.href = '/proadmin/login';
    }
    
    destroy() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
        }
        
        if (this.map) {
            this.map.remove();
        }
    }
}

// Global functions for HTML event handlers
window.updateMap = () => dashboard.updateMap();
window.updateMessages = () => dashboard.updateMessages();
window.logout = () => dashboard.logout();

// Initialize dashboard when page loads
let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new AdminDashboard();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (dashboard) {
        dashboard.destroy();
    }
});