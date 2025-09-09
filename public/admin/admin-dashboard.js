class AdminDashboard {
    constructor() {
        console.log('🔧 AdminDashboard constructor called');
        this.map = null;
        this.markers = [];
        this.stats = {};
        this.messages = [];
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
        
        // Initialize map
        console.log('🗺️ Initializing map...');
        this.initMap();
        
        // Load initial data
        console.log('📊 Loading initial data...');
        try {
            console.log('📊 Step 1: Loading stats');
            await this.loadStats();
            console.log('📊 Step 2: Loading map');
            await this.updateMap();
            console.log('📊 Step 3: Loading messages');
            await this.updateMessages();
            
            console.log('✅ Initial data loaded successfully');
        } catch (error) {
            console.error('❌ Failed to load initial data:', error);
            console.error('❌ Error stack:', error.stack);
        }
        
        // Set up auto-refresh every 30 seconds
        this.autoRefreshInterval = setInterval(() => {
            console.log('🔄 Auto-refreshing data...');
            this.loadStats();
            this.updateMap();
            this.updateMessages();
        }, 30000);
        
        // Update last updated timestamp
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
            credentials: 'include', // Ensure cookies are sent
            ...options
        };
        
        try {
            console.log(`Making API call: /api/admin${endpoint}`);
            const response = await fetch(`/api/admin${endpoint}`, config);
            
            if (response.status === 401) {
                console.error('Session expired or unauthorized');
                this.logout();
                return null;
            }
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`API Error ${response.status}:`, errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            console.log(`API call successful: /api/admin${endpoint}`, result);
            return result;
        } catch (error) {
            console.error(`API call failed: ${endpoint}`, error);
            return null;
        }
    }
    
    initMap() {
        // Initialize Leaflet map with proper zoom behavior
        this.map = L.map('map', {
            scrollWheelZoom: 'center', // Prevents marker drift during wheel zoom
            zoomAnimation: true,
            markerZoomAnimation: true
        }).setView([39.8283, -98.5795], 4); // Center of USA
        
        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(this.map);
        
        console.log('🗺️ Map initialized with proper zoom behavior');
    }
    
    async loadStats() {
        console.log('📊 Loading stats...');
        const stats = await this.apiCall('/stats');
        console.log('📊 Stats received:', stats);
        
        if (!stats) {
            console.log('❌ No stats returned from API');
            return;
        }
        
        this.stats = stats;
        
        // Update stat cards with debugging
        console.log('📊 Updating stat cards...');
        const elements = {
            totalPosts: document.getElementById('totalPosts'),
            postsLastHour: document.getElementById('postsLastHour'), 
            postsLastDay: document.getElementById('postsLastDay'),
            uniqueChannels: document.getElementById('uniqueChannels'),
            uniqueSessions: document.getElementById('uniqueSessions'),
            postsWithImages: document.getElementById('postsWithImages')
        };
        
        // Check if elements exist
        for (const [key, element] of Object.entries(elements)) {
            if (!element) {
                console.error(`❌ Element not found: ${key}`);
            } else {
                const value = stats[key] || '0';
                console.log(`📊 Setting ${key} to ${value}`);
                element.textContent = value;
            }
        }
        
        console.log('📊 Stats update complete');
    }
    
    async updateMap() {
        const timeFilter = document.getElementById('mapTimeFilter').value;
        const posts = await this.apiCall(`/posts?filter=${timeFilter}&limit=1000`);
        
        if (!posts) return;
        
        // Clear existing markers
        this.markers.forEach(marker => this.map.removeLayer(marker));
        this.markers = [];
        
        // Add new markers with proper iconAnchor to prevent drift
        posts.forEach(post => {
            if (post.latitude && post.longitude) {
                // Create custom colored icon with proper anchor point
                const markerColor = this.getChannelColor(post.channel);
                const customIcon = L.divIcon({
                    className: 'custom-map-marker',
                    html: `<div style="
                        width: 16px;
                        height: 16px;
                        background-color: ${markerColor};
                        border: 2px solid white;
                        border-radius: 50%;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    "></div>`,
                    iconSize: [16, 16],
                    iconAnchor: [8, 8], // Center the marker properly - this prevents drift!
                    popupAnchor: [0, -8]
                });
                
                const marker = L.marker([post.latitude, post.longitude], {
                    icon: customIcon
                });
                
                // Create popup content
                const popupContent = `
                    <div style="min-width: 200px; max-width: 300px;">
                        <strong>${this.escapeHtml(post.displayName)}</strong>
                        ${post.channel ? `<span class="channel-tag">${this.escapeHtml(post.channel)}</span>` : ''}
                        <br><small>${new Date(post.createdAt).toLocaleString()}</small>
                        <hr style="margin: 5px 0;">
                        <div style="max-width: 250px; word-wrap: break-word; margin-bottom: 8px;">
                            ${this.escapeHtml(post.message)}
                        </div>
                        ${post.image ? `
                            <div style="margin-top: 8px;">
                                <img 
                                    src="${post.image}" 
                                    alt="Message image"
                                    style="
                                        max-width: 150px;
                                        max-height: 100px;
                                        border-radius: 6px;
                                        cursor: pointer;
                                        object-fit: cover;
                                        border: 1px solid #ddd;
                                    "
                                    onclick="dashboard.showImageModal('${post.image}', '${this.escapeHtml(post.displayName)}', '${this.escapeHtml(post.message)}')"
                                />
                                <div style="font-size: 10px; color: #666; text-align: center; margin-top: 2px;">
                                    Click to view full size
                                </div>
                            </div>
                        ` : ''}
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
                    ${post.image ? `
                        <div class="image-attachment" style="margin-top: 10px;">
                            <img 
                                src="${post.image}" 
                                alt="Message attachment"
                                class="message-thumbnail"
                                style="
                                    max-width: 200px;
                                    max-height: 150px;
                                    border-radius: 8px;
                                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                                    cursor: pointer;
                                    object-fit: cover;
                                    border: 2px solid #e1e5e9;
                                    transition: transform 0.2s, box-shadow 0.2s;
                                "
                                onclick="dashboard.showImageModal('${post.image}', '${this.escapeHtml(post.displayName)}', '${this.escapeHtml(post.message)}')"
                                onmouseover="this.style.transform='scale(1.02)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.2)'"
                                onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'"
                                loading="lazy"
                            />
                            <div style="font-size: 11px; color: #666; margin-top: 4px;">
                                📷 Click to view full size
                            </div>
                        </div>
                    ` : ''}
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
    
    showImageModal(imageSrc, displayName, message) {
        // Create modal overlay
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
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        
        // Create modal content
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            max-width: 90vw;
            max-height: 90vh;
            background: white;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            position: relative;
            cursor: default;
        `;
        
        modalContent.innerHTML = `
            <div style="margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
                <div style="font-weight: bold; color: #333; margin-bottom: 5px;">
                    📷 Image from ${this.escapeHtml(displayName)}
                </div>
                <div style="font-size: 14px; color: #666; word-wrap: break-word;">
                    "${this.escapeHtml(message)}"
                </div>
            </div>
            
            <img 
                src="${imageSrc}" 
                alt="Full size image"
                style="
                    max-width: 100%;
                    max-height: 70vh;
                    border-radius: 8px;
                    display: block;
                    margin: 0 auto;
                    object-fit: contain;
                "
            />
            
            <div style="text-align: center; margin-top: 15px;">
                <button 
                    onclick="this.closest('.image-modal').remove()"
                    style="
                        background: #f44336;
                        color: white;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 14px;
                        margin-right: 10px;
                    "
                >
                    ✕ Close
                </button>
                <button 
                    onclick="dashboard.downloadImage('${imageSrc}', '${this.escapeHtml(displayName)}')"
                    style="
                        background: #4CAF50;
                        color: white;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 14px;
                    "
                >
                    💾 Download
                </button>
            </div>
        `;
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        // Animate in
        setTimeout(() => {
            modal.style.opacity = '1';
        }, 10);
        
        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.opacity = '0';
                setTimeout(() => modal.remove(), 300);
            }
        });
        
        // Close on Escape key
        const handleKeyPress = (e) => {
            if (e.key === 'Escape') {
                modal.style.opacity = '0';
                setTimeout(() => modal.remove(), 300);
                document.removeEventListener('keydown', handleKeyPress);
            }
        };
        document.addEventListener('keydown', handleKeyPress);
        
        // Prevent content click from closing modal
        modalContent.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    downloadImage(imageSrc, displayName) {
        try {
            const link = document.createElement('a');
            link.href = imageSrc;
            link.download = `groupdeedo-image-${displayName}-${new Date().getTime()}.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            this.showNotification('Image download started!', 'success');
        } catch (error) {
            console.error('Download failed:', error);
            this.showNotification('Download failed. You can right-click the image to save it.', 'error');
        }
    }
    
    updateTimestamp() {
        document.getElementById('lastUpdate').textContent = 
            `Last updated: ${new Date().toLocaleTimeString()}`;
    }
    
    logout() {
        console.log('Logging out admin user');
        
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

// Initialize dashboard when script loads (called by HTML after Leaflet is ready)
let dashboard;
console.log('🔧 Dashboard script executing');
dashboard = new AdminDashboard();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (dashboard) {
        dashboard.destroy();
    }
});