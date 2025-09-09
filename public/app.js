class GroupdeedoApp {
    constructor() {
        this.socket = null;
        this.userSettings = {
            displayName: 'Anonymous',
            latitude: null,
            longitude: null,
            radius: 5, // Default changed to 5 miles
            channel: ''
        };
        this.isConnected = false;
        this.hasAgreedToTos = false;
        this.watchPositionId = null;
        
        // Load saved user settings from localStorage
        this.loadUserSettings();
        
        this.init();
    }
    
    init() {
        this.checkTosAgreement();
        this.setupEventListeners();
        this.setupAutoResize();
        
        // Parse URL parameters for channel sharing
        this.parseUrlParams();
        
        // Initialize settings UI with loaded values
        this.initializeSettingsUI();
    }
    
    loadUserSettings() {
        try {
            const savedSettings = localStorage.getItem('groupdeedo_user_settings');
            if (savedSettings) {
                const parsedSettings = JSON.parse(savedSettings);
                
                // Only restore non-location settings (location is always fresh)
                if (parsedSettings.displayName) {
                    this.userSettings.displayName = parsedSettings.displayName;
                }
                if (parsedSettings.radius && parsedSettings.radius >= 1 && parsedSettings.radius <= 500) {
                    this.userSettings.radius = parsedSettings.radius;
                }
                if (parsedSettings.channel !== undefined) {
                    this.userSettings.channel = parsedSettings.channel;
                }
                
                console.log('Loaded user settings:', this.userSettings);
            }
        } catch (error) {
            console.warn('Failed to load user settings from localStorage:', error);
        }
    }
    
    saveUserSettings() {
        try {
            // Only save persistent settings (not location data for privacy)
            const settingsToSave = {
                displayName: this.userSettings.displayName,
                radius: this.userSettings.radius,
                channel: this.userSettings.channel
            };
            
            localStorage.setItem('groupdeedo_user_settings', JSON.stringify(settingsToSave));
            console.log('Saved user settings:', settingsToSave);
        } catch (error) {
            console.warn('Failed to save user settings to localStorage:', error);
        }
    }
    
    initializeSettingsUI() {
        // Set initial form values to match loaded settings
        document.getElementById('displayName').value = this.userSettings.displayName;
        document.getElementById('radiusSlider').value = this.userSettings.radius;
        document.getElementById('radiusValue').textContent = this.userSettings.radius;
        document.getElementById('channelName').value = this.userSettings.channel;
        this.toggleShareButton();
    }
    
    checkTosAgreement() {
        // Check if user has already agreed to TOS
        const agreed = localStorage.getItem('groupdeedo_tos_agreed');
        if (agreed === 'true') {
            this.hasAgreedToTos = true;
            this.showApp();
            this.requestLocation();
            this.connectSocket();
        } else {
            this.showTosModal();
        }
    }
    
    showTosModal() {
        document.getElementById('tosModal').style.display = 'flex';
        document.getElementById('loadingOverlay').style.display = 'none';
    }
    
    hideTosModal() {
        document.getElementById('tosModal').style.display = 'none';
    }
    
    showApp() {
        document.getElementById('app').style.display = 'flex';
        document.getElementById('loadingOverlay').style.display = 'none';
        this.hideTosModal();
    }
    
    parseUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const channelParam = urlParams.get('channel');
        if (channelParam) {
            this.userSettings.channel = channelParam;
            // Update the channel input when app loads
            setTimeout(() => {
                document.getElementById('channelName').value = channelParam;
            }, 100);
        }
    }
    
    setupEventListeners() {
        // TOS Agreement
        document.getElementById('agreeTos').addEventListener('click', () => {
            localStorage.setItem('groupdeedo_tos_agreed', 'true');
            this.hasAgreedToTos = true;
            this.showApp();
            this.requestLocation();
            this.connectSocket();
        });
        
        // Settings
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.openSettings();
        });
        
        document.getElementById('closeSettings').addEventListener('click', () => {
            this.closeSettings();
        });
        
        // Settings inputs (throttled to prevent excessive updates)
        let settingsUpdateTimeout = null;
        
        const throttledUpdateSettings = () => {
            clearTimeout(settingsUpdateTimeout);
            settingsUpdateTimeout = setTimeout(() => {
                this.updateSettings();
            }, 500); // Wait 500ms after user stops changing settings
        };
        
        document.getElementById('displayName').addEventListener('input', (e) => {
            this.userSettings.displayName = e.target.value || 'Anonymous';
            this.saveUserSettings(); // Save immediately for better UX
            throttledUpdateSettings();
        });
        
        document.getElementById('radiusSlider').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.userSettings.radius = value;
            document.getElementById('radiusValue').textContent = value;
            this.saveUserSettings(); // Save immediately for better UX
            throttledUpdateSettings();
        });
        
        document.getElementById('channelName').addEventListener('input', (e) => {
            this.userSettings.channel = e.target.value;
            this.saveUserSettings(); // Save immediately for better UX
            throttledUpdateSettings();
            this.toggleShareButton();
        });
        
        // Message sending
        document.getElementById('messageInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        document.getElementById('sendBtn').addEventListener('click', () => {
            this.sendMessage();
        });
        
        document.getElementById('messageInput').addEventListener('input', () => {
            this.toggleSendButton();
        });
        
        // Image handling
        document.getElementById('imageBtn').addEventListener('click', () => {
            document.getElementById('imageInput').click();
        });
        
        document.getElementById('imageInput').addEventListener('change', (e) => {
            this.handleImageSelection(e);
        });
        
        document.getElementById('removeImage').addEventListener('click', () => {
            this.removeSelectedImage();
        });
        
        // Channel sharing
        document.getElementById('shareChannel').addEventListener('click', () => {
            this.showChannelShareModal();
        });
        
        document.getElementById('closeShareModal').addEventListener('click', () => {
            this.hideChannelShareModal();
        });
        
        document.getElementById('copyUrl').addEventListener('click', () => {
            this.copyShareUrl();
        });
        
        // Modal backdrop clicks
        document.getElementById('shareModal').addEventListener('click', (e) => {
            if (e.target.id === 'shareModal') {
                this.hideChannelShareModal();
            }
        });
    }
    
    setupAutoResize() {
        const textarea = document.getElementById('messageInput');
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
        });
    }
    
    requestLocation() {
        const statusEl = document.getElementById('locationStatus');
        
        if (!navigator.geolocation) {
            statusEl.textContent = '❌ Geolocation not supported';
            return;
        }
        
        statusEl.textContent = '📍 Getting location...';
        
        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000 // 1 minute
        };
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.userSettings.latitude = position.coords.latitude;
                this.userSettings.longitude = position.coords.longitude;
                statusEl.textContent = '📍 Location found';
                this.updateSettings();
                
                // Start watching position for updates (throttled to prevent excessive updates)
                let lastLocationUpdate = 0;
                const LOCATION_UPDATE_THROTTLE = 30000; // Only update location every 30 seconds
                
                this.watchPositionId = navigator.geolocation.watchPosition(
                    (pos) => {
                        const now = Date.now();
                        if (now - lastLocationUpdate > LOCATION_UPDATE_THROTTLE) {
                            this.userSettings.latitude = pos.coords.latitude;
                            this.userSettings.longitude = pos.coords.longitude;
                            this.updateSettings();
                            lastLocationUpdate = now;
                        }
                    },
                    null,
                    options
                );
            },
            (error) => {
                console.error('Geolocation error:', error);
                let message = '❌ Location access denied';
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        message = '❌ Location access denied. Please enable location to use Groupdeedo.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = '❌ Location unavailable';
                        break;
                    case error.TIMEOUT:
                        message = '❌ Location request timed out';
                        break;
                }
                statusEl.textContent = message;
            },
            options
        );
    }
    
    connectSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.isConnected = true;
            this.updateConnectionStatus('Connected', 'connected');
            this.updateSettings(); // Send initial settings
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.isConnected = false;
            this.updateConnectionStatus('Disconnected', 'disconnected');
        });
        
        this.socket.on('reconnect', () => {
            console.log('Reconnected to server');
            this.isConnected = true;
            this.updateConnectionStatus('Connected', 'connected');
            this.updateSettings();
        });
        
        this.socket.on('posts', (posts) => {
            this.displayPosts(posts);
        });
        
        this.socket.on('newPost', (post) => {
            this.addNewPost(post);
        });
        
        this.socket.on('channelInfo', (info) => {
            this.displayChannelInfo(info);
        });
        
        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            this.showNotification(error, 'error');
        });
    }
    
    updateConnectionStatus(text, className) {
        const statusEl = document.getElementById('connectionStatus');
        const indicatorEl = statusEl.querySelector('.status-indicator');
        const textEl = statusEl.querySelector('.status-text');
        
        indicatorEl.className = `status-indicator ${className}`;
        textEl.textContent = text;
    }
    
    updateSettings() {
        if (this.socket && this.isConnected) {
            this.socket.emit('updateSettings', this.userSettings);
        }
    }
    
    openSettings() {
        const panel = document.getElementById('settingsPanel');
        panel.classList.add('open');
        
        // Update form values
        document.getElementById('displayName').value = this.userSettings.displayName;
        document.getElementById('radiusSlider').value = this.userSettings.radius;
        document.getElementById('radiusValue').textContent = this.userSettings.radius;
        document.getElementById('channelName').value = this.userSettings.channel;
        
        this.toggleShareButton();
    }
    
    closeSettings() {
        const panel = document.getElementById('settingsPanel');
        panel.classList.remove('open');
    }
    
    toggleShareButton() {
        const channelValue = document.getElementById('channelName').value;
        const shareBtn = document.getElementById('shareChannel');
        shareBtn.style.display = channelValue.trim() ? 'block' : 'none';
    }
    
    toggleSendButton() {
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const hasText = messageInput.value.trim().length > 0;
        const hasImage = document.getElementById('imagePreview').style.display === 'block';
        
        sendBtn.disabled = !hasText && !hasImage;
    }
    
    sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();
        
        if (!message && !this.selectedImageData) {
            return;
        }
        
        if (!this.userSettings.latitude || !this.userSettings.longitude) {
            this.showNotification('Location required to send messages', 'error');
            return;
        }
        
        const messageData = {
            message: message,
            image: this.selectedImageData || null
        };
        
        this.socket.emit('sendMessage', messageData);
        
        // Clear input
        messageInput.value = '';
        messageInput.style.height = 'auto';
        this.removeSelectedImage();
        this.toggleSendButton();
    }
    
    handleImageSelection(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // Check file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
            this.showNotification('Image too large. Maximum size is 10MB.', 'error');
            return;
        }
        
        // Check file type
        if (!file.type.startsWith('image/')) {
            this.showNotification('Please select an image file.', 'error');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            this.selectedImageData = e.target.result;
            
            // Show preview
            const preview = document.getElementById('imagePreview');
            const img = document.getElementById('previewImg');
            img.src = this.selectedImageData;
            preview.style.display = 'block';
            
            this.toggleSendButton();
        };
        
        reader.readAsDataURL(file);
    }
    
    removeSelectedImage() {
        this.selectedImageData = null;
        document.getElementById('imagePreview').style.display = 'none';
        document.getElementById('imageInput').value = '';
        this.toggleSendButton();
    }
    
    displayPosts(posts) {
        const container = document.getElementById('messagesContainer');
        
        // Remove welcome message if it exists
        const welcomeMsg = container.querySelector('.welcome-message');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }
        
        // Check if posts are the same as currently displayed to avoid unnecessary updates
        const currentPosts = container.querySelectorAll('.message');
        if (currentPosts.length === posts.length) {
            // Quick check if content is the same - compare timestamps of first and last posts
            if (posts.length > 0 && currentPosts.length > 0) {
                const firstCurrentTime = currentPosts[0].querySelector('.message-time')?.textContent;
                const lastCurrentTime = currentPosts[currentPosts.length - 1].querySelector('.message-time')?.textContent;
                const firstNewTime = this.getTimeAgo(new Date(posts[0].timestamp));
                const lastNewTime = this.getTimeAgo(new Date(posts[posts.length - 1].timestamp));
                
                if (firstCurrentTime && lastCurrentTime && 
                    firstCurrentTime === firstNewTime && lastCurrentTime === lastNewTime) {
                    // Posts appear to be the same, skip update
                    return;
                }
            }
        }
        
        // Clear existing messages only if we need to update
        container.innerHTML = '';
        
        // Add all posts
        posts.forEach(post => {
            this.addPostElement(post, false);
        });
        
        this.scrollToBottom();
    }
    
    addNewPost(post) {
        const container = document.getElementById('messagesContainer');
        
        // Remove welcome message if it exists
        const welcomeMsg = container.querySelector('.welcome-message');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }
        
        this.addPostElement(post, true);
        this.scrollToBottom();
    }
    
    addPostElement(post, animate = false) {
        const container = document.getElementById('messagesContainer');
        
        const messageEl = document.createElement('div');
        messageEl.className = 'message';
        if (animate) {
            messageEl.style.animation = 'messageSlideIn 0.3s ease-out';
        }
        
        const timeAgo = this.getTimeAgo(new Date(post.timestamp));
        
        let imageHtml = '';
        if (post.image) {
            imageHtml = `
                <div class=\"message-image\">
                    <img src=\"${post.image}\" alt=\"Shared image\" loading=\"lazy\">
                </div>
            `;
        }
        
        let channelInfo = '';
        if (post.channel) {
            channelInfo = `<span>📻 ${post.channel}</span>`;
        }
        
        messageEl.innerHTML = `
            <div class=\"message-header\">
                <span class=\"message-author\">${this.escapeHtml(post.displayName)}</span>
                <span class=\"message-time\">${timeAgo}</span>
            </div>
            <div class=\"message-content\">${this.escapeHtml(post.message)}</div>
            ${imageHtml}
            <div class=\"message-meta\">
                ${channelInfo}
                <span>📍 Nearby</span>
            </div>
        `;
        
        container.appendChild(messageEl);
    }
    
    showChannelShareModal() {
        const channelName = this.userSettings.channel;
        if (!channelName) return;
        
        // Generate QR code
        const baseUrl = window.location.origin;
        const shareUrl = `${baseUrl}/?channel=${encodeURIComponent(channelName)}`;
        
        // Clear previous QR code
        const qrContainer = document.getElementById('qrCode');
        qrContainer.innerHTML = '';
        
        // Generate new QR code (if library is available)
        if (typeof QRCode !== 'undefined') {
            try {
                // Clear the container and create QR code
                qrContainer.innerHTML = '';
                const qrcode = new QRCode(qrContainer, {
                    text: shareUrl,
                    width: 200,
                    height: 200,
                    colorDark: '#333333',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
            } catch (error) {
                console.error('QR Code generation error:', error);
                qrContainer.innerHTML = '<div style="width: 200px; height: 200px; border: 2px solid #ccc; display: flex; align-items: center; justify-content: center; text-align: center; background: #f5f5f5; border-radius: 8px; color: #666;">QR Code Generation Failed</div>';
            }
        } else {
            qrContainer.innerHTML = '<div style="width: 200px; height: 200px; border: 2px solid #ccc; display: flex; align-items: center; justify-content: center; text-align: center; background: #f5f5f5; border-radius: 8px;"><p style="margin: 0; color: #666;">QR Code<br>Not Available</p></div>';
        }
        
        // Set share URL
        document.getElementById('shareUrl').value = shareUrl;
        
        // Show modal
        document.getElementById('shareModal').style.display = 'flex';
    }
    
    hideChannelShareModal() {
        document.getElementById('shareModal').style.display = 'none';
    }
    
    copyShareUrl() {
        const urlInput = document.getElementById('shareUrl');
        urlInput.select();
        urlInput.setSelectionRange(0, 99999); // For mobile devices
        
        navigator.clipboard.writeText(urlInput.value).then(() => {
            this.showNotification('Link copied!', 'success');
        }).catch(() => {
            // Fallback for older browsers
            document.execCommand('copy');
            this.showNotification('Link copied!', 'success');
        });
    }
    
    scrollToBottom() {
        const container = document.getElementById('messagesContainer').parentElement;
        container.scrollTop = container.scrollHeight;
    }
    
    getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) return `${diffDays}d ago`;
        
        return date.toLocaleDateString();
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Add styles
        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '12px 20px',
            borderRadius: '8px',
            color: 'white',
            fontWeight: '500',
            zIndex: '10000',
            maxWidth: '300px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            transform: 'translateX(100%)',
            transition: 'transform 0.3s ease'
        });
        
        // Set color based on type
        switch (type) {
            case 'success':
                notification.style.backgroundColor = '#4CAF50';
                break;
            case 'error':
                notification.style.backgroundColor = '#F44336';
                break;
            default:
                notification.style.backgroundColor = '#2196F3';
        }
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);
        
        // Remove after delay
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.parentElement.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new GroupdeedoApp();
    });
} else {
    new GroupdeedoApp();
}