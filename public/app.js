class GroupdeedoApp {
    constructor() {
        this.socket = null;
        this.userSettings = {
            displayName: 'Anonymous',
            channel: ''
        };
        this.channels = []; // List of user's channels
        this.currentView = 'channels'; // 'channels' or 'chat'
        this.isConnected = false;
        this.hasAgreedToTos = false;
        this.selectedImageData = null;
        
        // Load saved data from localStorage
        this.loadUserSettings();
        this.loadChannels();
        
        this.init();
    }
    
    init() {
        this.checkTosAgreement();
        this.setupEventListeners();
        this.setupAutoResize();
        
        // Parse URL parameters for channel sharing
        this.parseUrlParams();
    }
    
    // ==================== Data Persistence ====================
    
    loadUserSettings() {
        try {
            const savedSettings = localStorage.getItem('groupdeedo_user_settings');
            if (savedSettings) {
                const parsedSettings = JSON.parse(savedSettings);
                if (parsedSettings.displayName) {
                    this.userSettings.displayName = parsedSettings.displayName;
                }
                console.log('Loaded user settings:', this.userSettings);
            }
        } catch (error) {
            console.warn('Failed to load user settings from localStorage:', error);
        }
    }
    
    saveUserSettings() {
        try {
            const settingsToSave = {
                displayName: this.userSettings.displayName
            };
            localStorage.setItem('groupdeedo_user_settings', JSON.stringify(settingsToSave));
            console.log('Saved user settings:', settingsToSave);
        } catch (error) {
            console.warn('Failed to save user settings to localStorage:', error);
        }
    }
    
    loadChannels() {
        try {
            const savedChannels = localStorage.getItem('groupdeedo_channels');
            if (savedChannels) {
                this.channels = JSON.parse(savedChannels);
                console.log('Loaded channels:', this.channels);
            }
        } catch (error) {
            console.warn('Failed to load channels from localStorage:', error);
            this.channels = [];
        }
    }
    
    saveChannels() {
        try {
            localStorage.setItem('groupdeedo_channels', JSON.stringify(this.channels));
            console.log('Saved channels:', this.channels);
        } catch (error) {
            console.warn('Failed to save channels to localStorage:', error);
        }
    }
    
    addChannel(channelName) {
        const normalized = channelName.trim();
        if (!normalized) return false;
        
        // Check if already exists (case-insensitive)
        const exists = this.channels.some(c => c.toLowerCase() === normalized.toLowerCase());
        if (exists) {
            this.showNotification('Channel already in your list', 'info');
            return false;
        }
        
        this.channels.push(normalized);
        this.saveChannels();
        this.renderChannelList();
        return true;
    }
    
    removeChannel(channelName) {
        this.channels = this.channels.filter(c => c !== channelName);
        this.saveChannels();
        this.renderChannelList();
    }
    
    // ==================== View Management ====================
    
    checkTosAgreement() {
        const agreed = localStorage.getItem('groupdeedo_tos_agreed');
        if (agreed === 'true') {
            this.hasAgreedToTos = true;
            this.showChannelListScreen();
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
    
    showChannelListScreen() {
        document.getElementById('channelListScreen').style.display = 'flex';
        document.getElementById('app').style.display = 'none';
        document.getElementById('loadingOverlay').style.display = 'none';
        this.hideTosModal();
        this.currentView = 'channels';
        this.renderChannelList();
    }
    
    showChatView(channelName) {
        this.userSettings.channel = channelName;
        document.getElementById('channelListScreen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        document.getElementById('currentChannelName').textContent = channelName;
        this.currentView = 'chat';
        
        // Clear messages container
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '<div class="welcome-message"><p>Loading messages...</p></div>';
        
        // Request posts for this channel
        this.requestChannelPosts();
    }
    
    renderChannelList() {
        const container = document.getElementById('channelList');
        
        if (this.channels.length === 0) {
            container.innerHTML = `
                <div class="empty-channels-message">
                    <p>📭 No channels yet!</p>
                    <p>Add a channel below to get started.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = this.channels.map(channel => `
            <div class="channel-item" data-channel="${this.escapeHtml(channel)}">
                <div class="channel-info">
                    <span class="channel-icon">📻</span>
                    <span class="channel-name">${this.escapeHtml(channel)}</span>
                </div>
                <div class="channel-actions">
                    <button class="channel-share-btn" title="Share">📤</button>
                    <button class="channel-delete-btn" title="Remove">✕</button>
                </div>
            </div>
        `).join('');
        
        // Add click handlers
        container.querySelectorAll('.channel-item').forEach(item => {
            const channelName = item.dataset.channel;
            
            // Click on channel to open
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.channel-actions')) {
                    this.showChatView(channelName);
                }
            });
            
            // Share button
            item.querySelector('.channel-share-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.userSettings.channel = channelName;
                this.showChannelShareModal();
            });
            
            // Delete button
            item.querySelector('.channel-delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Remove "${channelName}" from your channels?`)) {
                    this.removeChannel(channelName);
                    this.showNotification('Channel removed', 'success');
                }
            });
        });
    }
    
    parseUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const channelParam = urlParams.get('channel');
        if (channelParam) {
            // Auto-add channel from URL and go directly to it
            if (!this.channels.includes(channelParam)) {
                this.channels.push(channelParam);
                this.saveChannels();
            }
            
            // After TOS agreement, go directly to this channel
            this.pendingChannel = channelParam;
            
            // Clear URL parameter
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
    
    // ==================== Event Listeners ====================
    
    setupEventListeners() {
        // TOS Agreement
        document.getElementById('agreeTos').addEventListener('click', () => {
            localStorage.setItem('groupdeedo_tos_agreed', 'true');
            this.hasAgreedToTos = true;
            this.connectSocket();
            
            // If there's a pending channel from URL, go directly to it
            if (this.pendingChannel) {
                this.showChatView(this.pendingChannel);
                this.pendingChannel = null;
            } else {
                this.showChannelListScreen();
            }
        });
        
        // Channel List Screen - Settings button (opens main settings)
        document.getElementById('channelSettingsBtn').addEventListener('click', () => {
            this.openMainSettings();
        });
        
        // Main Settings Panel (channel list screen)
        document.getElementById('closeMainSettings').addEventListener('click', () => {
            this.closeMainSettings();
        });
        
        document.getElementById('mainDisplayName').addEventListener('input', (e) => {
            this.userSettings.displayName = e.target.value || 'Anonymous';
            this.saveUserSettings();
            // Also update the chat settings display name if it exists
            const chatDisplayName = document.getElementById('displayName');
            if (chatDisplayName) {
                chatDisplayName.value = this.userSettings.displayName;
            }
            this.updateSettings();
        });
        
        document.getElementById('mainSettingsOk').addEventListener('click', () => {
            this.closeMainSettings();
            this.showNotification('Settings saved', 'success');
        });
        
        // Channel List Screen - Add channel
        document.getElementById('addChannelBtn').addEventListener('click', () => {
            this.handleAddChannel();
        });
        
        document.getElementById('newChannelInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.handleAddChannel();
            }
        });
        
        // Chat View - Back button
        document.getElementById('backToChannelsBtn').addEventListener('click', () => {
            this.showChannelListScreen();
        });
        
        // Chat View - Settings
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.openSettings();
        });
        
        document.getElementById('closeSettings').addEventListener('click', () => {
            this.closeSettings();
        });
        
        // Display name input (chat settings)
        document.getElementById('displayName').addEventListener('input', (e) => {
            this.userSettings.displayName = e.target.value || 'Anonymous';
            this.saveUserSettings();
            // Also update the main settings display name
            const mainDisplayName = document.getElementById('mainDisplayName');
            if (mainDisplayName) {
                mainDisplayName.value = this.userSettings.displayName;
            }
            this.updateSettings();
        });
        
        // Settings OK button (chat settings)
        document.getElementById('settingsOk').addEventListener('click', () => {
            this.closeSettings();
            this.showNotification('Settings saved', 'success');
        });
        
        // Share channel button in settings
        document.getElementById('shareChannelBtn').addEventListener('click', () => {
            this.showChannelShareModal();
        });
        
        // Leave channel button in settings
        document.getElementById('leaveChannelBtn').addEventListener('click', () => {
            const channel = this.userSettings.channel;
            if (confirm(`Leave "${channel}" and remove it from your channels?`)) {
                this.removeChannel(channel);
                this.closeSettings();
                this.showChannelListScreen();
                this.showNotification('Left channel', 'success');
            }
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
            console.log('📷 Image button clicked');
            document.getElementById('imageInput').click();
        });
        
        document.getElementById('imageInput').addEventListener('change', (e) => {
            console.log('📷 Image selected:', e.target.files[0]?.name);
            this.handleImageSelection(e);
        });
        
        document.getElementById('removeImage').addEventListener('click', () => {
            this.removeSelectedImage();
        });
        
        // Share modal
        document.getElementById('closeShareModal').addEventListener('click', () => {
            this.hideChannelShareModal();
        });
        
        document.getElementById('copyUrl').addEventListener('click', () => {
            this.copyShareUrl();
        });
        
        document.getElementById('shareModal').addEventListener('click', (e) => {
            if (e.target.id === 'shareModal') {
                this.hideChannelShareModal();
            }
        });
    }
    
    handleAddChannel() {
        const input = document.getElementById('newChannelInput');
        const channelName = input.value.trim();
        
        if (!channelName) {
            this.showNotification('Please enter a channel name', 'error');
            return;
        }
        
        if (this.addChannel(channelName)) {
            input.value = '';
            this.showNotification(`Added "${channelName}"`, 'success');
        }
    }
    
    setupAutoResize() {
        const textarea = document.getElementById('messageInput');
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
        });
    }
    
    // ==================== Socket Connection ====================
    
    connectSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.isConnected = true;
            this.updateConnectionStatus('Connected', 'connected');
            this.updateSettings();
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
        
        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            this.showNotification(error, 'error');
        });
        
        this.socket.on('messageDeleted', (data) => {
            console.log('Message deleted:', data.messageId, data.reason || 'admin');
            this.removeMessage(data.messageId);
            if (data.reason === 'auto-moderation') {
                this.showNotification(`Message removed by community moderation (${data.downvoteCount} downvotes)`, 'info');
            }
        });
        
        this.socket.on('voteUpdate', (data) => {
            console.log('Vote update received:', data);
            this.updateVoteDisplay(data.postId, data.voteCounts);
        });
    }
    
    updateConnectionStatus(text, className) {
        const statusEl = document.getElementById('connectionStatus');
        if (!statusEl) return;
        
        const indicatorEl = statusEl.querySelector('.status-indicator');
        const textEl = statusEl.querySelector('.status-text');
        
        if (indicatorEl) indicatorEl.className = `status-indicator ${className}`;
        if (textEl) textEl.textContent = text;
    }
    
    updateSettings() {
        if (this.socket && this.isConnected) {
            this.socket.emit('updateSettings', this.userSettings);
        }
    }
    
    requestChannelPosts() {
        if (this.socket && this.isConnected) {
            console.log('📡 Requesting posts for channel:', this.userSettings.channel);
            this.socket.emit('requestPosts', { channel: this.userSettings.channel });
        } else {
            console.log('📡 Not connected, will request posts when connected');
            // Update settings will trigger posts when we reconnect
            this.updateSettings();
        }
    }
    
    // ==================== Settings Panel ====================
    
    // Main settings panel (on channel list screen)
    openMainSettings() {
        const panel = document.getElementById('mainSettingsPanel');
        panel.classList.add('open');
        document.getElementById('mainDisplayName').value = this.userSettings.displayName;
    }
    
    closeMainSettings() {
        const panel = document.getElementById('mainSettingsPanel');
        panel.classList.remove('open');
    }
    
    // Chat settings panel (in chat view)
    openSettings() {
        const panel = document.getElementById('settingsPanel');
        panel.classList.add('open');
        document.getElementById('displayName').value = this.userSettings.displayName;
        
        // Show/hide channel-specific buttons based on current view
        const shareBtn = document.getElementById('shareChannelBtn');
        const leaveBtn = document.getElementById('leaveChannelBtn');
        
        if (this.currentView === 'chat' && this.userSettings.channel) {
            shareBtn.style.display = 'block';
            leaveBtn.style.display = 'block';
        } else {
            shareBtn.style.display = 'none';
            leaveBtn.style.display = 'none';
        }
    }
    
    closeSettings() {
        const panel = document.getElementById('settingsPanel');
        panel.classList.remove('open');
    }
    
    // ==================== Messaging ====================
    
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
    
    // ==================== Image Handling ====================
    
    handleImageSelection(event) {
        console.log('📷 handleImageSelection called');
        
        try {
            const file = event.target.files[0];
            if (!file) {
                console.log('📷 No file selected');
                return;
            }
            
            console.log('📷 File details:', file.name, file.type, file.size);
            
            // Check if it's an image - be more lenient on mobile
            const isImage = file.type.startsWith('image/') || 
                           /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(file.name);
            
            if (!isImage) {
                console.log('📷 Not an image file:', file.type, file.name);
                this.showNotification('Please select an image file.', 'error');
                event.target.value = '';
                return;
            }
            
            if (file.size > 50 * 1024 * 1024) {
                this.showNotification('Image is too large. Please select a smaller image (under 50MB).', 'error');
                event.target.value = '';
                return;
            }
            
            // Show immediate feedback
            this.showNotification('Processing image...', 'info');
            
            // Use setTimeout to prevent UI blocking on mobile
            setTimeout(() => {
                this.processImage(file);
            }, 100);
            
        } catch (error) {
            console.error('📷 Error in handleImageSelection:', error);
            this.showNotification('Failed to select image. Please try again.', 'error');
            event.target.value = '';
        }
    }
    
    async processImage(file) {
        console.log('📷 processImage called for:', file.name, 'size:', file.size);
        
        // Store reference to 'this' for use in callbacks
        const self = this;
        
        try {
            // Always compress on mobile to reduce memory usage and socket transmission size
            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
            // Always compress - socket.io has limits and large base64 causes issues
            const needsCompression = true; // Compress everything for reliability
            
            console.log('📷 Mobile device:', isMobile, 'File size MB:', (file.size / 1024 / 1024).toFixed(2));
            
            let imageDataUrl;
            
            // Determine compression settings based on file size and device
            let maxWidth, maxHeight, quality;
            
            if (file.size > 8 * 1024 * 1024) {
                // Very large files (>8MB) - aggressive compression
                maxWidth = 1024;
                maxHeight = 768;
                quality = 0.5;
                console.log('📷 Very large file - using aggressive compression');
            } else if (file.size > 4 * 1024 * 1024 || isMobile) {
                // Large files (>4MB) or mobile - moderate compression
                maxWidth = 1280;
                maxHeight = 960;
                quality = 0.6;
                console.log('📷 Large file or mobile - using moderate compression');
            } else {
                // Normal files - light compression
                maxWidth = 1600;
                maxHeight = 1200;
                quality = 0.75;
                console.log('📷 Normal file - using light compression');
            }
            
            console.log(`📷 Compressing with: ${maxWidth}x${maxHeight} @ quality ${quality}`);
            imageDataUrl = await this.compressImage(file, maxWidth, maxHeight, quality);
            console.log('📷 Compression complete, data URL length:', imageDataUrl.length, '(~', Math.round(imageDataUrl.length * 0.75 / 1024), 'KB)');
            
            // Verify we got valid data
            if (!imageDataUrl || !imageDataUrl.startsWith('data:')) {
                throw new Error('Invalid image data generated');
            }
            
            this.selectedImageData = imageDataUrl;
            console.log('📷 Image data ready, length:', this.selectedImageData.length);
            
            // Show preview
            const preview = document.getElementById('imagePreview');
            const img = document.getElementById('previewImg');
            
            // Use onload to ensure image is ready before showing
            img.onload = function() {
                console.log('📷 Preview image loaded successfully');
                preview.style.display = 'block';
                self.toggleSendButton();
                
                // Show success notification
                const originalSizeMB = (file.size / 1024 / 1024).toFixed(1);
                const finalSize = Math.round(self.selectedImageData.length * 0.75);
                const finalSizeMB = (finalSize / 1024 / 1024).toFixed(1);
                
                if (needsCompression && file.size > 1 * 1024 * 1024) {
                    self.showNotification(`Image ready! ${originalSizeMB}MB → ${finalSizeMB}MB`, 'success');
                } else {
                    self.showNotification('Image ready!', 'success');
                }
            };
            
            img.onerror = function() {
                console.error('📷 Preview image failed to load');
                self.showNotification('Failed to preview image.', 'error');
                self.removeSelectedImage();
            };
            
            img.src = this.selectedImageData;
            
        } catch (error) {
            console.error('📷 Error processing image:', error);
            console.error('📷 Error name:', error.name);
            console.error('📷 Error message:', error.message);
            
            this.showNotification('Failed to process image. Please try a smaller image.', 'error');
            this.removeSelectedImage();
        }
    }
    
    fileToDataUrl(file) {
        console.log('📷 fileToDataUrl called for file size:', file.size);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                console.log('📷 FileReader onload complete');
                resolve(e.target.result);
            };
            
            reader.onerror = (e) => {
                console.error('📷 FileReader error:', e);
                reject(new Error('Failed to read file: ' + (reader.error?.message || 'Unknown error')));
            };
            
            reader.onabort = () => {
                console.warn('📷 FileReader aborted');
                reject(new Error('File reading was aborted'));
            };
            
            try {
                reader.readAsDataURL(file);
            } catch (error) {
                console.error('📷 Error starting FileReader:', error);
                reject(error);
            }
        });
    }
    
    compressImage(file, maxWidth = 1920, maxHeight = 1080, quality = 0.8) {
        console.log('📷 compressImage called:', maxWidth, maxHeight, quality);
        
        return new Promise((resolve, reject) => {
            // Set a timeout for the entire operation
            const timeout = setTimeout(() => {
                console.error('📷 Compression timeout');
                reject(new Error('Image compression timed out. Please try a smaller image.'));
            }, 30000); // 30 second timeout
            
            const cleanup = () => {
                clearTimeout(timeout);
            };
            
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                if (!ctx) {
                    cleanup();
                    reject(new Error('Failed to create canvas context'));
                    return;
                }
                
                const img = new Image();
                
                img.onload = () => {
                    console.log('📷 Image loaded for compression:', img.width, 'x', img.height);
                    
                    try {
                        let width = img.width;
                        let height = img.height;
                        
                        // Reduce dimensions for very large images
                        let targetMaxWidth = maxWidth;
                        let targetMaxHeight = maxHeight;
                        
                        if (file.size > 10 * 1024 * 1024) {
                            targetMaxWidth = Math.min(maxWidth, 1280);
                            targetMaxHeight = Math.min(maxHeight, 720);
                        }
                        
                        // Calculate new dimensions maintaining aspect ratio
                        if (width > targetMaxWidth || height > targetMaxHeight) {
                            const aspectRatio = width / height;
                            
                            if (aspectRatio > 1) {
                                // Landscape
                                width = targetMaxWidth;
                                height = Math.round(width / aspectRatio);
                            } else {
                                // Portrait or square
                                height = targetMaxHeight;
                                width = Math.round(height * aspectRatio);
                            }
                            
                            // Final bounds check
                            if (width > targetMaxWidth) {
                                width = targetMaxWidth;
                                height = Math.round(width / aspectRatio);
                            }
                            if (height > targetMaxHeight) {
                                height = targetMaxHeight;
                                width = Math.round(height * aspectRatio);
                            }
                        }
                        
                        width = Math.max(1, Math.round(width));
                        height = Math.max(1, Math.round(height));
                        
                        console.log('📷 Resizing to:', width, 'x', height);
                        
                        canvas.width = width;
                        canvas.height = height;
                        
                        // Draw image
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        ctx.drawImage(img, 0, 0, width, height);
                        
                        // Compress with decreasing quality until size is acceptable
                        // Socket.IO default is 1MB, we set 10MB but aim for <2MB for reliability
                        let currentQuality = quality;
                        let dataUrl = canvas.toDataURL('image/jpeg', currentQuality);
                        let attempts = 0;
                        const maxAttempts = 8;
                        const targetMaxSize = 2 * 1024 * 1024; // Target 2MB max (base64 is ~33% larger than binary)
                        
                        console.log('📷 Initial compression result:', Math.round(dataUrl.length / 1024), 'KB');
                        
                        // If still too large, reduce quality
                        while (dataUrl.length > targetMaxSize && currentQuality > 0.2 && attempts < maxAttempts) {
                            currentQuality -= 0.1;
                            dataUrl = canvas.toDataURL('image/jpeg', currentQuality);
                            attempts++;
                            console.log('📷 Compression attempt', attempts, 'quality:', currentQuality.toFixed(1), 'size:', Math.round(dataUrl.length / 1024), 'KB');
                        }
                        
                        // If still too large after quality reduction, reduce dimensions further
                        if (dataUrl.length > targetMaxSize && width > 800) {
                            console.log('📷 Still too large, reducing dimensions further');
                            const scale = 0.7;
                            width = Math.round(width * scale);
                            height = Math.round(height * scale);
                            canvas.width = width;
                            canvas.height = height;
                            ctx.drawImage(img, 0, 0, width, height);
                            dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                            console.log('📷 After dimension reduction:', Math.round(dataUrl.length / 1024), 'KB at', width, 'x', height);
                        }
                        
                        console.log('📷 Final compressed size:', Math.round(dataUrl.length / 1024), 'KB');
                        
                        cleanup();
                        resolve(dataUrl);
                        
                    } catch (error) {
                        console.error('📷 Error during canvas operations:', error);
                        cleanup();
                        reject(error);
                    }
                };
                
                img.onerror = (e) => {
                    console.error('📷 Image load error:', e);
                    cleanup();
                    reject(new Error('Failed to load image for compression'));
                };
                
                // Read file
                const reader = new FileReader();
                
                reader.onload = (e) => {
                    console.log('📷 File read complete, loading into Image');
                    img.src = e.target.result;
                };
                
                reader.onerror = (e) => {
                    console.error('📷 FileReader error during compression:', e);
                    cleanup();
                    reject(new Error('Failed to read image file'));
                };
                
                reader.readAsDataURL(file);
                
            } catch (error) {
                console.error('📷 Error setting up compression:', error);
                cleanup();
                reject(error);
            }
        });
    }
    
    removeSelectedImage() {
        this.selectedImageData = null;
        document.getElementById('imagePreview').style.display = 'none';
        document.getElementById('imageInput').value = '';
        this.toggleSendButton();
    }
    
    // ==================== Posts Display ====================
    
    displayPosts(posts) {
        const container = document.getElementById('messagesContainer');
        
        const welcomeMsg = container.querySelector('.welcome-message');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }
        
        container.innerHTML = '';
        
        if (posts.length === 0) {
            this.showWelcomeMessage();
            return;
        }
        
        posts.forEach(post => {
            this.addPostElement(post, false);
        });
        
        this.scrollToBottom();
    }
    
    addNewPost(post) {
        const container = document.getElementById('messagesContainer');
        
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
        messageEl.setAttribute('data-message-id', post.id);
        if (animate) {
            messageEl.style.animation = 'messageSlideIn 0.3s ease-out';
        }
        
        const timeAgo = this.getTimeAgo(new Date(post.timestamp));
        
        let imageHtml = '';
        if (post.image) {
            imageHtml = `
                <div class="message-image">
                    <img src="${post.image}" alt="Shared image" loading="lazy">
                </div>
            `;
        }
        
        messageEl.innerHTML = `
            <div class="message-header">
                <span class="message-author">${this.escapeHtml(post.displayName)}</span>
                <span class="message-time">${timeAgo}</span>
            </div>
            <div class="message-content">${this.escapeHtml(post.message)}</div>
            ${imageHtml}
            <div class="message-votes">
                <button class="vote-btn vote-up" data-post-id="${post.id}" data-vote-type="up">
                    👍 <span class="vote-count upvote-count">${post.upvotes || 0}</span>
                </button>
                <button class="vote-btn vote-down" data-post-id="${post.id}" data-vote-type="down">
                    👎 <span class="vote-count downvote-count">${post.downvotes || 0}</span>
                </button>
            </div>
        `;
        
        container.appendChild(messageEl);
        this.setupVoteButtons(messageEl, post.id);
    }
    
    setupVoteButtons(messageElement, postId) {
        const voteButtons = messageElement.querySelectorAll('.vote-btn');
        voteButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleVote(postId, button.dataset.voteType, button);
            });
        });
    }
    
    async handleVote(postId, voteType, buttonElement) {
        if (buttonElement.disabled) return;
        buttonElement.disabled = true;
        
        try {
            const response = await fetch(`/api/vote/${postId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    voteType: voteType,
                    sessionId: this.socket.id
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.updateVoteDisplay(postId, result.voteCounts);
                
                let message = '';
                if (result.action === 'added') {
                    message = `${voteType === 'up' ? '👍' : '👎'} Vote added`;
                } else if (result.action === 'removed') {
                    message = `Vote removed`;
                } else if (result.action === 'updated') {
                    message = `${voteType === 'up' ? '👍' : '👎'} Vote changed`;
                }
                
                if (result.autoDeleted) {
                    message = result.message;
                }
                
                this.showNotification(message, result.autoDeleted ? 'info' : 'success');
            } else {
                throw new Error(result.error || 'Failed to vote');
            }
            
        } catch (error) {
            console.error('Error voting:', error);
            this.showNotification('Failed to vote. Please try again.', 'error');
        } finally {
            setTimeout(() => {
                buttonElement.disabled = false;
            }, 1000);
        }
    }
    
    updateVoteDisplay(postId, voteCounts) {
        const messageElement = document.querySelector(`[data-message-id="${postId}"]`);
        if (messageElement) {
            const upvoteCount = messageElement.querySelector('.upvote-count');
            const downvoteCount = messageElement.querySelector('.downvote-count');
            
            if (upvoteCount) upvoteCount.textContent = voteCounts.up || 0;
            if (downvoteCount) downvoteCount.textContent = voteCounts.down || 0;
        }
    }
    
    removeMessage(messageId) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageEl) {
            messageEl.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
            messageEl.style.opacity = '0';
            messageEl.style.transform = 'translateX(-20px)';
            
            setTimeout(() => {
                messageEl.remove();
                
                const container = document.getElementById('messagesContainer');
                const remainingMessages = container.querySelectorAll('.message');
                if (remainingMessages.length === 0) {
                    this.showWelcomeMessage();
                }
            }, 300);
        }
    }
    
    showWelcomeMessage() {
        const container = document.getElementById('messagesContainer');
        const welcomeMsg = document.createElement('div');
        welcomeMsg.className = 'welcome-message';
        welcomeMsg.innerHTML = `
            <p>🎉 Welcome to ${this.escapeHtml(this.userSettings.channel)}!</p>
            <p>Be the first to send a message in this channel.</p>
        `;
        container.appendChild(welcomeMsg);
    }
    
    // ==================== Channel Sharing ====================
    
    showChannelShareModal() {
        const channelName = this.userSettings.channel;
        if (!channelName) return;
        
        const baseUrl = window.location.origin;
        const shareUrl = `${baseUrl}/?channel=${encodeURIComponent(channelName)}`;
        
        const qrContainer = document.getElementById('qrCode');
        qrContainer.innerHTML = '';
        
        if (typeof QRCode !== 'undefined') {
            try {
                new QRCode(qrContainer, {
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
        
        document.getElementById('shareUrl').value = shareUrl;
        document.getElementById('shareModal').style.display = 'flex';
    }
    
    hideChannelShareModal() {
        document.getElementById('shareModal').style.display = 'none';
    }
    
    copyShareUrl() {
        const urlInput = document.getElementById('shareUrl');
        urlInput.select();
        urlInput.setSelectionRange(0, 99999);
        
        navigator.clipboard.writeText(urlInput.value).then(() => {
            this.showNotification('Link copied!', 'success');
        }).catch(() => {
            document.execCommand('copy');
            this.showNotification('Link copied!', 'success');
        });
    }
    
    // ==================== Utilities ====================
    
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
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
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
        
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);
        
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
